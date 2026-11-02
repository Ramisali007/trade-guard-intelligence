const puppeteer = require('puppeteer-core');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4300';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const r = await fetch(BASE + '/api/auth/demo-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: 'compliance_officer' }) });
  const b = await r.json();
  const session = { ...b.user, token: b.token, loggedAt: new Date().toISOString() };
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await page.evaluateOnNewDocument((s) => localStorage.setItem('tradeguard_session', JSON.stringify(s)), session);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));

  // 1. menu: closed = inert; open = not inert and its links are reachable by keyboard; closed again = inert
  const panelInert = () => page.evaluate(() => document.getElementById('staggered-menu-panel')?.hasAttribute('inert'));
  ok(await panelInert() === true, 'menu panel is inert while closed');
  await page.evaluate(() => [...document.querySelectorAll('.sm-toggle')].find((b) => b.getClientRects().length > 0)?.click());
  await new Promise((r) => setTimeout(r, 1200));
  ok(await panelInert() === false, 'menu panel is not inert once open');
  const focusable = await page.evaluate(() => { const a = document.querySelector('#staggered-menu-panel a, #staggered-menu-panel button'); if (!a) return false; a.focus(); return document.activeElement === a; });
  ok(focusable, 'a link inside the open menu can take keyboard focus');
  await page.evaluate(() => document.querySelector('.sm-panel-close-btn')?.click());
  await new Promise((r) => setTimeout(r, 1200));
  ok(await panelInert() === true, 'menu panel is inert again after closing');

  // 2. upload area: Browse Files is a real button reachable by Tab, the container is no longer a fake button
  const dz = await page.evaluate(() => { const d = document.querySelector('.modern-dropzone'); const btn = d?.querySelector('.btn-dropzone-select'); btn?.focus(); return { role: d?.getAttribute('role'), tab: d?.getAttribute('tabindex'), btnFocus: document.activeElement === btn, inputLabel: d?.querySelector('input[type=file]')?.getAttribute('aria-label') }; });
  ok(dz.role === 'group' && dz.tab === null, 'upload container is a labeled group, not a nested-interactive button');
  ok(dz.btnFocus, 'Browse Files takes keyboard focus');
  ok(!!dz.inputLabel, 'hidden file input has an accessible name');

  // 3. there is no search: no button in the header, and Ctrl+K opens nothing
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  await new Promise((r) => setTimeout(r, 500));
  const search = await page.evaluate(() => ({ button: !!document.querySelector('.header-btn-search, [aria-label="Search"]'), dialog: !!document.querySelector('[role="dialog"][aria-label*="earch"]') }));
  ok(!search.button && !search.dialog, 'the site has no search button and Ctrl+K opens no search ' + JSON.stringify(search));
  ok(errors.length === 0, 'no page errors (' + errors.length + ')');
  await browser.close();
})();
