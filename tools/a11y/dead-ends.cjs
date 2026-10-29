// For each role: follows every internal link on the pages the role can reach, every search module result, and the
// landing page's workbench buttons, and reports any that end on "Not available for your role" (/access-denied).
// A person must never be offered something they cannot open. Needs the same running copy as scan.cjs.
//   node dead-ends.cjs [demoKey,demoKey,...]
const puppeteer = require('puppeteer-core');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4300';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROLES = (process.argv[2] || 'corporate_customer,trade_maker,post_trade_officer,compliance_officer,risk_analyst,trade_auditor,relationship_manager,operations_desk,system_admin').split(',');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let dead = 0;

async function session(account) {
  const r = await fetch(BASE + '/api/auth/demo-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account }) });
  const b = await r.json();
  return { ...b.user, token: b.token, loggedAt: new Date().toISOString() };
}
const internalHrefs = (page) => page.evaluate(() => [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => h && h.startsWith('/') && !h.startsWith('//') && !h.startsWith('/api')))]);
const pathOf = (page) => page.evaluate(() => location.pathname);

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  for (const role of ROLES) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    const s = await session(role);
    await page.evaluateOnNewDocument((x) => localStorage.setItem('tradeguard_session', JSON.stringify(x)), s);
    const found = []; // [source, offered, where it ended]
    const seen = new Set();
    const visit = async (source, href) => {
      const key = source + '>' + href; if (seen.has(key)) return; seen.add(key);
      await page.goto(BASE + href, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => undefined);
      await wait(500);
      const p = await pathOf(page);
      if (p === '/access-denied') found.push([source, href, p]);
    };

    // 1. the pages of the signed-in menu, and every internal link on them
    await page.goto(BASE + '/', { waitUntil: 'networkidle2' }); await wait(800);
    await page.evaluate(() => [...document.querySelectorAll('.sm-toggle')].find((b) => b.getClientRects().length > 0)?.click()); await wait(1200);
    const menu = await internalHrefs(page);
    const pages = ['/', '/workspace', ...menu.filter((h) => !h.includes('#'))];
    const offered = new Set();
    for (const pg of [...new Set(pages)]) {
      await page.goto(BASE + pg, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => undefined); await wait(900);
      if ((await pathOf(page)) === '/access-denied') { found.push(['menu', pg, '/access-denied']); continue; }
      for (const h of await internalHrefs(page)) offered.add(pg + '|' + h);
    }
    // each distinct destination once: where a link leads does not depend on the page it sits on
    const firstSource = new Map();
    for (const item of offered) { const [src, h] = item.split('|'); if (!firstSource.has(h)) firstSource.set(h, src); }
    for (const [h, src] of firstSource) { if (h.startsWith('/blog') || h === '/' || h.startsWith('/#')) continue; await visit(src, h); }

    // 2. the search box: every module it offers
    await page.goto(BASE + '/', { waitUntil: 'networkidle2' }); await wait(800);
    await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control'); await wait(500);
    await page.evaluate(() => [...document.querySelectorAll('.search-pill')].find((b) => b.innerText.includes('Platform Modules'))?.click()); await wait(300);
    const n = await page.evaluate(() => document.querySelectorAll('.search-result-item').length);
    for (let i = 0; i < n; i++) {
      await page.goto(BASE + '/', { waitUntil: 'networkidle2' }); await wait(600);
      await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control'); await wait(400);
      await page.evaluate(() => [...document.querySelectorAll('.search-pill')].find((b) => b.innerText.includes('Platform Modules'))?.click()); await wait(250);
      const title = await page.evaluate((k) => { const e = document.querySelectorAll('.search-result-item')[k]; const t = e?.querySelector('.search-result-title')?.textContent.trim(); e?.click(); return t; }, i);
      await wait(1000);
      if ((await pathOf(page)) === '/access-denied') found.push(['search', title, '/access-denied']);
    }

    // 3. the landing page's workbench buttons
    for (const how of ['view-more', 'solution-launch']) {
      await page.goto(BASE + '/', { waitUntil: 'networkidle2' }); await wait(900);
      if (how === 'view-more') await page.evaluate(() => document.querySelector('.btn-bigtech-primary')?.click());
      else { await page.evaluate(() => document.querySelector('.solution-card, [class*="solution-card"]')?.click()); await wait(500); await page.evaluate(() => document.querySelector('.btn-sol-launch')?.click()); }
      await wait(1200);
      if ((await pathOf(page)) === '/access-denied') found.push(['landing', how, '/access-denied']);
    }

    dead += found.length;
    console.log((found.length ? 'DEAD ENDS ' : 'clean      ') + role.padEnd(22) + `${firstSource.size} distinct links, ${n} search modules checked`);
    for (const [src, off] of found) console.log('     offered on ' + src + ': ' + off + '  ->  Not available for your role');
    await ctx.close();
  }
  await browser.close();
  console.log(dead ? `\n${dead} DEAD END(S)` : '\nNO ROLE IS OFFERED ANYTHING IT CANNOT OPEN');
  process.exitCode = dead ? 1 : 0;
})().catch((e) => { console.error('CRAWL FAILED', e); process.exit(1); });
