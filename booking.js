(() => {
  'use strict';
  const form = document.getElementById('bookingForm');
  if (!form) return;
  const date = document.getElementById('bookingDate');
  const session = document.getElementById('bookingSession');
  const slots = document.getElementById('bookingSlots');
  const summary = document.getElementById('bookingSummary');
  const status = document.getElementById('bookingStatus');
  const mailLink = document.getElementById('bookingMailLink');
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
    status.textContent = '';
    mailLink.hidden = true;
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
  document.getElementById('bookingSubmit').disabled = false;
  form.addEventListener('submit', event => {
    event.preventDefault();
    date.min = tomorrow();
    if (!form.reportValidity()) return;
    if (!selectedTime) {
      status.textContent = 'Please choose a preferred time.';
      slots.querySelector('button')?.focus();
      return;
    }
    const data = new FormData(form);
    if (!data.get('name').trim()) {
      status.textContent = 'Please enter your name.';
      document.getElementById('bookingName').focus();
      return;
    }
    const body = `Hello MENU-MADE,\n\nI would like to request a session:\n\nSession: ${session.value}\nDate: ${dateLabel()}\nTime: ${selectedTime}\nTimezone: ${zone}\n\nName: ${data.get('name').trim()}\nEmail: ${data.get('email')}\nBusiness: ${data.get('business').trim() || 'Not provided'}\nNotes: ${data.get('notes').trim() || 'None'}\n\nPlease confirm availability. Thank you!`;
    const href = `mailto:info@menu-made.com?subject=${encodeURIComponent('MENU-MADE session request — ' + date.value)}&body=${encodeURIComponent(body)}`;
    mailLink.href = href;
    mailLink.hidden = false;
    status.textContent = 'Your request is ready. Send it from your email app to info@menu-made.com. If no app opens, use the link below or email us your session details. Your time is not yet confirmed.';
    window.location.href = href;
  });
})();
