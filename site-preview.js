// Free site generator preview (owner, Nov 5, 2026). Uploads the menu the same way checkout does (stored, no emails),
// then asks the worker to build the site. booking-api/src/marketing/website-preview.js holds the limits.
// Rep mode (a signed link from the owner's email, kept on this device by menu-preview.js) skips the limits.
(() => {
  'use strict';
  const form = document.getElementById('siteTryForm');
  if (!form) return;
  // A plan with Website Care (Pro, or your own plan) starts here (owner, Nov 8, 2026): keep it on this device so the
  // checkout that "Choose this site" opens has it ready (start.js reads mm-site-then).
  const then = new URLSearchParams(location.search).get('then');
  if (then && then.length < 400) {
    try { localStorage.setItem('mm-site-then', JSON.stringify({ q: then, at: Date.now() })); } catch { /* storage off */ }
    const q = new URLSearchParams(then);
    const names = { BUNDLE_PRO: 'Pro plan', WEBSITE_CARE: 'Website Care' };
    const label = q.get('custom') ? 'your own plan' : (names[q.get('plan')] || 'your plan');
    const note = document.createElement('p');
    note.className = 'mm-try-rep';
    note.textContent = `Step 1: pick your site here. Your ${label} comes with it to checkout.`;
    form.prepend(note);
  }
  const $ = id => document.getElementById(id);
  const status = $('siteTryStatus');
  const button = $('siteTryBtn');
  const API = window.MenuMadeCatalog?.API || '';
  let busy = false;
  let upload = null; // { key, requestId } so a retry doesn't upload the same file twice
  let rep = new URLSearchParams(location.search).get('rep') || '';
  try { if (rep) localStorage.setItem('mm-rep', rep); else rep = localStorage.getItem('mm-rep') || ''; } catch { /* storage off */ }
  if (rep) {
    const label = form.querySelector('label[for="site_email"]');
    if (label) label.textContent = 'Email (we send you the link)';
    $('site_email').required = false;
    const note = document.createElement('p');
    note.className = 'mm-try-rep';
    note.textContent = 'Rep mode is on for this device.';
    form.prepend(note);
  }

  const say = (html, isError = false) => { stopWait(); status.innerHTML = html; status.classList.toggle('is-error', isError); };

  // Loading animation while the preview is made (owner, Nov 12, 2026): the MΞNU gear turning, what is happening now,
  // and the seconds so far, so the wait never looks stuck. Returns a stop function; say() then replaces it.
  let waitTimer = null;
  const stopWait = () => { if (waitTimer) { clearInterval(waitTimer); waitTimer = null; } };
  const showWait = (steps, expect) => {
    stopWait();
    const started = Date.now();
    status.classList.remove('is-error');
    status.innerHTML = '<span class="mm-wait"><img class="mm-wait-gear" src="MENU=.png" alt="" width="56" height="56">'
      + '<span class="mm-wait-text"><strong class="mm-wait-step"></strong><span class="mm-wait-time"></span></span></span>';
    const step = status.querySelector('.mm-wait-step'), time = status.querySelector('.mm-wait-time');
    const tick = () => {
      const s = Math.floor((Date.now() - started) / 1000);
      step.textContent = steps[Math.min(steps.length - 1, Math.floor(s / 15))];
      time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · ${expect}. Keep this page open.`;
    };
    tick();
    waitTimer = setInterval(tick, 1000);
  };
  const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const business = $('site_business').value.trim();
    const email = $('site_email').value.trim() || (rep ? 'info@menu-made.com' : '');
    const file = $('site_file').files[0];
    if (!business) { say('Add your business name.', true); $('site_business').focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say('Add an email address we can send the link to.', true); $('site_email').focus(); return; }
    if (!file) { say('Choose your menu file (a PDF or a photo).', true); $('site_file').focus(); return; }
    if (!/\.(pdf|png|jpe?g|webp)$/i.test(file.name)) { say('Previews work from a PDF or a photo (PNG, JPEG or WebP).', true); return; }
    busy = true; button.disabled = true; button.textContent = 'Sending your menu…';
    showWait(['Sending your menu…'], 'a few seconds');
    try {
      window.MenuMadeDocuments.validate(file);
      const key = [business, email.toLowerCase(), await window.MenuMadeDocuments.fingerprint(file)].join('|');
      if (!upload || upload.key !== key) {
        const requestId = crypto.randomUUID();
        await window.MenuMadeDocuments.send({ type: 'inquiry', purpose: 'checkout', service: 'Other project', name: business, business, email,
          notes: 'Free website preview', website: $('site_hp').value, requestId }, file);
        upload = { key, requestId };
      }
      button.textContent = 'Building your website…';
      showWait(['Reading your menu…', 'Writing your pages…', 'Building your website in every design…', 'Almost there…'], 'usually about a minute');
      window.MenuMadeFunnel?.track?.('website_preview_start');
      const response = await fetch(API + '/api/website-preview/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: upload.requestId, email, business, phone: $('site_phone').value, address: $('site_address').value,
          hours: $('site_hours').value, website: $('site_current').value, city: $('site_city')?.value || '', tracking: window.MenuMadeFunnel?.tracking?.() || {}, ...(rep ? { rep } : {}), ...(window.MenuMadeSandbox === true ? { sandbox: true } : {}) })
      });
      const result = await response.json().catch(() => null);
      if (response.ok && result?.ok && result.url) {
        window.MenuMadeFunnel?.track?.('website_preview_ready');
        if (rep) say(`Ready in ${esc(result.seconds ?? '?')} seconds. <a class="btn primary" href="${esc(result.url)}" target="_blank" rel="noopener">Show my website<span class="mm-sr"> (opens in a new tab)</span></a> The link is emailed too.`);
        else say(`Your website preview is ready. <a class="btn primary" href="${esc(result.url)}" target="_blank" rel="noopener">Open my website<span class="mm-sr"> (opens in a new tab)</span></a> We’ve emailed you the link too.`);
        return;
      }
      if (result?.used && result.start) { say(`${esc(result.error)} <a class="btn ghost" href="${esc(result.start)}">Start my order</a>`, true); return; }
      if (response.status === 410 || response.status === 404) upload = null;
      say(esc(result?.error || 'Something went wrong making your preview. Please try again.'), true);
    } catch (error) {
      say(esc(error?.message || 'Something went wrong. Please try again.'), true);
    } finally {
      stopWait();
      busy = false; button.disabled = false; button.textContent = 'Generate my site';
    }
  });
})();
