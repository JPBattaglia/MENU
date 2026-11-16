// Makes the files the videos upload: a printed-style menu PDF and a logo PNG for the invented Bella Luna Cafe.
// Run: node tools/howto-videos/make-samples.mjs  (writes tools/howto-videos/samples/)
import { chromium } from './pw.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SAMPLE, SAMPLE_MENU, HOLIDAY_MENU } from './sample.mjs';

const OUT = fileURLToPath(new URL('./samples/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const menuPage = (menu, title) => `<!doctype html><html><head><style>
body { font-family: Georgia, serif; color: #2f4a3a; background: #f4ecd8; margin: 0; padding: 48px 64px; }
h1 { text-align: center; font-size: 40px; margin: 0 0 4px; letter-spacing: 1px; } .sub { text-align: center; margin: 0 0 28px; letter-spacing: 4px; font-size: 13px; }
.cols { columns: 2; column-gap: 48px; } section { break-inside: avoid; margin-bottom: 22px; }
h2 { font-size: 20px; border-bottom: 1px solid #2f4a3a; padding-bottom: 4px; letter-spacing: 2px; text-transform: uppercase; }
.i { display: flex; justify-content: space-between; font-weight: bold; margin-top: 10px; } .d { font-style: italic; font-size: 13px; }
.n { text-align: center; margin-top: 18px; font-size: 13px; }
</style></head><body><h1>${esc(SAMPLE.business)}</h1><p class="sub">${title}</p><div class="cols">
${menu.sections.map((s) => `<section><h2>${esc(s.name)}</h2>${s.items.map((i) => `<div class="i"><span>${esc(i.name)}</span><span>${esc(i.price)}</span></div>${i.description ? `<div class="d">${esc(i.description)}</div>` : ''}`).join('')}</section>`).join('')}
</div><p class="n">${esc(menu.notes)}</p></body></html>`;

const logoHtml = `<!doctype html><html><body style="margin:0;background:transparent">
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
<circle cx="300" cy="300" r="280" fill="#2f4a3a"/>
<path d="M360 150a160 160 0 1 0 0 300a130 130 0 1 1 0-300z" fill="#f2c45a"/>
<text x="300" y="520" text-anchor="middle" font-family="Georgia, serif" font-size="56" fill="#f4ecd8" letter-spacing="4">BELLA LUNA</text>
</svg></body></html>`;

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const page = await browser.newPage();
await page.setContent(menuPage(SAMPLE_MENU, 'MENU'));
await page.pdf({ path: OUT + 'bella-luna-menu.pdf', format: 'Letter', printBackground: true });
await page.setContent(menuPage(HOLIDAY_MENU, 'CHRISTMAS MENU'));
await page.pdf({ path: OUT + 'bella-luna-christmas.pdf', format: 'Letter', printBackground: true });
await page.setViewportSize({ width: 600, height: 600 });
await page.setContent(logoHtml);
await page.locator('svg').screenshot({ path: OUT + 'bella-luna-logo.png', omitBackground: true });
await browser.close();
console.log('samples written to', OUT);
