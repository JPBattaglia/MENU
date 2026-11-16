// A private stand-in for menu-made.com, used only to record the how-to videos (owner, Nov 15, 2026).
// Pages come from this repo's files and /api/* from the real menu-checkout worker (booking-api/src/worker.js),
// running in Node with the test database (node:sqlite) and in-memory file storage. So the videos always show the
// generators exactly as the code on master draws them, and nothing a recording does touches the live site, the
// live database, the Friday numbers or the public preview limits.
//
// Only the outside calls are stood in for: reading the menu file (Claude) returns the sample menu in sample.mjs,
// translations come back as a fixed sample, emails are dropped, and the mood photos are read from assets/mood.
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { fileURLToPath } from 'node:url';
import { createD1, createR2 } from '../../booking-api/test-support/d1.mjs';
import { SAMPLE_MENU, SAMPLE_TRANSLATIONS } from './sample.mjs';

// How long the stand-in takes to "read" a menu, so the wait screen shows briefly (the real read takes about a minute;
// the captions say it is sped up).
const READ_MS = Number(process.env.HOWTO_READ_MS || 3500);

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MIGRATIONS = join(ROOT, 'booking-api/migrations');

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

export async function startLocalSite({ fontsDir = process.env.HOWTO_FONTS_DIR || '' } = {}) {
  const DB = createD1();
  // schema.sql is the base; later migrations add tables some screens need (translations, accounts). A migration
  // whose tables are already there is skipped.
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    try { DB.raw.exec(readFileSync(join(MIGRATIONS, f), 'utf8')); } catch { /* already in schema.sql */ }
  }
  const env = { DB, ASSETS: createR2(), ANTHROPIC_API_KEY: 'sk-ant-local', RESEND_API_KEY: 're_local', PRODUCTION_RUNNER_SECRET: 'local-runner',
    BOOKING_FROM: 'Menu-made <updates@menu-made.example>', BOOKING_TO: 'owner@menu-made.example', BOOKING_RATE_SALT: 'local-salt' };
  const emails = [];
  let menu = SAMPLE_MENU;
  const { default: worker } = await import('../../booking-api/src/worker.js');

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input?.url || input));
    if (url.href === 'https://api.anthropic.com/v1/messages') return claude(init);
    if (url.host === 'api.resend.com') { try { emails.push(JSON.parse(init.body)); } catch { /* not JSON */ } return Response.json({ id: `em_${emails.length}` }); }
    if (url.host === 'menu-made.com' && !url.pathname.startsWith('/api/')) return staticFile(url);
    if (url.host === 'menu-made.com') return worker.fetch(new Request(url, init), env, { waitUntil() {}, passThroughOnException() {} });
    return new Response('offline', { status: 503 });
  };

  // Every Claude call the generators make, answered from the sample: the menu read (record_menu) and translations.
  async function claude(init) {
    const body = JSON.parse(init.body || '{}');
    const tool = body.tools?.[0]?.name;
    const usage = { input_tokens: 1, output_tokens: 1 };
    if (tool === 'record_menu') { await new Promise((ok) => setTimeout(ok, READ_MS)); return Response.json({ model: 'local', stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', id: 't1', name: tool, input: menu }] }); }
    const prompt = typeof body.messages?.[0]?.content === 'string' ? body.messages[0].content : JSON.stringify(body.messages?.[0]?.content || '');
    const list = /\n(\[[\s\S]*\])(\n|$)/.exec(prompt);
    if (list) {
      const lang = (/Target language: ([^.]+)\./.exec(prompt) || [])[1] || 'Spanish';
      const table = SAMPLE_TRANSLATIONS[lang.split(/[ (]/)[0]] || {};
      const texts = JSON.parse(list[1]);
      const out = texts.map((t) => table[t] || t);
      const input = { translations: out };
      return Response.json({ model: 'local', stop_reason: tool ? 'tool_use' : 'end_turn', usage,
        content: tool ? [{ type: 'tool_use', id: 't1', name: tool, input }] : [{ type: 'text', text: JSON.stringify(out) }] });
    }
    return Response.json({ model: 'local', stop_reason: 'end_turn', usage, content: [{ type: 'text', text: '{}' }] });
  }

  function staticFile(url) {
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    let file = join(ROOT, path);
    if (!existsSync(file) && !extname(path)) file += '.html';
    if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) return new Response('Not found', { status: 404 });
    return new Response(readFileSync(file), { headers: { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream' } });
  }

  // Google Fonts: on a normal machine the browser gets them from Google. Where Google can't be reached, a folder of
  // the font files (google/fonts layout: <dir>/<family>/<file>.ttf) can stand in, via HOWTO_FONTS_DIR.
  function fontCss(url) {
    const families = url.searchParams.getAll('family').map((f) => f.split(':')[0]);
    let css = '';
    for (const family of families) {
      const dir = join(fontsDir, family.toLowerCase().replace(/ /g, ''));
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.ttf'))) {
        const italic = /Italic/.test(f);
        const variable = /\[/.test(f);
        const weight = variable ? '100 900' : ({ Thin: 100, ExtraLight: 200, Light: 300, Regular: 400, Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800, Black: 900 }[(/-(\w+?)(Italic)?\.ttf$/.exec(f) || [])[1]] || 400);
        css += `@font-face{font-family:'${family}';font-style:${italic ? 'italic' : 'normal'};font-weight:${weight};font-display:block;src:url(https://fonts.gstatic.com/local/${family.toLowerCase().replace(/ /g, '')}/${encodeURIComponent(f)}) format('truetype');}\n`;
      }
    }
    return new Response(css, { headers: { 'Content-Type': 'text/css', 'Access-Control-Allow-Origin': '*' } });
  }

  // One handler for everything the recorded browser asks menu-made.com (and, with HOWTO_FONTS_DIR, Google Fonts).
  async function handle(request) {
    const url = new URL(request.url);
    if (fontsDir && url.host === 'fonts.googleapis.com') return fontCss(url);
    if (fontsDir && url.host === 'fonts.gstatic.com' && url.pathname.startsWith('/local/')) {
      const [, , fam, file] = url.pathname.split('/');
      return new Response(readFileSync(join(fontsDir, fam, decodeURIComponent(file))), { headers: { 'Content-Type': 'font/ttf', 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.pathname.startsWith('/api/')) return worker.fetch(new Request(`https://menu-made.com${url.pathname}${url.search}`, request), env, { waitUntil() {}, passThroughOnException() {} });
    return staticFile(url);
  }

  // A local HTTPS server (self-signed) that Chrome is pointed at for menu-made.com with --host-resolver-rules, so
  // uploads reach the worker byte for byte (Playwright's request interception drops file bodies).
  const dir = mkdtempSync(join(tmpdir(), 'howto-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=menu-made.com',
    '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  const server = createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, async (req, res) => {
    try {
      const chunks = []; for await (const c of req) chunks.push(c);
      if (process.env.HOWTO_DEBUG) console.log(req.method, req.url, JSON.stringify(req.headers));
      const host = String(req.headers.host || 'menu-made.com').split(':')[0];
      const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      headers.set('CF-Connecting-IP', '192.0.2.10'); // what Cloudflare adds in front of the live worker (a documentation address)
      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks);
      const out = await handle(new Request(`https://${host}${req.url}`, { method: req.method, headers, body }));
      const h = {}; out.headers.forEach((v, k) => { if (k !== 'set-cookie') h[k] = v; });
      const cookies = out.headers.getSetCookie?.() || []; if (cookies.length) h['set-cookie'] = cookies;
      res.writeHead(out.status, h); res.end(Buffer.from(await out.arrayBuffer()));
    } catch (error) { res.writeHead(500); res.end(String(error?.stack || error)); }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const port = server.address().port;
  const mapped = ['menu-made.com', 'www.menu-made.com', ...(fontsDir ? ['fonts.googleapis.com', 'fonts.gstatic.com'] : [])];
  // Launch options for Chrome, and a route that refuses every other host (analytics, ads tags, Stripe).
  const launchArgs = [`--host-resolver-rules=${mapped.map((h) => `MAP ${h} 127.0.0.1:${port}`).join(', ')}`, '--ignore-certificate-errors', '--no-proxy-server'];
  const blockOthers = (context) => context.route((u) => !mapped.includes(u.host) && !/^(data|blob):/.test(u.protocol), (r) => r.abort());

  return { env, emails, worker, handle, setMenu: (m) => { menu = m; }, launchArgs, blockOthers, close: () => { server.close(); globalThis.fetch = realFetch; } };
}
