// End-to-end test for web accounts + sharing, using the in-browser fake backend.
// Usage:
//   VITE_CLOUD=fake npx vite build --outDir dist-cloudtest
//   npx vite preview --outDir dist-cloudtest --port 4174 &
//   node scripts/cloud-test.mjs
// Each tab is a different signed-in person; they share the fake "server" (localStorage).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const URL = process.env.APP_URL ?? 'http://localhost:4174/';
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
};
const shot = (p, n) => SHOTS && p.screenshot({ path: join(SHOTS, `${n}.png`) });
const until = async (fn, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 860 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
const errors = [];
const open = async (name) => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await p.goto(URL);
  return p;
};
const signUp = async (p, email) => {
  await p.waitForSelector('.login-card');
  await p.click('.login-tabs button:has-text("Create account")');
  await p.fill('input[type=email]', email);
  await p.fill('input[type=password]', 'secret123');
  await p.click('.login-submit');
  await p.waitForSelector('.lib-header');
};
const pull = (p) => p.evaluate(() => window.dispatchEvent(new Event('focus')));

// --- Alice signs up and shares a document ------------------------------------
const alice = await open('alice');
ok(await alice.locator('.login-card').isVisible(), 'web app shows the login page first');
await shot(alice, '50-login');
await alice.click('.login-tabs button:has-text("Create account")');
await alice.fill('input[type=email]', 'alice@example.com');
await alice.fill('input[type=password]', 'secret123');
await alice.click('.login-submit');
await alice.waitForSelector('.lib-header');
ok(await alice.locator('.account-btn').isVisible(), 'signed in: account button shown');

await alice.click('.btn-new');
await alice.waitForSelector('.doc-content');
await alice.locator('.doc-content').click();
await alice.keyboard.type('Hello from Alice.');
await alice.fill('.ed-title', 'Team plan');
await alice.keyboard.press('Enter');
await alice.click('.btn-share');
await alice.waitForSelector('.share-url input');
ok(true, 'share dialog uploads the document and shows a link');
await alice.fill('.share-invite input', 'Bob@Example.com');
await alice.selectOption('.share-invite select', 'edit');
await alice.click('.share-invite button:has-text("Invite")');
await alice.waitForSelector('.share-people li:has-text("bob@example.com")');
ok(true, 'invite bob as editor (email lower-cased)');
const link = await alice.inputValue('.share-url input');
ok(/#\/shared\/[\w-]+$/.test(link), `share link looks right (${link.replace(/^.*#/, '#')})`);
await shot(alice, '51-share-dialog');
await alice.click('.modal-footer button:has-text("Done")');
ok(await until(async () => (await alice.textContent('.save-status')).includes('Saved and shared')), 'status shows "Saved and shared"');

// --- Bob sees it under Shared and edits it -------------------------------------
const bob = await open('bob');
await signUp(bob, 'bob@example.com');
ok((await bob.locator('.doc-card').count()) === 0, 'bob does not see alice’s private documents');
await bob.click('.nav-item:has-text("Shared")');
await bob.waitForSelector('.doc-card:has-text("Team plan")');
ok((await bob.textContent('.doc-card')).includes('Shared by alice@example.com'), 'bob sees "Shared by alice" in Shared');
await shot(bob, '52-shared-with-me');
await bob.click('.doc-card:has-text("Team plan")');
await bob.waitForSelector('.doc-content');
ok(await until(async () => (await bob.textContent('.doc-content')).includes('Hello from Alice')), 'bob opens alice’s content');
await bob.locator('.doc-content').click();
await bob.keyboard.press('End');
await bob.keyboard.type(' Bob was here.');
ok(await until(async () => (await bob.textContent('.save-status')).includes('Saved and shared')), 'bob’s edit is uploaded');

await alice.bringToFront();
await pull(alice);
ok(await until(async () => (await alice.textContent('.doc-content')).includes('Bob was here')), 'alice receives bob’s changes');

// --- Alice makes Bob a viewer ----------------------------------------------------
await alice.click('.btn-share');
await alice.waitForSelector('.share-people li:has-text("bob@example.com") select');
await alice.selectOption('.share-people li:has-text("bob@example.com") select', 'view');
await alice.waitForTimeout(300);
await alice.click('.modal-footer button:has-text("Done")');
await bob.reload();
await bob.waitForSelector('.view-only-banner');
ok((await bob.locator('.doc-content').getAttribute('contenteditable')) === 'false', 'viewer cannot type');
ok((await bob.locator('.menubar-btn:has-text("Insert")').count()) === 0, 'viewer has no Insert/Format menus');
await shot(bob, '53-view-only');

// --- Carol: no access, then access via link --------------------------------------
const carol = await open('carol');
await signUp(carol, 'carol@example.com');
await carol.goto(link);
await carol.waitForSelector('text=You don’t have access');
ok(true, 'carol is refused while link sharing is off');
await alice.click('.btn-share');
await alice.waitForSelector('select[aria-label="General access"]:not([disabled])');
await alice.selectOption('select[aria-label="General access"]', 'view');
await alice.waitForTimeout(300);
await shot(alice, '54-link-sharing');
await alice.click('.modal-footer button:has-text("Done")');
await carol.goto(link);
await carol.reload();
await carol.waitForSelector('.view-only-banner');
ok((await carol.textContent('.doc-content')).includes('Hello from Alice'), 'carol opens it with the link (view only)');
await carol.click('button[aria-label="Back to documents"]');
await carol.waitForSelector('.doc-card:has-text("Team plan")');
ok(true, 'link-opened doc is kept in carol’s documents');

// --- Alice removes Bob; Bob keeps a private copy -----------------------------------
await bob.evaluate(() => {
  new MutationObserver(() => {
    const seen = JSON.parse(sessionStorage.getItem('test-toasts') || '[]');
    document.querySelectorAll('.toast').forEach((t) => seen.push(t.textContent));
    sessionStorage.setItem('test-toasts', JSON.stringify(seen));
  }).observe(document.body, { childList: true, subtree: true });
});
await alice.click('.btn-share');
await alice.waitForSelector('.share-people li:has-text("bob@example.com") select');
await alice.selectOption('.share-people li:has-text("bob@example.com") select', 'remove');
await alice.waitForSelector('.share-people li:has-text("bob@example.com")', { state: 'detached' });
await alice.selectOption('select[aria-label="General access"]', 'none');
await alice.waitForTimeout(300);
await alice.click('.modal-footer button:has-text("Done")');
// Bob's open tab may notice on its own (it checks every 15s) before the reload does,
// so record every message Bob is shown, before and after reloading.
const watchToasts = (p) =>
  p.evaluate(() => {
    const seen = JSON.parse(sessionStorage.getItem('test-toasts') || '[]');
    new MutationObserver(() => {
      document.querySelectorAll('.toast').forEach((t) => seen.push(t.textContent));
      sessionStorage.setItem('test-toasts', JSON.stringify(seen));
    }).observe(document.body, { childList: true, subtree: true });
  });
await bob.reload();
await bob.waitForSelector('.doc-content');
await watchToasts(bob);
const detached = await until(async () => (await bob.textContent('.save-status')).trim() === 'Saved');
ok(detached, 'removed person keeps a private, unshared copy');
const toasts = await bob.evaluate(() => JSON.parse(sessionStorage.getItem('test-toasts') || '[]'));
ok(toasts.some((t) => t.includes('This is now your private copy')), 'removed person is told their access ended');
ok((await bob.locator('.doc-content').getAttribute('contenteditable')) === 'true', 'private copy is editable again');

// --- Sign out ----------------------------------------------------------------
await alice.click('button[aria-label="Back to documents"]');
await alice.click('.account-btn');
await alice.click('.menu-item:has-text("Sign out")');
await alice.waitForSelector('.login-card');
ok(true, 'sign out returns to the login page');
await alice.fill('input[type=email]', 'alice@example.com');
await alice.fill('input[type=password]', 'secret123');
await alice.click('.login-submit');
await alice.waitForSelector('.doc-card:has-text("Team plan")');
ok(true, 'signing back in shows alice’s documents again');

// --- The desktop/mobile apps: sign-in is optional ------------------------------------
// Same fake server (same browser profile), but this tab reports itself as the Electron app.
const app = await ctx.newPage();
app.on('pageerror', (e) => errors.push(`app: ${e.message}`));
await app.addInitScript(() => {
  Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 Chrome/140 Electron/39.8.10 Safari/537.36' });
  sessionStorage.removeItem('inkwell-fake-session');
});
await app.goto(URL);
await app.waitForSelector('.lib-header');
ok((await app.locator('.login-card').count()) === 0, 'app opens straight to documents (no login)');
ok(await app.locator('.btn-signin').isVisible(), 'app shows an optional Sign in button');
await app.click('.btn-new');
await app.waitForSelector('.doc-content');
await app.locator('.doc-content').click();
await app.keyboard.type('Written in the Mac app.');
await app.fill('.ed-title', 'App notes');
await app.keyboard.press('Enter');
await app.click('.btn-share');
await app.waitForSelector('.login-card');
ok((await app.locator('text=Email me a sign-in link').count()) === 0, 'app login hides the web-only email-link option');
await app.click('.login-links button:has-text("Cancel")');
await app.waitForSelector('.doc-content');
ok((await app.textContent('.doc-content')).includes('Written in the Mac app'), 'cancelling sign-in returns to the document');
await app.click('.btn-share');
await app.waitForSelector('.login-card');
await app.fill('input[type=email]', 'bob@example.com');
await app.fill('input[type=password]', 'secret123');
await app.click('.login-submit');
await app.waitForSelector('.doc-content');
ok((await app.textContent('.doc-content')).includes('Written in the Mac app'), 'after signing in the app returns to the same document');
await app.click('.btn-share');
await app.waitForSelector('.share-url input');
const appLink = await app.inputValue('.share-url input');
ok(appLink.startsWith('https://tkfam151.github.io/notetaking-app/#/shared/'), 'links made in the app point to the website');
await app.fill('.share-invite input', 'carol@example.com');
await app.selectOption('.share-invite select', 'view');
await app.click('.share-invite button:has-text("Invite")');
await app.waitForSelector('.share-people li:has-text("carol@example.com")');
await app.click('.modal-footer button:has-text("Done")');
await carol.goto(URL);
await carol.click('.nav-item:has-text("Shared")');
ok(await until(() => carol.locator('.doc-card:has-text("App notes")').isVisible()), 'web user sees a document shared from the app');
await app.click('button[aria-label="Back to documents"]');
await app.waitForSelector('.doc-card:has-text("App notes")');
await app.click('.account-btn');
await app.click('.menu-item:has-text("Sign out")');
await app.waitForSelector('.btn-signin');
ok((await app.locator('.doc-card:has-text("App notes")').count()) === 1, 'signing out in the app keeps documents on the device');
ok((await app.locator('.login-card').count()) === 0, 'signing out in the app does not show a login wall');

ok(errors.length === 0, `no browser errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
