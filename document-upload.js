(() => {
  'use strict';
  const MAX_BYTES = 5 * 1024 * 1024;
  const extensions = /\.(pdf|doc|docx|txt|png|jpe?g|webp)$/i;
  function validate(file) {
    if (!file) return;
    if (!extensions.test(file.name)) throw new Error('Choose a PDF, Word document, text file, PNG, JPEG, or WebP.');
    if (!file.size || file.size > MAX_BYTES) throw new Error('Choose a non-empty file no larger than 5 MB.');
  }
  async function fingerprint(file) {
    if (!file) return '';
    validate(file);
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [file.name, file.size, ...new Uint8Array(digest)].join(':');
  }
  async function send(payload, file, signal) {
    validate(file);
    let body; let headers;
    if (file) {
      body = new FormData();
      body.append('payload', JSON.stringify(payload));
      body.append('document', file);
    } else {
      headers = { 'Content-Type': 'application/json' };
      body = JSON.stringify(payload);
    }
    const response = await fetch('/api/inquiry', { method: 'POST', headers, body, signal });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true || result.requestId !== payload.requestId) {
      const messages = {
        400: 'Check the document format and your contact details. Nothing was confirmed as received.',
        403: 'Please open menu-made.com/contact and try again.',
        409: 'These details changed during a retry. Please reload before submitting again.',
        413: 'Choose a non-empty file no larger than 5 MB.',
        415: 'Document uploads are not available yet. Remove the file to continue, or email it to info@menu-made.com.',
        429: 'Too many requests. Please wait an hour before trying again.',
        503: 'Your document could not be saved. Please try again later or email info@menu-made.com.'
      };
      throw new Error(messages[response.status] || 'Your submission could not be confirmed. Please try again or contact info@menu-made.com.');
    }
    return result;
  }
  window.MenuMadeDocuments = Object.freeze({ validate, fingerprint, send });
  document.querySelectorAll('#lead_document, #bookingDocument').forEach(input => {
    input.addEventListener('change', () => {
      try { validate(input.files[0]); input.setCustomValidity(''); }
      catch (error) { input.setCustomValidity(error.message); input.reportValidity(); }
      if (input.id === 'lead_document') {
        document.getElementById('lead_document_status').textContent = input.files[0]
          ? 'Selected: ' + input.files[0].name + '. The file is not uploaded until you continue to checkout.' : '';
      }
    });
  });
})();
