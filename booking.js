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
  form.addEventListener('submit', async event => {
    if (submitting || received) { event.preventDefault(); return; }
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    if (!data.get('name').trim()) {
      showStatus('Please enter your name.');
      document.getElementById('bookingName').focus();
      return;
    }
    const payload = {
      type: 'inquiry', service: data.get('service'),
      name: data.get('name').trim(), email: data.get('email').trim(),
      business: data.get('business').trim(), notes: data.get('notes').trim(),
      website: data.get('website') || ''
    };
    if (!payload.notes) {
      showStatus('Please enter your project details.');
      document.getElementById('bookingNotes').focus();
      return;
    }
    // Retain the same ID for retries after a lost response.
    const serialized = JSON.stringify(payload);
    if (serialized !== requestPayload) {
      requestId = crypto.randomUUID();
      requestPayload = serialized;
    }
    submitting = true;
    const controls = [...form.querySelectorAll('input, select, textarea, button')];
    controls.forEach(control => { control.disabled = true; });
    form.setAttribute('aria-busy', 'true');
    submit.textContent = 'Sending…';
    showStatus('Sending your project inquiry…');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(form.action, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, requestId }), signal: controller.signal
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok !== true || typeof result.requestId !== 'string') {
        const messages = {
          400: 'Please check your service, name, email, and project details. Your inquiry was not accepted.',
          403: 'This request was blocked. Please open https://menu-made.com/contact and try again.',
          404: 'The inquiry service is unavailable. Please contact info@menu-made.com.',
          409: 'This reference was already used for different details. Please reload the page before submitting again.',
          429: 'Too many requests. Please wait an hour before trying again.',
          503: 'The inquiry service could not save your request. Please try again later or contact info@menu-made.com.'
        };
        throw new Error(messages[response.status] || `Your inquiry could not be confirmed (error ${response.status}). Please contact info@menu-made.com.`);
      }
      received = true;
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
      if (!received) controls.forEach(control => { control.disabled = false; });
    }
  });
})();
