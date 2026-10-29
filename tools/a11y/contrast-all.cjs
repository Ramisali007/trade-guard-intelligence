// Colour-contrast scan over every role x page x tab, with seeded cases (TC-2026-00001..3; see README). Needs the test server with demo login on.
//   node contrast-all.cjs [demoKey,demoKey,...]   (run a few roles per process: it is slow)
const T = '';
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const BASE = 'http://127.0.0.1:4300';
const CASES = ['TC-2026-00001', 'TC-2026-00002', 'TC-2026-00003'];
const STATIC = ['/', '/dashboard', '/analytics', '/compare', '/auditor', '/sources', '/customers', '/import', '/verification', '/trade-cases', '/trade-cases/new', '/post-shipment', '/workspace', '/audit', '/admin', '/blog/blog-1', '/access-denied'];
const caseRoutes = (id) => [`/trade-cases/${id}`, `/trade-cases/${id}/scrutiny`, `/trade-cases/${id}/post-shipment`, `/post-shipment/${id}`];
const ROLES = (process.argv[2] || 'corporate_customer,trade_maker,post_trade_officer,compliance_officer,trade_auditor,system_admin,relationship_manager,risk_analyst').split(',');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const groups = new Map();
let scanned = 0;

async function login(account) {
  const r = await fetch(BASE + '/api/auth/demo-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account }) });
  const b = await r.json();
  return { ...b.user, token: b.token, loggedAt: new Date().toISOString() };
}
async function scan(page, label) {
  await page.evaluate(axeSource);
  const res = await page.evaluate(async () => await window.axe.run(document, { runOnly: ['color-contrast'] }));
  scanned++;
  for (const v of res.violations) for (const n of v.nodes) {
    const d = (n.any[0] || {}).data || {};
    const html = n.html.replace(/_ngcontent-[a-z0-9-]+=""\s?/g, '');
    const cls = (html.match(/class="([^"]+)"/) || [, ''])[1] || n.target.join(' ').slice(0, 50);
    const key = [cls, d.fgColor, d.bgColor, d.contrastRatio].join(' | ');
    const g = groups.get(key) || { n: 0, where: new Set(), sample: html.slice(0, 90) };
    g.n++; g.where.add(label); groups.set(key, g);
  }
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
  for (const account of ['(public)', ...ROLES]) {
    const session = account === '(public)' ? null : await login(account);
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    await page.evaluateOnNewDocument((s) => { try { if (s) localStorage.setItem('tradeguard_session', JSON.stringify(s)); } catch (e) {} }, session);
    const routes = account === '(public)' ? ['/'] : [...STATIC, ...CASES.flatMap(caseRoutes)];
    for (const route of routes) {
      try { await page.goto(BASE + route, { waitUntil: 'networkidle2', timeout: 30000 }); } catch { continue; }
      await wait(900);
      const path = new URL(page.url()).pathname;
      if (path !== route && route !== '/access-denied') continue;
      const label = account + ' ' + route;
      await scan(page, label);
      // open every tab in turn, so hidden panels are checked as well
      const tabs = await page.$$('[role="tab"], .tab-btn, .ws-tab, .view-tabs button, .tabs button');
      for (let i = 0; i < Math.min(tabs.length, 14); i++) {
        try { await tabs[i].click(); await wait(500); await scan(page, label + ' [tab ' + i + ']'); } catch { /* tab went away */ }
      }
    }
    await page.close();
  }
  await browser.close();
  const rows = [...groups.entries()].sort((a, b) => b[1].n - a[1].n);
  console.log('SCANNED', scanned, 'views; distinct failing pairs:', rows.length, 'elements:', rows.reduce((s, r) => s + r[1].n, 0));
  for (const [k, g] of rows) console.log(String(g.n).padStart(4), k, ' @', [...g.where].slice(0, 2).join(', '), '  e.g.', g.sample.replace(/\s+/g, ' '));
})();
