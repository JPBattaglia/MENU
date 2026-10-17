/* Local lab measurement only. Never submits a form or writes to a remote account. */
const { chromium } = require(process.env.MENU_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const base = process.env.MENU_LAB_BASE || 'http://127.0.0.1:8877';
const pages = ['index.html', 'services.html', 'portfolio.html', 'contact.html'];
const settings = { runs: 3, viewport: { width: 390, height: 844 }, cpuSlowdown: 4,
  latencyMs: 150, downloadBytesPerSecond: 200000, uploadBytesPerSecond: 93750,
  settleMs: 2000, cacheDisabled: true, deviceScaleFactor: 1, analyticsOptOut: 'DNT' };
const watched = [...pages, 'main.css', 'site-nav.js', 'start.js', 'booking.js', 'funnel.js', 'home-package.js', 'mm-a11y-widget.js', 'assets/accessibility-launcher-192.webp'];
const digest = () => Object.fromEntries(watched.filter(file => fs.existsSync(path.join(root, file)))
  .map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
const before = digest();
const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length/2)];
const number = (value, digits = 0) => value === null || value === undefined ? 'n/a' : value.toFixed(digits);
const range = (rows, field, digits = 0) => {
  const values = rows.map(row => row[field]).filter(value => typeof value === 'number');
  return values.length ? number(median(values), digits) + ' (' + number(Math.min(...values), digits) + '–' + number(Math.max(...values), digits) + ')' : 'n/a';
};

(async () => {
  const started = new Date().toISOString();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const chromeVersion = browser.version();
  const results = [];
  try {
    for (let run = 1; run <= settings.runs; run++) for (const file of pages) {
      const context = await browser.newContext({ viewport: settings.viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true, extraHTTPHeaders: { DNT: '1' } });
      const page = await context.newPage();
      const session = await context.newCDPSession(page);
      await session.send('Network.enable');
      await session.send('Network.setCacheDisabled', { cacheDisabled: true });
      await session.send('Network.emulateNetworkConditions', { offline: false, latency: settings.latencyMs,
        downloadThroughput: settings.downloadBytesPerSecond, uploadThroughput: settings.uploadBytesPerSecond });
      await session.send('Emulation.setCPUThrottlingRate', { rate: settings.cpuSlowdown });
      let bytes = 0, failedRequests = 0, httpErrors = 0, pageErrors = 0;
      session.on('Network.loadingFinished', event => { bytes += event.encodedDataLength; });
      session.on('Network.loadingFailed', () => { failedRequests++; });
      session.on('Network.responseReceived', event => { if (event.response.status >= 400) httpErrors++; });
      page.on('pageerror', () => { pageErrors++; });
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'doNotTrack', { configurable: true, get: () => '1' });
        const state = { lcp: null, shifts: [], tasks: [], events: [], interactionStart: Infinity };
        window.__menuLab = state;
        const observe = (type, callback, options = {}) => {
          try { new PerformanceObserver(list => list.getEntries().forEach(callback)).observe({ type, buffered: true, ...options }); } catch {}
        };
        observe('largest-contentful-paint', entry => { state.lcp = entry.startTime; });
        observe('layout-shift', entry => { if (!entry.hadRecentInput) state.shifts.push({ time: entry.startTime, value: entry.value }); });
        observe('longtask', entry => { state.tasks.push({ time: entry.startTime, duration: entry.duration }); });
        observe('event', entry => { if (entry.interactionId) state.events.push({ time: entry.startTime, duration: entry.duration, interactionId: entry.interactionId }); }, { durationThreshold: 16 });
      });
      await page.goto(base + '/' + file, { waitUntil: 'load', timeout: 60000 });
      await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 5000))]));
      await page.waitForTimeout(settings.settleMs);
      const metrics = await page.evaluate(() => {
        const state = window.__menuLab, nav = performance.getEntriesByType('navigation')[0];
        const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
        let cls = 0, sum = 0, start = null, last = 0;
        state.shifts.forEach(shift => {
          if (start !== null && shift.time-last < 1000 && shift.time-start < 5000) sum += shift.value;
          else { sum = shift.value; start = shift.time; }
          last = shift.time; cls = Math.max(cls, sum);
        });
        const cutoff = performance.now();
        const blocking = state.tasks.filter(task => task.time >= (fcp ?? 0) && task.time < cutoff)
          .reduce((total, task) => total + Math.max(0, task.duration - 50), 0);
        return { ttfbMs: nav.responseStart, fcpMs: fcp, lcpMs: state.lcp, cls,
          loadMs: nav.loadEventEnd, observedBlockingMs: blocking, observationEndMs: cutoff };
      });
      const startupBytes = bytes;
      await page.evaluate(() => { window.__menuLab.interactionStart = performance.now(); });
      const toggle = page.locator('button.gear-burger');
      let interactionMs = null, menuOpened = false;
      if (await toggle.count()) {
        await toggle.tap();
        await page.waitForTimeout(500);
        menuOpened = await toggle.getAttribute('aria-expanded') === 'true';
        interactionMs = await page.evaluate(() => {
          const values = window.__menuLab.events.filter(event => event.time >= window.__menuLab.interactionStart).map(event => event.duration);
          return values.length ? Math.max(...values) : null;
        });
      }
      const result = { page: file, run, ...metrics, transferBytes: startupBytes,
        interactionMs, menuOpened, failedRequests, httpErrors, pageErrors };
      results.push(result);
      process.stdout.write(JSON.stringify(result) + '\n');
      await context.close();
    }
  } finally { await browser.close(); }
  const after = digest();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Site source changed during measurement; rerun after integration settles.');
  const report = { started, finished: new Date().toISOString(), chromeVersion, settings,
    host: { platform: os.platform(), architecture: os.arch(), cpu: os.cpus()[0]?.model }, sourceDigests: after, results };
  fs.writeFileSync('/tmp/menu-performance-baseline.json', JSON.stringify(report, null, 2));
  const summary = pages.map(file => {
    const rows = results.filter(row => row.page === file);
    return '| ' + file + ' | ' + range(rows, 'ttfbMs') + ' | ' + range(rows, 'fcpMs') + ' | ' + range(rows, 'lcpMs') + ' | ' + range(rows, 'cls', 3) + ' | ' + range(rows, 'loadMs') + ' | ' + range(rows, 'observedBlockingMs') + ' | ' + range(rows, 'interactionMs') + ' | ' + Math.round(median(rows.map(row => row.transferBytes)) / 1024) + ' |';
  }).join('\n');
  const rows = results.map(row => '| ' + row.page + ' | ' + row.run + ' | ' + number(row.fcpMs) + ' | ' + number(row.lcpMs) + ' | ' + number(row.cls,3) + ' | ' + number(row.observedBlockingMs) + ' | ' + number(row.interactionMs) + ' | ' + row.failedRequests + '/' + row.httpErrors + '/' + row.pageErrors + ' |').join('\n');
  const failures = results.reduce((sum,row) => sum+row.failedRequests+row.httpErrors+row.pageErrors,0);
  const markdown = `# Local mobile lab baseline\n\nMeasured ${started} through ${report.finished}, using Chrome ${chromeVersion} on ${report.host.platform}/${report.host.architecture} (${report.host.cpu}). This is a controlled local-development baseline, not production field data, a Lighthouse score, or a prediction for every customer's device.\n\n## Method\n\n- Local origin: ${base}; static HTML routes avoid production redirects/CDN/DNS/TLS effects.\n- Four pages, three runs each in interleaved page order; each run uses a fresh browser context with cache disabled.\n- Mobile viewport 390×844 CSS pixels, touch/mobile emulation, device scale factor 1, and 4× Chrome CPU slowdown relative to this host. This is not a calibrated physical phone.\n- Chrome network throttle: 150ms latency, 200,000 bytes/second download (1.6Mbps), 93,750 bytes/second upload (0.75Mbps). Google fonts and other page-requested assets load normally under those conditions.\n- Observe initial load through document load, font readiness (up to five additional seconds), and a two-second settling period. No scrolling, inquiry submission, checkout creation, or payment. Anonymous analytics is opted out with DNT set in both the request header and navigator; localhost is also outside the collector's host allowlist.\n- After the load snapshot, tap the mobile navigation button once and observe Event Timing for 500ms. A missing interaction duration means no qualifying Event Timing entry was recorded at the 16ms observer threshold; it is not a zero measurement.\n- Source hashes were checked before/after; no watched source changed during this measurement. Network/resource/JavaScript error count across all runs: ${failures}.\n\n## Median results (minimum–maximum)\n\nAll timings are milliseconds; CLS is unitless; bytes are Chrome's encoded transferred bytes, reported as KiB.\n\n| Page | TTFB | FCP | Observed LCP | Initial CLS | Load event | Observed blocking | Menu interaction | Transfer KiB |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${summary}\n\nTTFB here is navigation responseStart from navigation start. LCP is the last largest-contentful-paint entry during the initial observation; CLS is the largest shift-session sum using a one-second gap and five-second cap, excluding shifts with recent input. Observed blocking sums the portions over 50ms of long tasks starting after FCP and before the snapshot. That observation-window metric is not Lighthouse Total Blocking Time (which uses its own measurement window). Menu interaction is one scripted interaction's longest recorded Event Timing duration, not a field INP score.\n\n## Individual runs\n\n| Page | Run | FCP | Observed LCP | Initial CLS | Observed blocking | Menu interaction | Failed requests / HTTP errors / JS errors |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n${rows}\n\n## Interpretation and follow-up\n\nUse this baseline to compare later revisions under the same conditions. The local static server does not measure the deployed host or real traffic, and three runs are descriptive rather than statistically representative. Initial CLS does not cover an entire visit. External font delivery, host contention, Chrome versions, and the CPU/network emulator can affect results. No real-user Core Web Vitals pass/fail claim or INP claim is made. Recheck the deployed canonical pages separately and use sufficiently populated field data when available.\n\nGoogle distinguishes lab and field results in its [measurement guidance](https://web.dev/articles/vitals-measurement-getting-started) and defines the CLS session window in its [CLS explanation](https://web.dev/articles/cls). Chrome documents [throttling controls](https://developer.chrome.com/docs/devtools/settings/throttling).\n\n## Reproduce\n\nWith Playwright and Google Chrome available, serve the repository locally, then run \`node booking-api/measure-performance.cjs\`. Set \`MENU_LAB_BASE\` for a different local origin and \`MENU_PLAYWRIGHT_MODULE\` if Playwright is provided outside normal module resolution. The runner updates this report and writes detailed raw observations plus source hashes to \`/tmp/menu-performance-baseline.json\`. Set MENU_LAB_COMPARE to an earlier raw JSON capture to append a comparison under matching settings. It does not send measurements to an external analytics service.\n`;
  let finalMarkdown = markdown;
  if (process.env.MENU_LAB_COMPARE) {
    const previous = JSON.parse(fs.readFileSync(process.env.MENU_LAB_COMPARE, 'utf8'));
    if (JSON.stringify(previous.settings) !== JSON.stringify(settings)) throw new Error('Comparison conditions differ; do not claim a matched baseline.');
    const comparison = pages.map(file => {
      const oldRows = previous.results.filter(row => row.page === file);
      const newRows = results.filter(row => row.page === file);
      const oldBytes = median(oldRows.map(row => row.transferBytes));
      const newBytes = median(newRows.map(row => row.transferBytes));
      return '| ' + file + ' | ' + number(median(oldRows.map(row => row.fcpMs))) + ' / ' + number(median(newRows.map(row => row.fcpMs)))
        + ' | ' + number(median(oldRows.map(row => row.lcpMs))) + ' / ' + number(median(newRows.map(row => row.lcpMs)))
        + ' | ' + number(median(oldRows.map(row => row.cls)),3) + ' / ' + number(median(newRows.map(row => row.cls)),3)
        + ' | ' + number(median(oldRows.map(row => row.loadMs))) + ' / ' + number(median(newRows.map(row => row.loadMs)))
        + ' | ' + Math.round(oldBytes/1024) + ' / ' + Math.round(newBytes/1024)
        + ' | ' + number((1-newBytes/oldBytes)*100,1) + '% |';
    }).join('\n');
    const oldIcon = fs.statSync(path.join(root, 'Brainard Icon menu Ruby.png')).size;
    const newIcon = fs.statSync(path.join(root, 'assets/accessibility-launcher-192.webp')).size;
    const comparisonSection = '\n## Before/after widget optimization\n\nBefore: ' + previous.started + ' through ' + previous.finished
      + '. After: ' + started + ' through ' + report.finished + '. Each dataset has twelve runs with the same settings. The widget launcher changed from a 900×891 PNG (' + oldIcon.toLocaleString('en-US')
      + ' bytes) to a 192×190 transparent lossless WebP (' + newIcon.toLocaleString('en-US') + ' bytes), a ' + number((1-newIcon/oldIcon)*100,2)
      + '% asset-byte reduction. The original artwork is preserved. Widget panel animation/outline styles and cache versions were also updated between datasets; this is not an isolated single-variable experiment.\n\n'
      + '| Page | FCP before / after (ms) | Observed LCP before / after (ms) | Initial CLS before / after | Load before / after (ms) | Transfer before / after (KiB) | Transfer reduction |\n'
      + '| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n' + comparison + '\n\n'
      + 'Transferred-byte reductions are directly observed. Timing differences are descriptive local-lab observations with ordinary font/network/host variation, not evidence of real-user speed or field Core Web Vitals. The first run set may have overlapped other local browser verification; the second did not. Do not attribute every timing difference solely to the icon. Full before/after observations remain in /tmp/menu-performance-before-widget.json and /tmp/menu-performance-after-widget.json.\n';
    finalMarkdown += comparisonSection;
    fs.writeFileSync('/tmp/menu-performance-after-widget.json', JSON.stringify(report, null, 2));
  }
  fs.writeFileSync(path.join(__dirname, 'PERFORMANCE-BASELINE.md'), finalMarkdown);
  console.log('Saved booking-api/PERFORMANCE-BASELINE.md and /tmp/menu-performance-baseline.json');
})().catch(error => { console.error(error); process.exitCode = 1; });
