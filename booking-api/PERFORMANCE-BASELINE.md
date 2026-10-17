# Local mobile lab baseline

Measured 2026-10-17T04:14:16.020Z through 2026-10-17T04:16:06.321Z, using Chrome 155.0.8059.84 on darwin/arm64 (Apple M1 Max). This is a controlled local-development baseline, not production field data, a Lighthouse score, or a prediction for every customer's device.

## Method

- Local origin: http://127.0.0.1:8877; static HTML routes avoid production redirects/CDN/DNS/TLS effects.
- Four pages, three runs each in interleaved page order; each run uses a fresh browser context with cache disabled.
- Mobile viewport 390×844 CSS pixels, touch/mobile emulation, device scale factor 1, and 4× Chrome CPU slowdown relative to this host. This is not a calibrated physical phone.
- Chrome network throttle: 150ms latency, 200,000 bytes/second download (1.6Mbps), 93,750 bytes/second upload (0.75Mbps). Google fonts and other page-requested assets load normally under those conditions.
- Observe initial load through document load, font readiness (up to five additional seconds), and a two-second settling period. No scrolling, inquiry submission, checkout creation, or payment. Anonymous analytics is opted out with DNT set in both the request header and navigator; localhost is also outside the collector's host allowlist.
- After the load snapshot, tap the mobile navigation button once and observe Event Timing for 500ms. A missing interaction duration means no qualifying Event Timing entry was recorded at the 16ms observer threshold; it is not a zero measurement.
- Source hashes were checked before/after; no watched source changed during this measurement. Network/resource/JavaScript error count across all runs: 0.

## Median results (minimum–maximum)

All timings are milliseconds; CLS is unitless; bytes are Chrome's encoded transferred bytes, reported as KiB.

| Page | TTFB | FCP | Observed LCP | Initial CLS | Load event | Observed blocking | Menu interaction | Transfer KiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| index.html | 1 (1–2) | 2452 (2432–2512) | 2452 (2432–2512) | 0.076 (0.000–0.076) | 5360 (5358–5366) | 0 (0–0) | 32 (32–32) | 1187 |
| services.html | 1 (1–1) | 2956 (2892–2972) | 4164 (4160–4236) | 0.000 (0.000–0.000) | 6306 (6304–6311) | 0 (0–0) | 32 (32–32) | 1371 |
| portfolio.html | 1 (1–1) | 2836 (2824–2844) | 2836 (2824–2844) | 0.033 (0.000–0.033) | 8412 (8405–8420) | 0 (0–0) | 32 (32–32) | 1781 |
| contact.html | 2 (1–2) | 2516 (2508–2528) | 2516 (2508–2528) | 0.001 (0.001–0.001) | 5554 (5554–5561) | 0 (0–0) | 32 (32–32) | 1234 |

TTFB here is navigation responseStart from navigation start. LCP is the last largest-contentful-paint entry during the initial observation; CLS is the largest shift-session sum using a one-second gap and five-second cap, excluding shifts with recent input. Observed blocking sums the portions over 50ms of long tasks starting after FCP and before the snapshot. That observation-window metric is not Lighthouse Total Blocking Time (which uses its own measurement window). Menu interaction is one scripted interaction's longest recorded Event Timing duration, not a field INP score.

## Individual runs

| Page | Run | FCP | Observed LCP | Initial CLS | Observed blocking | Menu interaction | Failed requests / HTTP errors / JS errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| index.html | 1 | 2512 | 2512 | 0.000 | 0 | 32 | 0/0/0 |
| services.html | 1 | 2972 | 4160 | 0.000 | 0 | 32 | 0/0/0 |
| portfolio.html | 1 | 2836 | 2836 | 0.033 | 0 | 32 | 0/0/0 |
| contact.html | 1 | 2508 | 2508 | 0.001 | 0 | 32 | 0/0/0 |
| index.html | 2 | 2452 | 2452 | 0.076 | 0 | 32 | 0/0/0 |
| services.html | 2 | 2956 | 4164 | 0.000 | 0 | 32 | 0/0/0 |
| portfolio.html | 2 | 2844 | 2844 | 0.033 | 0 | 32 | 0/0/0 |
| contact.html | 2 | 2516 | 2516 | 0.001 | 0 | 32 | 0/0/0 |
| index.html | 3 | 2432 | 2432 | 0.076 | 0 | 32 | 0/0/0 |
| services.html | 3 | 2892 | 4236 | 0.000 | 0 | 32 | 0/0/0 |
| portfolio.html | 3 | 2824 | 2824 | 0.000 | 0 | 32 | 0/0/0 |
| contact.html | 3 | 2528 | 2528 | 0.001 | 0 | 32 | 0/0/0 |

## Interpretation and follow-up

Use this baseline to compare later revisions under the same conditions. The local static server does not measure the deployed host or real traffic, and three runs are descriptive rather than statistically representative. Initial CLS does not cover an entire visit. External font delivery, host contention, Chrome versions, and the CPU/network emulator can affect results. No real-user Core Web Vitals pass/fail claim or INP claim is made. Recheck the deployed canonical pages separately and use sufficiently populated field data when available.

Google distinguishes lab and field results in its [measurement guidance](https://web.dev/articles/vitals-measurement-getting-started) and defines the CLS session window in its [CLS explanation](https://web.dev/articles/cls). Chrome documents [throttling controls](https://developer.chrome.com/docs/devtools/settings/throttling).

## Reproduce

With Playwright and Google Chrome available, serve the repository locally, then run `node booking-api/measure-performance.cjs`. Set `MENU_LAB_BASE` for a different local origin and `MENU_PLAYWRIGHT_MODULE` if Playwright is provided outside normal module resolution. The runner updates this report and writes detailed raw observations plus source hashes to `/tmp/menu-performance-baseline.json`. Set MENU_LAB_COMPARE to an earlier raw JSON capture to append a comparison under matching settings. It does not send measurements to an external analytics service.

## Before/after widget optimization

Before: 2026-10-17T03:57:41.331Z through 2026-10-17T04:00:49.927Z. After: 2026-10-17T04:14:16.020Z through 2026-10-17T04:16:06.321Z. Each dataset has twelve runs with the same settings. The widget launcher changed from a 900×891 PNG (1,345,362 bytes) to a 192×190 transparent lossless WebP (46,348 bytes), a 96.55% asset-byte reduction. The original artwork is preserved. Widget panel animation/outline styles and cache versions were also updated between datasets; this is not an isolated single-variable experiment.

| Page | FCP before / after (ms) | Observed LCP before / after (ms) | Initial CLS before / after | Load before / after (ms) | Transfer before / after (KiB) | Transfer reduction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| index.html | 2428 / 2452 | 2428 / 2452 | 0.076 / 0.076 | 11838 / 5360 | 2455 / 1187 | 51.7% |
| services.html | 2840 / 2956 | 4236 / 4164 | 0.000 / 0.000 | 12785 / 6306 | 2639 / 1371 | 48.0% |
| portfolio.html | 2808 / 2836 | 2808 / 2836 | 0.033 / 0.033 | 14893 / 8412 | 3049 / 1781 | 41.6% |
| contact.html | 2508 / 2516 | 2508 / 2516 | 0.001 / 0.001 | 12043 / 5554 | 2502 / 1234 | 50.7% |

Transferred-byte reductions are directly observed. Timing differences are descriptive local-lab observations with ordinary font/network/host variation, not evidence of real-user speed or field Core Web Vitals. The first run set may have overlapped other local browser verification; the second did not. Do not attribute every timing difference solely to the icon. Full before/after observations remain in /tmp/menu-performance-before-widget.json and /tmp/menu-performance-after-widget.json.
