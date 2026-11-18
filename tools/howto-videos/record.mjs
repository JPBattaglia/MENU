// Records the how-to videos beside the free generators (menu, website, holiday) and writes them to assets/video/.
// Owner, Nov 15, 2026: the videos must show the current generators, including Customize's "Items and prices" and the
// translated menus that come with paid plans. Any change to a generator's screens means re-running this.
//
//   cd booking-api && npm ci && cd ..           (or a global `npm i -g playwright`)
//   node --no-warnings --import ./tools/howto-videos/stand-ins/register.mjs tools/howto-videos/record.mjs [menu|website|holiday]
//
// Needs Google Chrome (or Playwright's Chromium) and ffmpeg. HOWTO_FONTS_DIR=<google/fonts ofl folder> serves the
// fonts from disk where Google Fonts can't be reached. Everything runs against local-site.mjs: the repo's own pages
// and worker with a throwaway database, so nothing is counted, emailed or charged.
//
// Look (kept from the Nov 12 videos): 1920x1080, the page in a rounded teal frame on dark navy, a pointer that moves
// and taps, and a two-line caption underneath (eyebrow + one instruction). No sound.
import { holidayDollars, holidayPrices } from "../../booking-api/src/checkout/holiday.js";
import { mkdirSync, rmSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from './pw.mjs';
import { startLocalSite, ROOT } from './local-site.mjs';
import { SAMPLE, SAMPLE_MENU, HOLIDAY_MENU, seedPlusAccount } from './sample.mjs';

const W = 1920, H = 1080;
const VIEW = { width: 1512, height: 850 };            // the page inside the frame
const AT = { x: (W - VIEW.width) / 2, y: 24 };         // where it sits in the video
const CAP_Y = AT.y + VIEW.height + 12;                 // the caption strip, below the frame
const OUT = process.env.HOWTO_OUT || join(ROOT, 'assets/video');
const SAMPLES = new URL('./samples/', import.meta.url).pathname;
const FPS = 30;

// ---- the pointer, drawn inside the page (a manual popover, so it stays above an open dialog) -------------------
const CURSOR_SCRIPT = `(() => {
  const make = () => {
    if (document.getElementById('howto-cursor') || !document.body) return;
    const c = document.createElement('div'); c.id = 'howto-cursor'; c.setAttribute('popover', 'manual');
    c.innerHTML = '<svg width="34" height="40" viewBox="0 0 17 20"><path d="M1 1v15.5l4.2-4 2.7 6.3 2.6-1.1-2.7-6.2h5.9z" fill="#fff" stroke="#071f2c" stroke-width="1.3" stroke-linejoin="round"/></svg><span></span>';
    c.style.cssText = 'position:fixed;inset:auto;left:0;top:0;margin:0;padding:0;border:0;background:none;overflow:visible;pointer-events:none;z-index:2147483647;transform:translate(var(--x,-100px),var(--y,-100px));filter:drop-shadow(0 2px 3px rgba(0,0,0,.45));width:34px;height:40px';
    const s = document.createElement('style');
    s.textContent = '#howto-cursor span{position:absolute;left:-17px;top:-17px;width:34px;height:34px;border-radius:50%;border:3px solid #22d3e6;opacity:0;transform:scale(.4)}#howto-cursor.tap span{animation:howto-tap .5s ease-out}@keyframes howto-tap{0%{opacity:1;transform:scale(.4)}100%{opacity:0;transform:scale(1.6)}}';
    document.head.append(s); document.body.append(c);
    try { const p = JSON.parse(sessionStorage.getItem('howto-xy') || 'null'); if (p) { c.style.setProperty('--x', p[0] + 'px'); c.style.setProperty('--y', p[1] + 'px'); } } catch {}
    try { c.showPopover(); } catch {}
  };
  window.__howto = {
    move(x, y) { make(); const c = document.getElementById('howto-cursor'); c.style.setProperty('--x', x + 'px'); c.style.setProperty('--y', y + 'px'); try { sessionStorage.setItem('howto-xy', JSON.stringify([x, y])); } catch {} },
    tap() { const c = document.getElementById('howto-cursor'); if (!c) return; c.classList.remove('tap'); void c.offsetWidth; c.classList.add('tap'); },
    top() { make(); const c = document.getElementById('howto-cursor'); try { c.hidePopover(); c.showPopover(); } catch {} }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', make); else make();
  document.addEventListener('toggle', () => setTimeout(() => window.__howto.top(), 0), true);
})();`;

// ---- a recording session: Chrome, screencast frames, captions with times ---------------------------------------
async function session(local, { cookie = null } = {}) {
  const browser = await chromium.launch({ channel: process.env.HOWTO_CHROME_CHANNEL || 'chrome', args: local.launchArgs })
    .catch(() => chromium.launch({ args: local.launchArgs }));
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'America/Los_Angeles' });
  await local.blockOthers(context);
  if (cookie) await context.addCookies([cookie]);
  await context.addInitScript(CURSOR_SCRIPT);
  // The full-screen holiday pop-up (holiday-popup.js) would cover each step; it already skips ad visitors, so the
  // recording counts as one.
  await context.addInitScript(() => { try { sessionStorage.setItem('mm-ad-visit', '1'); } catch {} });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('  page error:', e.message));

  const frameDir = join(tmpdir(), `howto-frames-${Date.now()}`);
  mkdirSync(frameDir, { recursive: true });
  const frames = [];
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = join(frameDir, `${String(frames.length).padStart(6, '0')}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata.timestamp, wall: Date.now() / 1000 });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await page.goto('about:blank');
  let started = 0;
  const captions = [];
  let mouse = { x: VIEW.width * 0.62, y: VIEW.height * 0.55 };
  const now = () => Date.now() / 1000;

  const s = {
    page,
    async start() {
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VIEW.width, maxHeight: VIEW.height, everyNthFrame: 1 });
      started = now();
    },
    // A new caption from now on.
    cap(eyebrow, text) { captions.push({ t: now() - started, eyebrow, text }); },
    wait: (ms) => page.waitForTimeout(ms),
    async goto(url) { await page.goto(url, { waitUntil: 'load' }); await page.evaluate(() => document.fonts.ready); await s.sync(); await s.wait(300); },
    async sync() { await page.evaluate(([x, y]) => window.__howto?.move(x, y), [mouse.x, mouse.y]).catch(() => {}); },
    // Glide the pointer to the middle of an element (scrolling it into view first if needed).
    async moveTo(target, { dx = 0, dy = 0, ms = 700 } = {}) {
      const loc = typeof target === 'string' ? page.locator(target).first() : target;
      await loc.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(async (e) => { await page.screenshot({ path: join(tmpdir(), 'howto-failed.png') }).catch(() => {}); throw e; });
      const box = await loc.boundingBox();
      if (!box) { await page.screenshot({ path: join(tmpdir(), 'howto-failed.png') }).catch(() => {}); throw new Error(`not visible: ${target}`); }
      const to = { x: box.x + Math.min(box.width / 2, 120) + dx, y: box.y + box.height / 2 + dy };
      const steps = Math.max(8, Math.round(ms / 16));
      for (let i = 1; i <= steps; i++) {
        const k = i / steps, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        const x = mouse.x + (to.x - mouse.x) * e, y = mouse.y + (to.y - mouse.y) * e;
        await page.mouse.move(x, y);
        await page.evaluate(([a, b]) => window.__howto?.move(a, b), [x, y]).catch(() => {});
        await page.waitForTimeout(16);
      }
      mouse = to;
      return loc;
    },
    async tap(target, opts = {}) {
      const loc = await s.moveTo(target, opts);
      await s.wait(150);
      await page.evaluate(() => window.__howto?.tap()).catch(() => {});
      await loc.click({ position: undefined, noWaitAfter: true });
      await s.wait(opts.after ?? 450);
      return loc;
    },
    async type(target, text) {
      const loc = await s.tap(target, { after: 150 });
      await loc.pressSequentially(text, { delay: 55 });
      await s.wait(250);
    },
    async chooseFile(target, file) {
      const chooser = page.waitForEvent('filechooser');
      await s.tap(target, { after: 100 });
      await (await chooser).setFiles(file);
      await s.wait(500);
    },
    // Smooth scroll so an element sits `offset` px from the top.
    async scrollTo(target, { offset = 90, ms = 1100 } = {}) {
      const y = await page.locator(target).first().evaluate((el, off) => el.getBoundingClientRect().top + window.scrollY - off, offset);
      await page.evaluate(([top, dur]) => new Promise((done) => {
        const from = window.scrollY, t0 = performance.now();
        const step = (t) => { const k = Math.min(1, (t - t0) / dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; window.scrollTo(0, from + (top - from) * e); if (k < 1) requestAnimationFrame(step); else done(); };
        requestAnimationFrame(step);
      }), [y, ms]);
      await s.wait(250);
    },
    async scrollBy(dy, { ms = 1000, within = null } = {}) {
      await page.evaluate(([d, dur, sel]) => new Promise((done) => {
        const el = sel ? document.querySelector(sel) : null;
        const get = () => el ? el.scrollTop : window.scrollY, set = (v) => el ? (el.scrollTop = v) : window.scrollTo(0, v);
        const from = get(), t0 = performance.now();
        const step = (t) => { const k = Math.min(1, (t - t0) / dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; set(from + d * e); if (k < 1) requestAnimationFrame(step); else done(); };
        requestAnimationFrame(step);
      }), [dy, ms, within]);
      await s.wait(250);
    },
    async finish() {
      await s.wait(1200);
      const end = now();
      await cdp.send('Page.stopScreencast').catch(() => {});
      await browser.close();
      return { frames, frameDir, captions, started, end };
    }
  };
  return s;
}

// ---- compositing: frames -> video, then frame + captions -> 1920x1080 mp4 ---------------------------------------
async function renderOverlays(captions, dir) {
  const browser = await chromium.launch({ channel: process.env.HOWTO_CHROME_CHANNEL || 'chrome' }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const fontCss = process.env.HOWTO_FONTS_DIR ? `@font-face{font-family:Inter;font-weight:100 900;src:url(file://${process.env.HOWTO_FONTS_DIR}/inter/${encodeURIComponent('Inter[opsz,wght].ttf')})}` : '';
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // One frame layer (background, teal frame, rounded corners; the page shows through the middle) and one opaque strip
  // per caption, cut from the same background, laid only over the caption area. Cheap to overlay on every frame.
  const html = (c) => `<!doctype html><html><head><style>${fontCss}
      html,body{margin:0;width:${W}px;height:${H}px;background:transparent;overflow:hidden;font-family:Inter,system-ui,sans-serif}
      .bg{position:absolute;inset:0;background:radial-gradient(1200px 700px at 50% 40%,#0a3a4c 0%,#06283a 55%,#041d2a 100%);
        -webkit-mask:linear-gradient(#000 0 0) exclude,linear-gradient(#000 0 0) ${AT.x}px ${AT.y}px/${VIEW.width}px ${VIEW.height}px no-repeat;
        mask:linear-gradient(#000 0 0) exclude,linear-gradient(#000 0 0) ${AT.x}px ${AT.y}px/${VIEW.width}px ${VIEW.height}px no-repeat}
      .frame{position:absolute;left:${AT.x - 4}px;top:${AT.y - 4}px;width:${VIEW.width}px;height:${VIEW.height}px;border:4px solid #22c8d6;border-radius:18px;
        box-shadow:0 18px 50px rgba(0,0,0,.45)}
      .corner{position:absolute;width:18px;height:18px}
      .cap{position:absolute;left:${AT.x}px;right:${AT.x}px;top:${AT.y + VIEW.height + 36}px;color:#fff}
      .eb{font-weight:700;font-size:23px;letter-spacing:1.5px;color:#22d3e6;text-transform:uppercase;margin:0 0 12px}
      .tx{font-weight:600;font-size:${c && c.text.length > 80 ? 34 : 40}px;line-height:1.25;margin:0}
    </style></head><body><div class="bg"></div><div class="frame"></div>
    ${c ? `<div class="cap"><p class="eb">${esc(c.eyebrow)}</p><p class="tx">${esc(c.text)}</p></div>` : ''}</body></html>`;
  await page.setContent(html(null));
  // Round the page's corners: paint the background colour into the four corners outside the frame's radius.
  await page.evaluate(([at, v]) => {
    const r = 18; const bg = '#06283a';
    for (const [x, y, rot] of [[at.x, at.y, 0], [at.x + v.width - r, at.y, 90], [at.x + v.width - r, at.y + v.height - r, 180], [at.x, at.y + v.height - r, 270]]) {
      const d = document.createElement('div'); d.className = 'corner';
      d.style.cssText = `left:${x}px;top:${y}px;background:radial-gradient(circle at ${rot === 0 || rot === 270 ? '100%' : '0'} ${rot < 180 ? '100%' : '0'}, transparent ${r - 1}px, ${bg} ${r}px)`;
      document.body.append(d);
    }
  }, [AT, VIEW]);
  const frame = join(dir, 'frame.png');
  await page.screenshot({ path: frame, omitBackground: true });
  const strips = [];
  for (const [i, c] of captions.entries()) {
    await page.setContent(html(c));
    const file = join(dir, `caption-${i}.png`);
    await page.screenshot({ path: file, clip: { x: 0, y: CAP_Y, width: W, height: H - CAP_Y } });
    strips.push(file);
  }
  await browser.close();
  return { frame, strips };
}

// The opening card and poster (owner, Nov 15, 2026: "Use this"): his MΞNU logo on its deep red, the video's name
// under it. brand/menu-logo-red.jpg is his artwork, trimmed of the screenshot edge.
const TITLE_SECONDS = 2.5;
async function titleCard(title, file) {
  const logo = `data:image/jpeg;base64,${readFileSync(new URL('./brand/menu-logo-red.jpg', import.meta.url)).toString('base64')}`;
  const browser = await chromium.launch({ channel: process.env.HOWTO_CHROME_CHANNEL || 'chrome' }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(`<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Philosopher:wght@400;700&display=block"><style>
    html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:linear-gradient(#600400,#3a0000)}
    img{position:absolute;left:0;top:0;width:${W}px;-webkit-mask:linear-gradient(#000 80%,transparent);mask:linear-gradient(#000 80%,transparent)}
    p{position:absolute;left:0;right:0;top:880px;margin:0;text-align:center;font:700 64px/1.1 Philosopher,Georgia,serif;letter-spacing:1px;
      color:#eaf6fb;text-shadow:0 2px 0 #0a3f55,0 8px 24px rgba(0,0,0,.55)}
    small{display:block;margin-top:14px;font:400 30px Philosopher,Georgia,serif;letter-spacing:3px;color:#bfe3ef;text-transform:uppercase}
  </style></head><body><img src="${logo}"><p>${title}<small>How it works · captioned, no sound</small></p></body></html>`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
  await browser.close();
}

async function compose(name, rec, { poster = 0.5, title = name } = {}) {
  const dir = rec.frameDir;
  // Frames come only when the page changes (sometimes 50+ a second); each lasts until the next one. Resampled here
  // to exactly FPS: output frame k shows the newest capture at or before k/FPS (ffmpeg's concat list would give each
  // image at least 1/25 s, so a busy stretch drifted behind the captions).
  const list = rec.frames.filter((f) => f.t >= rec.started - 0.05);
  if (!list.length) throw new Error('no frames recorded');
  const seq = join(dir, 'seq');
  mkdirSync(seq, { recursive: true });
  const count = Math.ceil((rec.end - rec.started) * FPS);
  for (let k = 0, j = 0; k < count; k++) {
    const at = rec.started + k / FPS;
    while (j + 1 < list.length && list[j + 1].t <= at) j++;
    symlinkSync(list[j].file, join(seq, `${String(k).padStart(6, '0')}.jpg`));
  }
  const { frame, strips } = await renderOverlays(rec.captions, dir);
  const total = rec.end - rec.started;
  const inputs = ['-framerate', String(FPS), '-i', join(seq, '%06d.jpg'), '-loop', '1', '-framerate', String(FPS), '-i', frame];
  for (const o of strips) inputs.push('-loop', '1', '-framerate', String(FPS), '-i', o);
  let filter = `color=c=#06283a:s=${W}x${H}:r=${FPS}:d=${total.toFixed(2)}[base];[0:v]setpts=PTS-STARTPTS[page];[base][page]overlay=${AT.x}:${AT.y}:shortest=1[p0];[p0][1:v]overlay=0:0:shortest=1[v0]`;
  rec.captions.forEach((c, i) => {
    const until = i + 1 < rec.captions.length ? rec.captions[i + 1].t : total + 1;
    filter += `;[v${i}][${i + 2}:v]overlay=0:${CAP_Y}:shortest=1:enable='between(t,${c.t.toFixed(2)},${until.toFixed(2)})'[v${i + 1}]`;
  });
  const mp4 = join(OUT, `${name}.mp4`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', filter, '-map', `[v${rec.captions.length}]`, '-an',
    '-c:v', 'libx264', '-preset', process.env.HOWTO_PRESET || 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(FPS), mp4], { stdio: 'inherit' });
  // Opening card: held, then a short cross-fade into the walkthrough. The card is also the poster.
  const card = join(dir, 'title.jpg');
  await titleCard(title, card);
  const body = join(dir, 'body.mp4');
  execFileSync('mv', [mp4, body]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-framerate', String(FPS), '-t', String(TITLE_SECONDS + 0.5), '-i', card, '-i', body,
    '-filter_complex', `[0:v]fps=${FPS},format=yuv420p,setsar=1,settb=AVTB[a];[1:v]fps=${FPS},format=yuv420p,setsar=1,settb=AVTB[b];[a][b]xfade=transition=fade:duration=0.5:offset=${TITLE_SECONDS}[v]`,
    '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', process.env.HOWTO_PRESET || 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(FPS), mp4], { stdio: 'inherit' });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', card, '-vf', 'scale=1280:-2', '-q:v', '4', join(OUT, `${name}-poster.jpg`)]);
  rmSync(dir, { recursive: true, force: true });
  console.log(`${name}: ${total.toFixed(1)}s -> ${mp4}`);
}

// ---- the three videos ---------------------------------------------------------------------------------------
async function openFromHome(s, eyebrow, nav) {
  await s.goto('https://menu-made.com/');
  await s.start();
  s.cap(eyebrow, `Go to menu-made.com and open ${nav}.`);
  await s.wait(1300);
  await s.tap(`#primaryNav a:text-is("${nav}")`, { after: 200 });
  await s.page.waitForLoadState('load'); await s.sync(); await s.wait(900);
}

async function menuVideo(local) {
  const E = 'Menu generator';
  local.setMenu(SAMPLE_MENU);
  const acct = await seedPlusAccount(local);
  const s = await session(local, { cookie: acct.cookie });
  await openFromHome(s, E, 'Menus');
  s.cap(E, 'Scroll to the free preview. Add your business name and email.');
  await s.scrollTo('#try-free', { offset: 40 });
  await s.type('#try_business', SAMPLE.business);
  await s.type('#try_email', SAMPLE.email);
  s.cap(E, 'Choose your menu: a PDF, or a clear photo of it.');
  await s.chooseFile('#try_file', join(SAMPLES, 'bella-luna-menu.pdf'));
  s.cap(E, 'Tap Generate menu. Reading it takes about a minute (sped up here).');
  await s.tap('#tryBtn', { after: 300 });
  await s.page.waitForSelector('#tryStatus a', { timeout: 60000 });
  await s.wait(900);
  s.cap(E, 'Open your menu. It starts in the Classic design.');
  const href = await s.page.locator('#tryStatus a').first().getAttribute('href');
  await s.moveTo('#tryStatus a'); await s.page.evaluate(() => window.__howto.tap()); await s.wait(300);
  await s.goto(href);
  await s.wait(1200);
  await s.scrollBy(520, { ms: 1400 }); await s.wait(500); await s.scrollBy(-520, { ms: 900 });
  s.cap(E, 'Tap Generate menu to see the next design. There are 9 to choose from.');
  for (let i = 0; i < 3; i++) { await s.tap('.mm-gen-next', { after: 0 }); await s.page.waitForLoadState('load'); await s.sync(); await s.wait(1700); }
  s.cap(E, 'Customize adds your logo and colour. All 9 designs update.');
  await s.tap('.mm-gen-own', { after: 700 });
  await s.chooseFile('#mm-own input[name=logo]', join(SAMPLES, 'bella-luna-logo.png'));
  await s.tap('#mm-own input[name=use_brand]', { after: 300 });
  await s.page.locator('#mm-own input[name=brand]').evaluate((el) => { el.value = '#2f6f5a'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await s.wait(500);
  s.cap(E, 'Items and prices: fix anything we read wrong, or change a price.');
  await s.tap('#mm-own .mm-own-items summary', { after: 600 });
  await s.scrollBy(330, { within: '#mm-own', ms: 900 });
  const price = s.page.locator('#mm-items .mm-it-row').nth(1).locator('input').nth(1);
  await s.tap(price, { after: 150 });
  await price.press('Control+A'); await price.pressSequentially('14', { delay: 120 });
  await s.wait(700);
  s.cap(E, 'Tap Update all 9 designs. Your changes show in every design.');
  await s.tap('#mm-own button[type=submit]', { after: 0 });
  await s.page.waitForURL(/menu-preview\/view/, { timeout: 30000 }).catch(() => {});
  await s.page.waitForLoadState('load'); await s.sync(); await s.wait(1800);
  await s.moveTo(s.page.getByText('Avocado Toast').first(), { dx: 300 }); await s.wait(1300);
  s.cap(E, 'Start free: the Classic design goes live with its own link and QR code.');
  await s.moveTo('.mm-gen-free button'); await s.wait(2600);
  s.cap(E, 'Or Make it live with MΞNU Plus: any design, the print set, other languages.');
  await s.moveTo('.mm-gen-pick'); await s.wait(2800);
  s.cap('Your menu, live', 'Once your menu is live, open Your account and tap Edit your menu.');
  await s.goto('https://menu-made.com/account.html');
  await s.wait(900);
  await s.tap('a:has-text("Edit your menu")', { after: 0 });
  await s.page.waitForLoadState('load'); await s.sync(); await s.wait(1200);
  s.cap('Your menu, live', 'Change a price or mark an item sold out any time, then tap Save.');
  // The Latte's price and the orange juice's Sold out box (the editor draws its fields from the menu, so find them by value).
  await s.page.evaluate(() => {
    for (const input of document.querySelectorAll('.mm-edit-item input[type=text]')) {
      if (input.value === 'Latte') input.closest('.mm-edit-item').querySelectorAll('input[type=text]')[1].dataset.howto = 'latte-price';
      if (input.value === 'Fresh Orange Juice') input.closest('.mm-edit-item').querySelector('input[type=checkbox]').dataset.howto = 'oj-sold';
    }
  });
  await s.scrollTo('[data-howto=latte-price]', { offset: 330, ms: 1600 });
  const latte = s.page.locator('[data-howto=latte-price]');
  await s.tap(latte, { after: 150 }); await latte.press('Control+A'); await latte.pressSequentially('5.50', { delay: 120 });
  await s.wait(400);
  await s.tap('[data-howto=oj-sold]', { after: 700 });
  await s.tap('#saveBottom', { after: 0 });
  // The editor says "Saved. Your live menu is updated: …"; hold on it so it can be read. No save, no video.
  await s.page.waitForFunction(() => /^Saved/.test(document.getElementById('saveStatus')?.textContent || ''), null, { timeout: 15000 });
  await s.wait(2200);
  s.cap('Other languages · MΞNU Plus and Pro', 'Below, pick up to 5 languages and tap Save languages.');
  await s.scrollTo('h2:has-text("other languages")', { offset: 120 });
  await s.tap(s.page.locator('label:has-text("Español") input').first(), { after: 300 });
  await s.tap(s.page.locator('label:has-text("Français") input').first(), { after: 400 });
  await s.tap('button:has-text("Save languages")', { after: 1600 });
  s.cap('Other languages · MΞNU Plus and Pro', 'Guests tap their language at the top of your menu.');
  await s.goto(acct.hosted);
  await s.wait(1200);
  await s.tap('nav.mm-langs a[lang=es]', { after: 0 });
  await s.page.waitForLoadState('load'); await s.sync();
  await s.wait(3400);
  return compose('menu-generator', await s.finish(), { title: 'Menu generator' });
}

async function websiteVideo(local) {
  const E = 'Website generator';
  local.setMenu(SAMPLE_MENU);
  const s = await session(local);
  await openFromHome(s, E, 'Websites');
  s.cap(E, 'Scroll to Generate your site. Add your business name, city and email.');
  await s.scrollTo('#try-free', { offset: 40 });
  await s.type('#site_business', SAMPLE.business);
  await s.type('#site_city', 'San Francisco');
  await s.type('#site_email', SAMPLE.email);
  s.cap(E, 'Choose your menu: a PDF, or a clear photo of it.');
  await s.chooseFile('#site_file', join(SAMPLES, 'bella-luna-menu.pdf'));
  s.cap(E, 'Optional: add your phone, address and hours for the Contact page.');
  await s.tap('.mm-try-more summary', { after: 500 });
  await s.type('#site_phone', '(415) 555-0142');
  await s.type('#site_address', '210 Lunar Lane, San Francisco');
  await s.type('#site_hours', 'Mon-Fri: 7am-3pm');
  await s.page.locator('#site_hours').press('Enter');
  await s.page.locator('#site_hours').pressSequentially('Sat-Sun: 8am-2pm', { delay: 55 });
  await s.wait(500);
  s.cap(E, 'Tap Generate my site. It takes about a minute (sped up here).');
  await s.tap('#siteTryBtn', { after: 300 });
  await s.page.waitForSelector('#siteTryStatus a', { timeout: 90000 });
  await s.wait(900);
  s.cap(E, 'Open your site. Every page is built from your menu.');
  const href = await s.page.locator('#siteTryStatus a').first().getAttribute('href');
  await s.moveTo('#siteTryStatus a'); await s.page.evaluate(() => window.__howto.tap()); await s.wait(300);
  await s.goto(href);
  await s.wait(1300);
  await s.scrollBy(700, { ms: 1800 }); await s.wait(500); await s.scrollBy(-700, { ms: 1000 });
  s.cap(E, 'Tap Generate site to see the next design. There are 9 to choose from.');
  for (let i = 0; i < 3; i++) { await s.tap('.mm-gen-next', { after: 0 }); await s.page.waitForLoadState('load'); await s.sync(); await s.wait(1800); }
  s.cap(E, 'Customize: your logo, photos and colour, on every design.');
  await s.tap('.mm-gen-own', { after: 700 });
  await s.chooseFile('#mm-own input[name=logo]', join(SAMPLES, 'bella-luna-logo.png'));
  await s.wait(400);
  s.cap(E, 'Add a motto and About text, contact details, hours and social links.');
  await s.tap(s.page.locator('#mm-own summary', { hasText: 'Motto and About' }).first(), { after: 700 });
  const motto = s.page.locator('#mm-own input[name=motto]');
  await s.tap(motto, { after: 150 }); await motto.press('Control+A'); await motto.pressSequentially('Breakfast and lunch, made fresh daily', { delay: 50 });
  await s.wait(500);
  await s.tap(s.page.locator('#mm-own summary', { hasText: 'Social and order links' }).first(), { after: 600 });
  const insta = s.page.locator('#mm-own input[name=instagram]');
  if (await insta.count()) { await s.tap(insta, { after: 150 }); await insta.pressSequentially('@bellalunacafe', { delay: 60 }); }
  await s.wait(600);
  s.cap(E, 'Tap Update all 9 designs. Every design updates.');
  await s.tap('#mm-own button[type=submit]', { after: 0 });
  await s.page.waitForURL(/website-preview\/view/, { timeout: 90000 }).catch(() => {});
  await s.page.waitForLoadState('load'); await s.sync(); await s.wait(2200);
  s.cap(E, 'Choose this site on the one you want, then checkout.');
  await s.moveTo('.mm-gen-pick'); await s.wait(3000);
  return compose('website-generator', await s.finish(), { title: 'Website generator' });
}

async function holidayVideo(local) {
  const E = 'Holiday menu generator';
  local.setMenu(HOLIDAY_MENU);
  const s = await session(local);
  await s.goto('https://menu-made.com/holiday-menu.html');
  await s.start();
  s.cap(E, 'Open menu-made.com/holiday-menu, or tap See holiday menus on any page.');
  await s.wait(1600);
  s.cap(E, `Pick a holiday. Both is ${holidayDollars(holidayPrices().both_cents)} for a Christmas and a New Year's Eve menu.`);
  await s.scrollTo('#try-free', { offset: 40 });
  await s.tap('input[name=occasion][value=both]', { after: 900 });
  await s.tap('input[name=occasion][value=christmas]', { after: 500 });
  s.cap(E, 'Add your business name and email, and choose your holiday menu.');
  await s.type('#try_business', SAMPLE.business);
  await s.type('#try_email', SAMPLE.email);
  await s.chooseFile('#try_file', join(SAMPLES, 'bella-luna-christmas.pdf'));
  s.cap(E, 'Tap Generate menu. Reading it takes about a minute (sped up here).');
  await s.tap('#tryBtn', { after: 300 });
  await s.page.waitForSelector('#tryStatus a', { timeout: 60000 });
  await s.wait(900);
  const href = await s.page.locator('#tryStatus a').first().getAttribute('href');
  await s.moveTo('#tryStatus a'); await s.page.evaluate(() => window.__howto.tap()); await s.wait(300);
  s.cap(E, 'Your menu in the Christmas designs.');
  await s.goto(href);
  await s.wait(1200);
  await s.scrollBy(480, { ms: 1300 }); await s.wait(400); await s.scrollBy(-480, { ms: 900 });
  s.cap(E, 'Tap Generate menu to go through the holiday designs.');
  for (let i = 0; i < 3; i++) { await s.tap('.mm-gen-next', { after: 0 }); await s.page.waitForLoadState('load'); await s.sync(); await s.wait(1700); }
  s.cap(E, 'Customize adds your logo and colour, and lets you fix items and prices.');
  await s.tap('.mm-gen-own', { after: 700 });
  await s.chooseFile('#mm-own input[name=logo]', join(SAMPLES, 'bella-luna-logo.png'));
  await s.tap('#mm-own .mm-own-items summary', { after: 600 });
  await s.scrollBy(330, { within: '#mm-own', ms: 900 });
  const price = s.page.locator('#mm-items .mm-it-row').nth(0).locator('input').nth(1);
  await s.tap(price, { after: 150 });
  await price.press('Control+A'); await price.pressSequentially('16', { delay: 120 });
  await s.wait(600);
  await s.tap('#mm-own button[type=submit]', { after: 0 });
  await s.page.waitForURL(/menu-preview\/view/, { timeout: 30000 }).catch(() => {});
  await s.page.waitForLoadState('load'); await s.sync(); await s.wait(1800);
  s.cap(E, 'Like a design? Tap Make it live and checkout. Your file is already attached.');
  await s.moveTo('.mm-gen-pick'); await s.wait(3200);
  return compose('holiday-menu-generator', await s.finish(), { title: 'Holiday menu generator' });
}

const VIDEOS = { menu: menuVideo, website: websiteVideo, holiday: holidayVideo };
const want = process.argv.slice(2).filter((a) => VIDEOS[a]);
mkdirSync(OUT, { recursive: true });
for (const name of want.length ? want : Object.keys(VIDEOS)) {
  const local = await startLocalSite();
  try { await VIDEOS[name](local); }
  catch (error) { console.error(`${name} failed:`, error.message); process.exitCode = 1; }
  finally { local.close(); }
}
