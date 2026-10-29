// Clicks every link of the public header (as a visitor who must sign in first) and every item of the signed-in menu,
// and reports where each one actually leads. Needs the same running copy as scan.cjs (see README.md).
const puppeteer = require('puppeteer-core');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4300';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'PASS ' : 'FAIL ') + text); if (!ok) failures++; };

// the real sign-in form, as an account with the broadest set of screens (the post-shipment officer). The credentials come from the
// environment (NAV_EMAIL, NAV_PASSWORD); none is stored here, and the server must have reCAPTCHA off or this will stop at the check.
async function signInThroughTheForm(page) {
  if (!process.env.NAV_EMAIL || !process.env.NAV_PASSWORD) throw new Error('Set NAV_EMAIL and NAV_PASSWORD to an account of the server under test.');
  await page.type('#login-email', process.env.NAV_EMAIL);
  await page.type('#login-password', process.env.NAV_PASSWORD);
  await page.evaluate(() => document.querySelector('.login-submit-btn')?.click());
}

async function freshPage(browser) {
  // its own browser profile, so a sign-in in one check can never leak into the next
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await wait(800);
  return page;
}
const where = (page) => page.evaluate(() => ({ path: location.pathname, hash: location.hash, search: location.search, modal: !!document.querySelector('.login-backdrop'), scrollY: Math.round(window.scrollY) }));

// the header's dropdown links, read from the page itself so nothing is hard-coded here
async function publicLinks(browser) {
  const page = await freshPage(browser);
  const out = [];
  for (const name of ['Company', 'Solutions', 'Resources', 'Contact Us']) {
    await page.evaluate((n) => [...document.querySelectorAll('.nav-link-btn')].find((b) => b.innerText.includes(n))?.click(), name);
    await wait(250);
    const links = await page.evaluate(() => [...document.querySelectorAll('.nav-flyout .flyout-link')].map((a) => ({ title: a.querySelector('.flyout-title')?.textContent.trim(), href: a.getAttribute('href'), tag: a.tagName })));
    links.forEach((l, index) => out.push({ menu: name, index, ...l }));
    await page.evaluate(() => document.body.click());
    await wait(250);
  }
  await page.browserContext().close();
  return out;
}

async function clickPublicLink(browser, l) {
  const page = await freshPage(browser);
  await page.evaluate((n) => [...document.querySelectorAll('.nav-link-btn')].find((b) => b.innerText.includes(n))?.click(), l.menu);
  await wait(250);
  await page.evaluate((i) => document.querySelectorAll('.nav-flyout .flyout-link')[i]?.click(), l.index);
  await wait(900);
  return page;
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  // optional: node nav-links.cjs "About" checks only the public links whose title contains that text
  const only = process.argv[2];
  const links = (await publicLinks(browser)).filter((l) => !only || (l.title || '').includes(only));
  console.log('Public header: ' + links.length + ' links found\n');

  for (const l of links) {
    const label = `${l.menu} > ${l.title}`;
    if (l.href && l.href.startsWith('mailto:')) { check(true, `${label} opens a mail link (${l.href})`); continue; }
    const page = await clickPublicLink(browser, l);
    let w = await where(page);
    if (l.tag === 'BUTTON' || l.title?.includes('Workbench')) {
      check(w.modal, `${label} opens the sign-in dialog`);
    } else if (l.href === '/' || l.href === '/#about') {
      const target = await page.evaluate(() => { const e = document.getElementById('about'); return e ? Math.round(e.getBoundingClientRect().top) : null; });
      check(w.path === '/' && w.hash === '#about' && w.scrollY > 300 && target !== null && Math.abs(target) < 200, `${label} scrolls the home page to its About section (hash ${w.hash || 'none'}, scrollY ${w.scrollY}, section top ${target})`);
    } else {
      check(w.modal && w.search.includes('returnUrl'), `${label} asks a visitor to sign in first (modal ${w.modal}, ${w.path}${w.search})`);
      // finish the real sign-in: Post-shipment stage, first profile (it holds the broadest permissions)
      await wait(400);
      await signInThroughTheForm(page);
      await wait(2500);
      w = await where(page);
      check(w.path === l.href && !w.modal, `${label} -> after sign-in lands on ${l.href} (got ${w.path}${w.search})`);
    }
    await page.browserContext().close();
  }

  if (only) {
    await browser.close();
    console.log(failures ? failures + ' FAILURE(S)' : 'ALL CHECKED LINKS GO WHERE THEY SHOULD');
    process.exitCode = failures ? 1 : 0;
    return;
  }
  // signed-in: every item of the menu leads to its own page
  console.log('\nSigned-in menu');
  const page = await freshPage(browser);
  await page.evaluate(() => [...document.querySelectorAll('.header-btn-login, .header-btn-demo')][0]?.click());
  await wait(600);
  await wait(400);
  await signInThroughTheForm(page);
  await wait(2500);
  const openMenu = async () => { await page.evaluate(() => [...document.querySelectorAll('.sm-toggle')].find((b) => b.getClientRects().length > 0)?.click()); await wait(1300); };
  await openMenu();
  const items = await page.evaluate(() => [...document.querySelectorAll('#staggered-menu-panel .sm-panel-item, #staggered-menu-panel a[href]')].map((a) => ({ text: a.innerText.replace(/\s+/g, ' ').trim().slice(0, 40), href: a.getAttribute('href') })).filter((x) => x.href && x.href.startsWith('/') && !x.href.startsWith('/api')));
  const seen = new Set();
  for (const it of items) { if (seen.has(it.href)) continue; seen.add(it.href);
    const before = await where(page);
    if (!(await page.evaluate(() => !document.getElementById('staggered-menu-panel')?.hasAttribute('inert')))) await openMenu();
    await page.evaluate((h) => document.querySelector(`#staggered-menu-panel a[href="${h}"]`)?.click(), it.href);
    await wait(1400);
    const w = await where(page);
    check(w.path === it.href, `menu "${it.text}" -> ${it.href} (got ${w.path})`);
    if (w.path === '/access-denied') failures++;
    if (!(await page.evaluate(() => document.getElementById('staggered-menu-panel')?.hasAttribute('inert')))) { await page.evaluate(() => document.querySelector('.sm-panel-close-btn')?.click()); await wait(900); }
    await openMenu();
  }
  await page.browserContext().close();
  await browser.close();
  console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL HEADER LINKS GO WHERE THEY SHOULD'));
  process.exitCode = failures ? 1 : 0;
})().catch((e) => { console.error('NAV TEST FAILED', e); process.exit(1); });
