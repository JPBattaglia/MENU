(() => {
  'use strict';
  const dialog = document.getElementById('archivePreview');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  let trigger;
  document.querySelectorAll('[data-archive-preview]').forEach(link => link.addEventListener('click', event => {
    const card = link.closest('.work-card');
    if (!card) return;
    event.preventDefault();
    trigger = link;
    document.getElementById('archivePreviewTitle').textContent = card.querySelector('h3').textContent;
    document.getElementById('archivePreviewDescription').textContent = card.querySelector('.work-copy p:last-child').textContent;
    const image = document.getElementById('archivePreviewImage');
    image.src = link.href;
    image.alt = link.querySelector('img').alt;
    document.getElementById('archivePreviewFull').href = link.href;
    dialog.showModal();
  }));
  document.getElementById('archivePreviewClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => trigger?.focus());
})();
