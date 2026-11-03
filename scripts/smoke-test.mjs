// End-to-end smoke test: drives the built app in a real Chromium browser.
// Usage: npm run build && npx vite preview --port 4173 &  then  npm test
// Set SHOTS=dir to also save screenshots.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL = process.env.APP_URL ?? 'http://localhost:4173/';
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
};
const shot = (page, name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(URL);
await page.waitForSelector('text=Start a new document');
ok(true, 'library loads');

// --- Create a blank document and type ------------------------------------
await page.click('.btn-new');
await page.waitForSelector('.doc-content');
const ed = page.locator('.doc-content');
await ed.click();
await page.keyboard.type('# Inkwell test\n');
ok((await ed.locator('h1').textContent()) === 'Inkwell test', 'markdown shortcut makes a heading');

await page.keyboard.type('Hello ');
await page.keyboard.press(`${mod}+b`);
await page.keyboard.type('bold');
await page.keyboard.press(`${mod}+b`);
await page.keyboard.type(' and ');
await page.keyboard.press(`${mod}+i`);
await page.keyboard.type('italic');
await page.keyboard.press(`${mod}+i`);
await page.keyboard.type(' world.\n');
ok((await ed.locator('strong').textContent()) === 'bold', 'bold via shortcut');
ok((await ed.locator('em').textContent()) === 'italic', 'italic via shortcut');

await page.keyboard.type('- first item\nsecond item\n\n');
ok((await ed.locator('ul li').count()) === 2, 'bulleted list via markdown');
await page.keyboard.type('[ ] a task\n\n');
ok((await ed.locator('ul[data-type="taskList"] li').count()) === 1, 'checklist via markdown');

// Toolbar: font size, colour, alignment
await page.keyboard.type('Big centred text');
await page.keyboard.down('Shift');
await page.keyboard.press('Home');
await page.keyboard.up('Shift');
await page.fill('.tb-size', '24');
await page.press('.tb-size', 'Enter');
ok(
  await ed
    .locator('span[style*="font-size: 24pt"]')
    .waitFor({ timeout: 5000 })
    .then(() => true, () => false),
  'font size from toolbar',
);
await page.click('button[title="Align"]');
await page.click('.menu-item:has-text("Center")');
ok((await ed.locator('p[style*="text-align: center"]').count()) === 1, 'center alignment');
await page.keyboard.press('End');
await page.keyboard.press('Enter');

// Table
await page.click('button[aria-label="Insert table"]');
await page.click('button[aria-label="2 by 3 table"]');
ok((await ed.locator('table tr').count()) === 2, 'table inserted (2 rows)');
ok((await ed.locator('table tr').first().locator('th, td').count()) === 3, 'table has 3 columns');
await page.waitForSelector('.bubble button[title="Insert row below"]');
await page.click('.bubble button[title="Insert row below"]');
ok((await ed.locator('table tr').count()) === 3, 'table bubble menu adds a row');
await page.keyboard.type('cell text');

// Comment on the heading
await ed.locator('h1').click({ clickCount: 3 });
await page.click('button[aria-label^="Add comment"]');
await page.fill('.comment-compose textarea', 'Great title!');
await page.click('.comment-compose button:has-text("Comment")');
ok((await page.locator('.comment-card .comment-text').textContent()) === 'Great title!', 'comment added');
ok((await ed.locator('.comment-mark').count()) >= 1, 'commented text highlighted');
await shot(page, '10-editor-with-content');

// Drawing: draw two strokes and a rectangle, insert, then re-open and erase
const drag = async (pts) => {
  const box = await page.locator('.draw-canvas').boundingBox();
  const at = ([x, y]) => [box.x + box.width * x, box.y + box.height * y];
  await page.mouse.move(...at(pts[0]));
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...at(p), { steps: 6 });
  await page.mouse.up();
};
await ed.locator('table td').last().click();
await page.keyboard.press(`${mod}+End`);
await page.click('button[aria-label="Draw"]');
await page.waitForSelector('.draw-canvas');
await drag([[0.1, 0.2], [0.3, 0.5], [0.5, 0.3]]);
await page.click('button[aria-label="Colour #e03131"]');
await drag([[0.6, 0.6], [0.8, 0.7], [0.9, 0.5]]);
await page.click('button[aria-label="Rectangle"]');
await drag([[0.2, 0.6], [0.4, 0.85]]);
await shot(page, '15-drawing-dialog');
await page.click('.draw-header button:has-text("Insert")');
const drawingImg = ed.locator('img[data-drawing]');
await drawingImg.waitFor();
const d1 = JSON.parse(await drawingImg.getAttribute('data-drawing'));
ok(d1.strokes.length === 3, `drawing inserted with 3 strokes (${d1.strokes.length})`);
ok((await drawingImg.getAttribute('src')).startsWith('data:image/png'), 'drawing rendered as an image');
await drawingImg.dblclick();
await page.waitForSelector('.draw-header:has-text("Edit drawing")');
await page.click('button[aria-label="Eraser"]');
await drag([[0.3, 0.45], [0.3, 0.55]]);
await page.click('.draw-header button:has-text("Save")');
await page.waitForSelector('.draw-dialog', { state: 'detached' });
const d2 = JSON.parse(await ed.locator('img[data-drawing]').getAttribute('data-drawing'));
ok(d2.strokes.length === 2, `eraser removed a stroke on re-edit (${d2.strokes.length} left)`);
ok((await ed.locator('img[data-drawing]').count()) === 1, 'editing replaces the drawing instead of adding one');
await shot(page, '16-drawing-in-doc');

// Title
await page.fill('.ed-title', 'Smoke test doc');
await page.keyboard.press('Enter');

// Find & replace
await page.keyboard.press(`${mod}+h`);
await page.fill('input[aria-label="Find"]', 'world');
await page.waitForTimeout(100);
ok((await page.locator('.find-count').textContent()) === '1 of 1', 'find counts matches');
await page.fill('input[aria-label="Replace with"]', 'universe');
await page.click('.find-bar button:has-text("All")');
ok((await ed.textContent()).includes('universe'), 'replace all');
await page.click('button[aria-label="Close find"]');

// Version history
await page.keyboard.press(`${mod}+s`);
await page.waitForSelector('text=Version saved');
ok(true, 'save version with Ctrl/Cmd+S');

// Persistence: wait for autosave, then reload
await page.waitForSelector('.save-status:has-text("Saved")');
await page.waitForTimeout(800);
await page.reload();
await page.waitForSelector('.doc-content h1');
ok((await page.locator('.doc-content').textContent()).includes('universe'), 'content persists after reload');
ok((await page.inputValue('.ed-title')) === 'Smoke test doc', 'title persists after reload');
ok((await page.locator('.doc-content img[data-drawing]').count()) === 1, 'drawing persists after reload');

// --- Exports --------------------------------------------------------------
const outDir = join(tmpdir(), 'inkwell-exports');
mkdirSync(outDir, { recursive: true });
for (const [fmt, label] of [
  ['docx', 'Microsoft Word'],
  ['md', 'Markdown'],
  ['html', 'Web page'],
  ['txt', 'Plain text'],
  ['pdf', 'PDF document'],
  ['inkwell', 'Inkwell document'],
]) {
  await page.click('.btn-export');
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.click(`.menu-item:has-text("${label}")`),
  ]);
  const file = join(outDir, dl.suggestedFilename());
  await dl.saveAs(file);
  const buf = readFileSync(file);
  const okSig =
    fmt === 'docx' ? buf.subarray(0, 2).toString() === 'PK' : fmt === 'pdf' ? buf.subarray(0, 4).toString() === '%PDF' : buf.length > 20;
  ok(okSig && dl.suggestedFilename() === `Smoke test doc.${fmt}`, `export ${fmt} (${buf.length} bytes)`);
  if (fmt === 'docx') ok(buf.length > 20000, 'Word export includes the drawing image');
  if (fmt === 'md') {
    const md = buf.toString();
    ok(md.includes('# Inkwell test') && md.includes('**bold**') && md.includes('- [ ] a task') && md.includes('| --- |'), 'markdown content is correct');
  }
}

// --- Library: import, search, trash ---------------------------------------
await page.click('button[aria-label="Back to documents"]');
await page.waitForSelector('.doc-card');
ok((await page.locator('.doc-card .doc-title').first().textContent()) === 'Smoke test doc', 'doc listed in library');

const mdFile = join(outDir, 'Imported notes.md');
writeFileSync(mdFile, '# Imported heading\n\nSome **markdown** text.\n\n- [x] done task\n- [ ] open task\n');
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.btn-new-secondary')]);
await chooser.setFiles(mdFile);
await page.waitForSelector('.doc-content h1');
ok((await page.locator('.doc-content h1').textContent()) === 'Imported heading', 'markdown import');
ok((await page.locator('.doc-content li[data-checked="true"]').count()) === 1, 'markdown task list import');

const docxFile = join(outDir, 'Smoke test doc.docx');
await page.click('button[aria-label="Back to documents"]');
await page.waitForSelector('.doc-card');
const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), page.click('.btn-new-secondary')]);
await chooser2.setFiles(docxFile);
await page.waitForSelector('.doc-content h1');
ok((await page.locator('.doc-content').textContent()).includes('universe'), 'Word (.docx) round-trip import');
await page.click('button[aria-label="Back to documents"]');
await page.waitForSelector('.doc-card');

await page.fill('input[aria-label="Search documents"]', 'imported');
await page.waitForTimeout(100);
ok((await page.locator('.doc-card').count()) === 1, 'search filters documents');
await page.fill('input[aria-label="Search documents"]', '');

await page.locator('.doc-card').first().locator('button[aria-label^="More options"]').click();
await page.click('.menu-item:has-text("Move to trash")');
await page.click('.nav-item:has-text("Trash")');
ok((await page.locator('.doc-card').count()) === 1, 'trash shows trashed document');
await page.click('.nav-item:has-text("All documents")');
await shot(page, '11-library');

// --- Dark mode + mobile layout ----------------------------------------------
await page.click('button[aria-label="Settings"]');
await page.click('.segmented button:has-text("Dark")');
await page.keyboard.press('Escape');
ok((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'dark mode');
await shot(page, '12-library-dark');
await page.locator('.doc-card').first().click();
await page.waitForSelector('.doc-content');
await shot(page, '13-editor-dark');

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
ok(await page.locator('.page-fluid').isVisible(), 'phone layout uses reflowing page');
await shot(page, '14-phone-editor-dark');

ok(errors.length === 0, `no browser errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
