// The owner's own menu editor (stage 15, owner Nov 14, 2026). Reads the live menu from /api/account/menu, lets the
// owner change names, prices and descriptions, mark items sold out, add, remove and reorder items and sections, and
// saves it back; the online menu updates at once at the same address and QR code. The session is the account's
// HttpOnly cookie; everything is drawn with textContent and form values, never HTML from the server.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const API = /(^|\.)menu-made\.com$/.test(location.hostname) ? '' : 'https://menu-made.com';
  let business = null;
  let menu = null;
  let dirty = false;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function button(text, className, onClick, label) {
    const b = el('button', className, text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }
  function field(labelText, value, onInput, { area = false, max = 200, placeholder = '', quiet = false } = {}) {
    const wrap = el('label', 'mm-edit-field');
    wrap.append(el('span', null, labelText));
    const input = el(area ? 'textarea' : 'input');
    if (!area) input.type = 'text';
    else input.rows = 2;
    input.maxLength = max;
    input.value = value || '';
    input.placeholder = placeholder;
    input.addEventListener('input', () => { onInput(input.value); if (!quiet) changed(); });
    wrap.append(input);
    return wrap;
  }
  function changed() {
    dirty = true;
    $('saveStatus').textContent = 'Not saved yet.';
  }
  function move(list, index, by) {
    const to = index + by;
    if (to < 0 || to >= list.length) return;
    [list[index], list[to]] = [list[to], list[index]];
    changed();
    draw();
  }

  function draw() {
    const box = $('editSections');
    box.replaceChildren();
    menu.sections.forEach((section, si) => {
      const card = el('section', 'mm-card mm-edit-section');
      const head = el('div', 'mm-edit-row');
      head.append(field('Section', section.name, (v) => { section.name = v; }, { max: 120 }));
      const tools = el('div', 'mm-edit-tools');
      tools.append(
        button('↑', 'mm-edit-icon', () => move(menu.sections, si, -1), `Move ${section.name || 'section'} up`),
        button('↓', 'mm-edit-icon', () => move(menu.sections, si, 1), `Move ${section.name || 'section'} down`),
        button('Remove', 'mm-edit-remove', () => {
          if (!confirmRemove(`the whole "${section.name || 'section'}" section`)) return;
          menu.sections.splice(si, 1); changed(); draw();
        })
      );
      head.append(tools);
      card.append(head);
      section.items.forEach((item, ii) => {
        const row = el('div', `mm-edit-item${item.sold_out ? ' is-sold-out' : ''}`);
        const top = el('div', 'mm-edit-row');
        top.append(field('Item', item.name, (v) => { item.name = v; }, { max: 200 }));
        top.append(field('Price', item.price, (v) => { item.price = v; }, { max: 40, placeholder: '$12' }));
        row.append(top);
        row.append(field('Description', item.description, (v) => { item.description = v; }, { area: true, max: 600 }));
        const actions = el('div', 'mm-edit-tools');
        const sold = el('label', 'mm-edit-sold');
        const tick = el('input');
        tick.type = 'checkbox';
        tick.checked = item.sold_out === true;
        tick.addEventListener('change', () => { item.sold_out = tick.checked; row.classList.toggle('is-sold-out', tick.checked); changed(); });
        sold.append(tick, document.createTextNode(' Sold out'));
        actions.append(
          sold,
          button('↑', 'mm-edit-icon', () => move(section.items, ii, -1), `Move ${item.name || 'item'} up`),
          button('↓', 'mm-edit-icon', () => move(section.items, ii, 1), `Move ${item.name || 'item'} down`),
          button('Remove', 'mm-edit-remove', () => {
            if (!confirmRemove(`"${item.name || 'this item'}"`)) return;
            section.items.splice(ii, 1); changed(); draw();
          })
        );
        row.append(actions);
        card.append(row);
      });
      card.append(button('Add an item', 'btn secondary mm-edit-add', () => {
        section.items.push({ name: '', description: '', price: '' });
        changed(); draw();
        const inputs = card.ownerDocument.querySelectorAll('.mm-edit-section')[si].querySelectorAll('.mm-edit-item input[type=text]');
        const last = inputs[inputs.length - 2];
        if (last) last.focus();
      }));
      box.append(card);
    });
    $('editNotes').value = menu.notes || '';
  }
  function confirmRemove(what) {
    // window.confirm is avoided (blocked in some in-app browsers); a second press within 4 seconds confirms.
    const now = Date.now();
    if (confirmRemove.what === what && now - confirmRemove.at < 4000) { confirmRemove.what = null; return true; }
    confirmRemove.what = what; confirmRemove.at = now;
    $('saveStatus').textContent = `Press Remove again to remove ${what}.`;
    return false;
  }

  async function save() {
    if (!menu) return;
    const status = $('saveStatus');
    status.textContent = 'Saving…';
    ['saveTop', 'saveBottom'].forEach((id) => { $(id).disabled = true; });
    try {
      const res = await fetch(`${API}/api/account/menu`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business, sections: menu.sections, notes: $('editNotes').value })
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) { status.textContent = out.error || 'That didn’t save. Try again.'; return; }
      dirty = false;
      status.textContent = out.unchanged ? 'Nothing changed.' : `Saved. Your live menu is updated${out.changes && out.changes.length ? `: ${out.changes.slice(0, 4).join('; ')}${out.changes.length > 4 ? '…' : ''}` : ''}.`;
    } catch {
      status.textContent = 'No connection. Your changes are still here; press Save again.';
    } finally {
      ['saveTop', 'saveBottom'].forEach((id) => { $(id).disabled = false; });
    }
  }

  async function load(id) {
    business = id;
    $('editStatus').textContent = 'Loading your menu…';
    $('editor').hidden = true;
    const res = await fetch(`${API}/api/account/menu?business=${encodeURIComponent(id)}`, { credentials: 'include' });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ok) { $('editStatus').textContent = out.error || 'Your menu couldn’t load. Try again.'; return; }
    menu = out.menu;
    menu.sections.forEach((s) => s.items.forEach((i) => { i.sold_out = i.sold_out === true; }));
    $('editTitle').textContent = `Edit ${out.business.name}'s menu`;
    const live = $('editLive');
    if (out.menu_url && /^https:\/\/menu-made\.com\//.test(out.menu_url)) { live.href = out.menu_url; live.hidden = false; } else live.hidden = true;
    $('editStatus').textContent = '';
    $('editor').hidden = false;
    draw();
    drawLanguages(out.languages, out.menu_url);
    drawPlan(out.plan);
    drawDesigns(out.designs, out.plan);
  }

  // MΞNU free plan (Nov 14, 2026): what the free menu includes, and the way to every design.
  function drawPlan(plan) {
    const card = $('editFree');
    card.hidden = !(plan && plan.free);
    if (card.hidden) return;
    if (plan.upgrade_url && /^https:\/\/menu-made\.com\//.test(plan.upgrade_url)) $('freeUpgrade').href = plan.upgrade_url;
    $('freeWelcome').hidden = new URLSearchParams(location.search).get('welcome') !== 'free';
  }

  // Any design for a paid menu (Nov 14, 2026); the free plan stays Classic.
  function drawDesigns(list, plan) {
    const card = $('editDesign');
    card.hidden = !Array.isArray(list) || !list.length || Boolean(plan && plan.free);
    if (card.hidden) return;
    const box = $('designList');
    box.replaceChildren();
    for (const d of list) {
      const row = el('div', 'mm-edit-bar mm-design-row');
      const text = el('div');
      text.append(el('strong', null, d.label), el('small', null, ` ${d.blurb}`));
      row.append(text, button('Use this design', 'btn secondary', () => useDesign(d)));
      box.append(row);
    }
  }
  async function useDesign(d) {
    if (dirty && !confirm('You have unsaved changes. Switch design anyway? Save first to keep them.')) return;
    const status = $('designStatus');
    status.textContent = `Switching to ${d.label}…`;
    try {
      const res = await fetch(`${API}/api/account/menu/design`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ business, design: d.key }) });
      const out = await res.json().catch(() => ({}));
      status.textContent = res.ok && out.ok ? `Your live menu is now in ${out.label}.` : (out.error || 'That didn’t work. Try again.');
    } catch {
      status.textContent = 'No connection. Try again.';
    }
  }
  async function startPlus(interval) {
    const status = $('plusStatus');
    status.textContent = 'Opening checkout…';
    document.querySelectorAll('[data-plus]').forEach((b) => { b.disabled = true; });
    try {
      const res = await fetch(`${API}/api/account/menu/plus`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ business, interval }) });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.ok && /^https:\/\/checkout\.stripe\.com\//.test(out.url)) { location.href = out.url; return; }
      status.textContent = out.error || 'Checkout didn’t open. Try again.';
    } catch {
      status.textContent = 'No connection. Try again.';
    }
    document.querySelectorAll('[data-plus]').forEach((b) => { b.disabled = false; });
  }

  // Translated menus (paid plans only, owner Nov 14, 2026). The live menu gets language links at the top.
  let langs = null;
  let menuUrl = null;
  function drawLanguages(state, url) {
    langs = state || null;
    menuUrl = url && /^https:\/\/menu-made\.com\//.test(url) ? url : null;
    const card = $('editLangs');
    if (!langs) { card.hidden = true; return; }
    card.hidden = false;
    $('langsPaid').hidden = !langs.paid;
    $('langsLocked').hidden = langs.paid;
    $('langsFix').hidden = true;
    if (!langs.paid) return;
    $('langsLegend').textContent = `Pick up to ${langs.max}`;
    const list = $('langsList');
    list.replaceChildren();
    for (const l of langs.available) {
      const row = el('label', 'mm-edit-sold mm-langs-option');
      const tick = el('input');
      tick.type = 'checkbox';
      tick.value = l.code;
      tick.checked = langs.chosen.includes(l.code);
      tick.addEventListener('change', () => {
        const picked = list.querySelectorAll('input:checked').length;
        if (picked > langs.max) { tick.checked = false; $('langsStatus').textContent = `Up to ${langs.max} languages.`; }
      });
      const name = el('span', null, l.name);
      name.lang = l.code;
      row.append(tick, document.createTextNode(' '), name, el('small', null, l.name === l.english ? '' : ` ${l.english}`));
      list.append(row);
    }
    drawChosen();
  }
  function drawChosen() {
    const box = $('langsChosen');
    box.replaceChildren();
    for (const code of langs.chosen) {
      const l = langs.available.find((x) => x.code === code);
      if (!l) continue;
      const row = el('div', 'mm-edit-bar mm-langs-row');
      row.append(el('strong', null, l.english));
      const tools = el('div', 'mm-edit-tools');
      if (menuUrl) {
        const see = el('a', 'cta-pill', 'See it');
        see.href = `${menuUrl}?lang=${encodeURIComponent(code)}`;
        see.target = '_blank';
        see.rel = 'noopener';
        tools.append(see);
      }
      tools.append(button('Check the wording', 'btn secondary', () => openFix(code)));
      row.append(tools);
      box.append(row);
    }
  }
  async function saveLanguages() {
    const status = $('langsStatus');
    const chosen = Array.from($('langsList').querySelectorAll('input:checked')).map((i) => i.value);
    status.textContent = chosen.length ? 'Translating your menu… this takes up to a minute.' : 'Saving…';
    $('langsSave').disabled = true;
    try {
      const res = await fetch(`${API}/api/account/menu/languages`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ business, languages: chosen })
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) { status.textContent = out.error || 'That didn’t save. Try again.'; return; }
      langs.chosen = out.chosen;
      const behind = out.chosen.filter((c) => !out.translated[c]);
      status.textContent = !out.chosen.length ? 'Saved. Your menu shows in English only.'
        : behind.length ? 'Saved. Some text is still being translated; it shows in English until it is.'
          : 'Saved. Your live menu now has a language switch at the top.';
      drawChosen();
      $('langsFix').hidden = true;
    } catch {
      status.textContent = 'No connection. Press Save languages again.';
    } finally {
      $('langsSave').disabled = false;
    }
  }
  let fixing = null;
  async function openFix(code) {
    const l = langs.available.find((x) => x.code === code);
    fixing = { code, pairs: [] };
    $('langsFix').hidden = false;
    $('fixTitle').textContent = `Check the wording: ${l ? l.english : code}`;
    $('fixStatus').textContent = 'Loading…';
    $('fixList').replaceChildren();
    const res = await fetch(`${API}/api/account/menu/translations?business=${encodeURIComponent(business)}&lang=${encodeURIComponent(code)}`, { credentials: 'include' }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok || !out.ok) { $('fixStatus').textContent = out.error || 'That couldn’t load. Try again.'; return; }
    fixing.pairs = out.pairs;
    $('fixStatus').textContent = '';
    for (const p of out.pairs) {
      const wrap = field(p.source, p.text, (v) => { p.text = v; p.changed = true; }, { max: 700, area: p.source.length > 60, quiet: true });
      const input = wrap.querySelector('input, textarea');
      input.lang = code;
      $('fixList').append(wrap);
    }
    $('langsFix').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function saveFix() {
    if (!fixing) return;
    const edits = Object.fromEntries(fixing.pairs.filter((p) => p.changed).map((p) => [p.source, p.text]));
    const status = $('fixStatus');
    if (!Object.keys(edits).length) { status.textContent = 'Nothing changed.'; return; }
    status.textContent = 'Saving…';
    try {
      const res = await fetch(`${API}/api/account/menu/translations`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ business, lang: fixing.code, edits })
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) { status.textContent = out.error || 'That didn’t save. Try again.'; return; }
      fixing.pairs.forEach((p) => { p.changed = false; });
      status.textContent = 'Saved. Your live menu shows your wording.';
    } catch {
      status.textContent = 'No connection. Press Save wording again.';
    }
  }

  async function start() {
    $('editNotes').addEventListener('input', changed);
    $('saveTop').addEventListener('click', save);
    $('saveBottom').addEventListener('click', save);
    $('langsSave').addEventListener('click', saveLanguages);
    document.querySelectorAll('[data-plus]').forEach((b) => b.addEventListener('click', () => startPlus(b.dataset.plus)));
    $('fixSave').addEventListener('click', saveFix);
    $('addSection').addEventListener('click', () => {
      menu.sections.push({ name: '', items: [{ name: '', description: '', price: '' }] });
      changed(); draw();
    });
    window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
    const me = await fetch(`${API}/api/account/me`, { credentials: 'include' }).then((r) => r.json()).catch(() => null);
    if (!me || !me.signed_in) { $('editStatus').textContent = ''; $('editSignIn').hidden = false; return; }
    const withMenu = (me.businesses || []).filter((b) => b.menu);
    if (!withMenu.length) { $('editStatus').textContent = 'There’s no online menu on your account yet. Make one free from the Menus page.'; return; }
    const wanted = new URLSearchParams(location.search).get('business');
    const first = withMenu.find((b) => b.id === wanted) || withMenu[0];
    if (withMenu.length > 1) {
      const pick = $('editBusiness');
      for (const b of withMenu) { const o = el('option', null, b.name); o.value = b.id; pick.append(o); }
      pick.value = first.id;
      pick.addEventListener('change', () => {
        if (dirty && !confirmRemove('your unsaved changes (switch menus)')) { pick.value = business; return; }
        dirty = false; load(pick.value);
      });
      $('editPick').hidden = false;
    }
    load(first.id);
  }
  start();
})();
