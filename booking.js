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
    const file = document.getElementById('bookingDocument').files[0];
    let fileFingerprint;
    submitting = true;
    try { fileFingerprint = await window.MenuMadeDocuments.fingerprint(file); }
    catch (error) { submitting = false; showStatus(error.message); return; }
    // Include file contents when deciding whether a retry is the same request.
    const serialized = JSON.stringify(payload) + fileFingerprint;
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
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const result = await window.MenuMadeDocuments.send({ ...payload, requestId }, file, controller.signal);
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
