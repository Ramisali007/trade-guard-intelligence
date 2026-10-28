const puppeteer = require('puppeteer-core');
const fs = require('fs');
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4300';
const theme = process.argv[2] || 'light';
const jobs = [['(public)', '/'], ['compliance_officer', '/dashboard'], ['compliance_officer', '/trade-cases'], ['compliance_officer', '/workspace'], ['corporate_customer', '/trade-cases'], ['compliance_officer', '/analytics'], ['compliance_officer', '/sources'], ['compliance_officer', '/import']];
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
  const groups = new Map();
  for (const [account, route] of jobs) {
    let session = null;
    if (account !== '(public)') {
      const r = await fetch(BASE + '/api/auth/demo-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account }) });
      const b = await r.json(); session = { ...b.user, token: b.token, loggedAt: new Date().toISOString() };
    }
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    await page.evaluateOnNewDocument((s) => { if (s) localStorage.setItem('tradeguard_session', JSON.stringify(s)); }, session);
    await page.goto(BASE + route, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1200));
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.evaluate(axeSource);
    const res = await page.evaluate(async () => await window.axe.run(document, { runOnly: ['color-contrast'] }));
    for (const v of res.violations) for (const n of v.nodes) {
      const d = (n.any[0] || {}).data || {};
      const cls = (n.html.match(/class="([^"]+)"/) || [, ''])[1].split(' ')[0] || n.target.join(' ').slice(0, 40);
      const key = [cls, d.fgColor, d.bgColor, d.contrastRatio, d.expectedContrastRatio, d.fontSize].join(' | ');
      const g = groups.get(key) || { n: 0, pages: new Set(), sample: n.html.slice(0, 80) };
      g.n++; g.pages.add(route); groups.set(key, g);
    }
    await page.close();
  }
  await browser.close();
  const rows = [...groups.entries()].sort((a, b) => b[1].n - a[1].n);
  console.log('distinct (class, fg, bg) combos:', rows.length, ' total elements:', rows.reduce((s, r) => s + r[1].n, 0));
  for (const [k, g] of rows.slice(0, 45)) console.log(String(g.n).padStart(4), k, '  e.g.', g.sample.replace(/\s+/g, ' '));
})();
