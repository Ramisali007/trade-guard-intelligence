const puppeteer = require('puppeteer-core');
const fs = require('fs');
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4300';
const ROUTES = ['/', '/dashboard', '/analytics', '/compare', '/auditor', '/sources', '/customers', '/import', '/verification', '/trade-cases', '/trade-cases/new', '/post-shipment', '/workspace', '/audit', '/admin'];
const theme = process.argv[2] || 'light';
const wanted = (process.argv[3] || 'compliance_officer,corporate_customer,post_trade_officer').split(',');

async function login(account) {
  const r = await fetch(BASE + '/api/auth/demo-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account }) });
  if (!r.ok) throw new Error('login ' + account + ' ' + r.status);
  const body = await r.json();
  return { ...body.user, token: body.token, loggedAt: new Date().toISOString() };
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
  const found = new Map(); // rule -> { impact, help, nodes: Map(page -> [targets]) }
  const pages = [];
  const consoleErrors = [];
  for (const account of ['(public)', ...wanted]) {
    const session = account === '(public)' ? null : await login(account);
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    page.on('pageerror', (e) => consoleErrors.push(account + ': ' + e.message));
    await page.evaluateOnNewDocument((s, t) => {
      try { if (s) localStorage.setItem('tradeguard_session', JSON.stringify(s)); localStorage.setItem('theme', t); } catch (e) {}
    }, session, theme);
    for (const route of account === '(public)' ? ['/'] : ROUTES) {
      try {
        await page.goto(BASE + route, { waitUntil: 'networkidle2', timeout: 30000 });
      } catch (e) { pages.push({ account, route, skipped: 'load: ' + e.message.slice(0, 60) }); continue; }
      await new Promise((r) => setTimeout(r, 1200));
      await page.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); }, theme);
      const url = new URL(page.url()).pathname;
      if (url !== route && !(route === '/' && url === '/')) { pages.push({ account, route, skipped: 'redirected to ' + url }); continue; }
      await page.evaluate(axeSource);
      const result = await page.evaluate(async () => await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
      pages.push({ account, route, violations: result.violations.length, passes: result.passes.length });
      for (const v of result.violations) {
        const entry = found.get(v.id) || { impact: v.impact, help: v.help, nodes: new Map() };
        const key = route;
        const list = entry.nodes.get(key) || [];
        for (const n of v.nodes) list.push(n.target.join(' ').slice(0, 90));
        entry.nodes.set(key, list);
        found.set(v.id, entry);
      }
    }
    await page.close();
  }
  await browser.close();
  console.log('PAGES SCANNED:', pages.filter((p) => !p.skipped).length, ' skipped:', pages.filter((p) => p.skipped).length);
  for (const p of pages.filter((p) => p.skipped)) console.log('  skipped', p.account, p.route, '-', p.skipped);
  console.log('PAGE ERRORS:', consoleErrors.length); consoleErrors.slice(0, 5).forEach((e) => console.log('  ', e.slice(0, 160)));
  const rules = [...found.entries()].sort((a, b) => [...b[1].nodes.values()].flat().length - [...a[1].nodes.values()].flat().length);
  console.log('DISTINCT RULES VIOLATED:', rules.length);
  for (const [id, e] of rules) {
    const all = [...e.nodes.values()].flat();
    console.log(`\n[${e.impact}] ${id} — ${e.help}: ${all.length} element(s) on ${e.nodes.size} page(s)`);
    for (const [route, t] of e.nodes) console.log(`    ${route}: ${[...new Set(t)].slice(0, 3).join(' | ')}`);
  }
  fs.writeFileSync(process.argv[4] || 'axe-result.json', JSON.stringify({ pages, rules: rules.map(([id, e]) => ({ id, impact: e.impact, help: e.help, count: [...e.nodes.values()].flat().length })) }, null, 2));
})().catch((e) => { console.error('SCAN FAILED', e); process.exit(1); });
