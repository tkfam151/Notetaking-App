// Renders public/icon.svg to the PNG sizes needed by the PWA, Electron and Capacitor.
// Uses Playwright's Chromium (no native image libraries required).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright'); // CJS require honours NODE_PATH / global installs
import { readFileSync, mkdirSync } from 'node:fs';

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
// Full-bleed square (iOS masks corners itself) and an Android adaptive-icon foreground layer.
const fullBleed = svg.replace('rx="112"', 'rx="0"');
const foreground = svg
  .replace(/<rect width="512" height="512"[^>]*\/>/, '')
  .replace(/<rect x="132"[^>]*\/>/, '')
  .replace('<path d="M256 112', '<g transform="translate(256 256) scale(0.62) translate(-256 -256)"><path d="M256 112')
  .replace('</svg>', '</g></svg>');
const targets = [
  ['public/icon-192.png', 192],
  ['public/icon-512.png', 512],
  ['public/apple-touch-icon.png', 180],
  ['build/icon.png', 1024],
  ['resources/icon.png', 1024],
  ['resources/icon-only.png', 1024, fullBleed],
  ['resources/icon-foreground.png', 1024, foreground],
  ['resources/icon-background.png', 1024, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4c6ef5"/><stop offset="1" stop-color="#3b2fb5"/></linearGradient></defs><rect width="512" height="512" fill="url(#bg)"/></svg>'],
];
mkdirSync('build', { recursive: true });
mkdirSync('resources', { recursive: true });
const browser = await chromium.launch();
for (const [out, size, source = svg] of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${source.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  await page.screenshot({ path: out, omitBackground: true });
  await page.close();
  console.log('wrote', out);
}
await browser.close();
