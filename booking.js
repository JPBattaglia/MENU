(() => {
  'use strict';
  const form = document.getElementById('bookingForm');
  if (!form) return;
  const status = document.getElementById('bookingStatus');
  const submit = document.getElementById('bookingSubmit');
  const toast = document.getElementById('bookingToast');
  const dismiss = document.getElementById('bookingDismiss');
  function showStatus(message) {
    status.textContent = message;
    toast.hidden = false;
  }
  dismiss.addEventListener('click', () => { toast.hidden = true; });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !toast.hidden) toast.hidden = true;
  });
  let submitting = false;
  let requestId = '';
  let requestPayload = '';
  let received = false;
  const receipts = [];
  let previousReceiptNotice = null;
  const serviceChoices = {
    'Online Menu + QR': { slug: 'online_menu_qr', backend: 'Online Menu + QR' },
    'Conversion Fix': { slug: 'conversion_fix', backend: 'Conversion Fix' },
    'Google Visibility': { slug: 'google_visibility', backend: 'Google Visibility' },
    'Accessibility Upgrade': { slug: 'accessibility_upgrade', backend: 'Accessibility Upgrade' },
    website: { slug: 'website', backend: 'Other project', title: 'Website Design & Custom Builds' },
    app: { slug: 'app', backend: 'Other project', title: 'Mobile app project' },
    'Other project': { slug: 'other', backend: 'Other project' }
  };
  form.addEventListener('menumade:quote-intent', event => {
    const kind = event.detail?.service;
    if (!['website', 'app'].includes(kind)) return;
    if (submitting) { event.preventDefault(); return; }
    if (!received) return;
    const lastReceipt = receipts.at(-1);
    if (lastReceipt?.service === kind) {
      event.preventDefault();
      showStatus(`Your ${serviceChoices[kind].title} inquiry was already received. Reference: ${lastReceipt.reference}. We’ll reply with the next steps.`);
      return;
    }
    // Selecting another quote is explicit new-project intent. Keep the prior
    // receipt visible, while a new submission gets its own idempotency key.
    received = false;
    requestId = '';
    requestPayload = '';
    form.querySelectorAll('input, select, textarea, button').forEach(control => { control.disabled = false; });
    submit.textContent = 'Send inquiry';
    if (!previousReceiptNotice) {
      previousReceiptNotice = document.createElement('p');
      previousReceiptNotice.className = 'mini';
      previousReceiptNotice.setAttribute('role', 'status');
      form.prepend(previousReceiptNotice);
    }
    previousReceiptNotice.textContent = 'Previous inquiries received: ' + receipts.map(receipt => receipt.reference).join(', ') + '. This new inquiry will receive a separate reference.';
    toast.hidden = true;
  });
  form.addEventListener('submit', async event => {
    if (submitting || received) { event.preventDefault(); return; }
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const rawService = data.get('service');
    if (!Object.hasOwn(serviceChoices, rawService)) { showStatus('Please choose a service.'); return; }
    const serviceChoice = serviceChoices[rawService];
    if (!data.get('name').trim()) {
      showStatus('Please enter your name.');
      document.getElementById('bookingName').focus();
      return;
    }
    const payload = {
      type: 'inquiry', service: serviceChoice.backend,
      name: data.get('name').trim(), email: data.get('email').trim(),
      business: data.get('business').trim(), notes: data.get('notes').trim(),
      website: data.get('website') || ''
    };
    if (!payload.notes) {
      showStatus('Please enter your project details.');
      document.getElementById('bookingNotes').focus();
      return;
    }
    if (serviceChoice.title) payload.notes = (`Project: ${serviceChoice.title}\n` + payload.notes).slice(0, 1200);
    const file = document.getElementById('bookingDocument').files[0];
    submitting = true;
    const controls = [...form.querySelectorAll('input, select, textarea, button')];
    const outsideControls = [...document.querySelectorAll('[data-quote-service], .js-add')].map(control => [control, control.disabled]);
    outsideControls.forEach(([control]) => { control.disabled = true; });
    controls.forEach(control => { control.disabled = true; });
    form.setAttribute('aria-busy', 'true');
    submit.textContent = 'Sending…';
    showStatus('Sending your project inquiry…');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const fileFingerprint = await window.MenuMadeDocuments.fingerprint(file);
      // Include file contents when deciding whether a retry is the same request.
      const serialized = JSON.stringify(payload) + fileFingerprint;
      if (serialized !== requestPayload) { requestId = crypto.randomUUID(); requestPayload = serialized; }
      if (serviceChoice.title) window.MenuMadeFunnel?.track('quote_started', serviceChoice.slug);
      window.MenuMadeFunnel?.track('inquiry_attempt', serviceChoice.slug);
      const result = await window.MenuMadeDocuments.send({ ...payload, requestId }, file, controller.signal);
      received = true;
      receipts.push({ service: serviceChoice.slug, reference: result.requestId });
      window.MenuMadeFunnel?.track('inquiry_received', serviceChoice.slug);
      if (serviceChoice.title) window.MenuMadeFunnel?.track('quote_received', serviceChoice.slug);
      submit.textContent = 'Inquiry received';
      showStatus(`Your project inquiry was received. Reference: ${result.requestId}. We’ll reply with the next steps.`);
    } catch (error) {
      showStatus(error.name === 'AbortError'
        ? 'The connection timed out. Please try again; retrying the same request will not create a duplicate.'
        : (error instanceof TypeError
          ? 'Connection failed. Please check your connection and try again.' : error.message));
      submit.textContent = 'Try again';
    } finally {
      clearTimeout(timeout);
      submitting = false;
      form.removeAttribute('aria-busy');
      outsideControls.forEach(([control, disabled]) => { control.disabled = disabled; });
      if (!received) controls.forEach(control => { control.disabled = false; });
    }
  });
})();
