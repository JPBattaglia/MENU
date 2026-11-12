(() => {
  'use strict';
  // Limits (owner, Nov 12, 2026), matching booking-api/src/booking/booking.js: a PDF up to 20 MB; Word and text
  // files up to 5 MB. A photo can be any size a phone takes (up to PHOTO_MAX): one over PHOTO_SEND is redrawn smaller
  // in the browser before it is sent, because the menu reader takes images up to about 5 MB.
  const MB = 1024 * 1024;
  const PDF_MAX = 20 * MB, OTHER_MAX = 5 * MB, PHOTO_MAX = 40 * MB, PHOTO_SEND = 4.5 * MB;
  const extensions = /\.(pdf|doc|docx|txt|png|jpe?g|webp)$/i;
  const isPhoto = file => /\.(png|jpe?g|webp)$/i.test(file.name);
  function validate(file) {
    if (!file) return;
    if (!extensions.test(file.name)) throw new Error('Choose a PDF, Word document, text file, PNG, JPEG, or WebP.');
    if (!file.size) throw new Error('That file is empty. Choose another one.');
    if (isPhoto(file)) { if (file.size > PHOTO_MAX) throw new Error('That photo is over 40 MB. Choose a smaller one.'); return; }
    if (/\.pdf$/i.test(file.name)) { if (file.size > PDF_MAX) throw new Error('That PDF is over 20 MB. Choose a smaller one, or email it to info@menu-made.com.'); return; }
    if (file.size > OTHER_MAX) throw new Error('Choose a file no larger than 5 MB.');
  }
  // A photo over PHOTO_SEND is redrawn as a JPEG, smaller each try until it fits; text on a menu stays readable at
  // these sizes. A browser that cannot do it sends the photo as it is, and the server answers as before.
  async function shrink(file) {
    if (!file || !isPhoto(file) || file.size <= PHOTO_SEND || typeof createImageBitmap !== 'function') return file;
    try {
      const image = await createImageBitmap(file);
      for (const [side, quality] of [[3200, 0.86], [2600, 0.82], [2000, 0.8], [1600, 0.75]]) {
        const scale = Math.min(1, side / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (blob && blob.size <= PHOTO_SEND) return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
      }
    } catch { /* not a readable image here: send it as it is */ }
    return file;
  }
  async function fingerprint(file) {
    if (!file) return '';
    validate(file);
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [file.name, file.size, ...new Uint8Array(digest)].join(':');
  }
  async function send(payload, file, signal) {
    validate(file);
    file = await shrink(file);
    let body; let headers;
    if (file) {
      body = new FormData();
      body.append('payload', JSON.stringify(payload));
      body.append('document', file);
    } else {
      headers = { 'Content-Type': 'application/json' };
      body = JSON.stringify(payload);
    }
    const response = await fetch((window.MenuMadeCatalog?.API || '') + '/api/inquiry', { method: 'POST', headers, body, signal });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true || result.requestId !== payload.requestId) {
      const messages = {
        400: 'Check the document format and your contact details. Nothing was confirmed as received.',
        403: 'Please open menu-made.com/contact and try again.',
        409: 'These details changed during a retry. Please reload before submitting again.',
        413: 'That file is too large. A PDF can be up to 20 MB; other files up to 5 MB.',
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
