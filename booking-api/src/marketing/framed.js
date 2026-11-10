// Previews inside the Menu-made app (owner, Nov 10, 2026: "too much redirects to the website"). The app shows a
// generated menu or site in a frame on its own screen and draws the three generator buttons itself (Generate,
// Customize, Make it live / Choose this site), so a preview page that finds itself in a frame hides its own bar.
// Added as the page is served, so previews stored before this behave the same.
const FRAMED = `<script>if (window.top !== window.self) document.documentElement.classList.add("mm-framed");</script>
<style>.mm-framed .mm-preview, .mm-framed .mm-gen { display: none !important; } html.mm-framed body { padding-bottom: 0 !important; }</style>`;
const frameAware = (html) => String(html).replace("</head>", () => `${FRAMED}\n</head>`);

// The app sends Customize from its own form and reads the answer, where the web form follows a redirect.
const wantsJson = (request) => /application\/json/i.test(request.headers.get("Accept") || "");
const APP_CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Accept" };
const preflight = () => new Response(null, { status: 204, headers: APP_CORS });

export { frameAware, wantsJson, preflight, APP_CORS };
