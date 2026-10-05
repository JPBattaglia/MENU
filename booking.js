(() => {
  'use strict';
  const form = document.getElementById('bookingForm');
  if (!form) return;
  const date = document.getElementById('bookingDate');
  const session = document.getElementById('bookingSession');
  const slots = document.getElementById('bookingSlots');
  const summary = document.getElementById('bookingSummary');
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
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let selectedTime = '';
  function tomorrow() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  date.min = tomorrow();
  document.getElementById('bookingTimezone').textContent = `All times in your timezone: ${zone}. Choose a date first.`;
  function dateLabel() {
    return new Date(`${date.value}T12:00:00`).toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  }
  function update() {
    if (!submitting && !received) { status.textContent = ''; toast.hidden = true; }
    summary.textContent = date.value && date.validity.valid && selectedTime
      ? `${session.value} · ${dateLabel()} at ${selectedTime} (${zone}). Pending confirmation.`
      : 'Choose a date and time to build your request.';
  }
  date.addEventListener('change', () => {
    date.min = tomorrow();
    selectedTime = '';
    slots.replaceChildren();
    if (date.value && date.validity.valid) {
      ['9:00 AM', '10:00 AM', '11:00 AM', '1:00 PM', '2:00 PM', '3:00 PM'].forEach(time => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'booking-slot';
        button.textContent = time;
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => {
          selectedTime = time;
          slots.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
          update();
        });
        slots.append(button);
      });
    }
    update();
  });
  form.addEventListener('input', update);
  submit.disabled = false;
  form.addEventListener('submit', async event => {
    if (submitting || received) { event.preventDefault(); return; }
    event.preventDefault();
    date.min = tomorrow();
    if (!form.reportValidity()) return;
    if (!selectedTime) {
      showStatus('Please choose a preferred time.');
      slots.querySelector('button')?.focus();
      return;
    }
    const data = new FormData(form);
    if (!data.get('name').trim()) {
      showStatus('Please enter your name.');
      document.getElementById('bookingName').focus();
      return;
    }
    const payload = {
      session: session.value, date: date.value, time: selectedTime, timezone: zone,
      name: data.get('name').trim(), email: data.get('email').trim(),
      business: data.get('business').trim(), notes: data.get('notes').trim(),
      website: data.get('website') || ''
    };
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
    showStatus('Sending your session request…');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(form.action, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, requestId }), signal: controller.signal
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok !== true || typeof result.requestId !== 'string') {
        throw new Error(response.status === 429
          ? 'Too many requests. Please wait a few minutes before trying again.'
          : 'We could not confirm receipt. Please try again or contact info@menu-made.com.');
      }
      received = true;
      submit.textContent = 'Request received';
      showStatus(`Your request was received. Reference: ${result.requestId}. We’ll contact you to confirm availability. Your time is not yet confirmed.`);
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
