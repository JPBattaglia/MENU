(() => {
  'use strict';
  const device = document.getElementById('appDemoDevice');
  if (!device) return;
  const status = document.getElementById('appDemoStatus');
  const offline = document.getElementById('appDemoOffline');
  const savedOnly = document.getElementById('appDemoSavedOnly');
  const saved = new Set();
  const tabs = [...document.querySelectorAll('[data-app-tab]')];
  const names = { pasta: 'Pappardelle al pomodoro', burrata: 'Seasonal burrata', tiramisu: 'House tiramisu' };
  let updateIndex = 0;
  const initialUpdate = document.getElementById('appDemoUpdates').firstElementChild.cloneNode(true);
  const announcements = [
    ['A table worth sharing', 'A fictional invitation to discover a seasonal menu.'],
    ['Something new for the weekend', 'A sample update about a new dish or a special opening time.'],
    ['Your next visit, made simple', 'An example of news customers could read inside an app.']
  ];
  function announce(text) { status.textContent = text; }
  function selectTab(tab, focus = false) {
    tabs.forEach(button => {
      const selected = button === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      document.getElementById(button.getAttribute('aria-controls')).hidden = !selected;
    });
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); selectTab(tabs[next], true); }
    });
  });
  function renderSaved() {
    document.querySelectorAll('[data-save-dish]').forEach(button => {
      const selected = saved.has(button.dataset.saveDish);
      button.setAttribute('aria-pressed', String(selected));
      button.textContent = selected ? 'Saved' : 'Save';
      button.setAttribute('aria-label', `${selected ? 'Unsave' : 'Save'} ${names[button.dataset.saveDish]}`);
    });
    document.querySelectorAll('[data-dish]').forEach(dish => {
      dish.hidden = savedOnly.checked && !saved.has(dish.dataset.dish);
    });
    document.getElementById('appDemoSavedCount').textContent = `(${saved.size})`;
    document.getElementById('appDemoNoSaved').hidden = !savedOnly.checked || saved.size > 0;
  }
  document.querySelectorAll('[data-save-dish]').forEach(button => button.addEventListener('click', () => {
    const dish = button.dataset.saveDish;
    if (saved.has(dish)) saved.delete(dish); else saved.add(dish);
    renderSaved();
    announce(`${names[dish]} ${saved.has(dish) ? 'saved in' : 'removed from'} this preview.`);
  }));
  savedOnly.addEventListener('change', renderSaved);
  function renderConnection() {
    device.dataset.offline = String(offline.checked);
    document.getElementById('appDemoConnection').textContent = offline.checked ? 'Offline simulation' : 'Connected preview';
  }
  offline.addEventListener('change', () => {
    renderConnection();
    announce(offline.checked ? 'Offline simulation on. The already-loaded sample menu remains available. Your connection has not changed.' : 'Offline simulation off. This is a connected concept preview.');
  });
  document.getElementById('appDemoPreviewUpdate').addEventListener('click', () => {
    const [title, text] = announcements[updateIndex % announcements.length];
    updateIndex += 1;
    const item = document.createElement('article');
    item.className = 'app-demo-update';
    const label = document.createElement('span'); label.textContent = 'Simulated announcement';
    const heading = document.createElement('h4'); heading.textContent = title;
    const paragraph = document.createElement('p'); paragraph.textContent = text;
    item.append(label, heading, paragraph);
    const updates = document.getElementById('appDemoUpdates');
    updates.prepend(item);
    while (updates.children.length > 3) updates.lastElementChild.remove();
    announce('A simulated announcement was added inside the preview. No push message was sent.');
  });
  document.querySelectorAll('[name="appTextSize"]').forEach(input => input.addEventListener('change', () => {
    device.dataset.textSize = input.value;
    announce(`Preview text size set to ${input.value}.`);
  }));
  document.querySelectorAll('[name="appTheme"]').forEach(input => input.addEventListener('change', () => {
    device.dataset.theme = input.value;
    announce(`Preview theme set to ${input.value}.`);
  }));
  document.getElementById('appDemoReset').addEventListener('click', () => {
    saved.clear(); savedOnly.checked = false; offline.checked = false;
    updateIndex = 0;
    document.getElementById('appDemoUpdates').replaceChildren(initialUpdate.cloneNode(true));
    document.querySelector('[name="appTextSize"][value="standard"]').checked = true;
    document.querySelector('[name="appTheme"][value="light"]').checked = true;
    device.dataset.textSize = 'standard'; device.dataset.theme = 'light';
    renderSaved(); renderConnection(); selectTab(tabs[0]);
    announce('Preview settings and saved dishes reset.');
    tabs[0].focus();
  });
  offline.checked = false;
  savedOnly.checked = false;
  document.querySelectorAll('[name="appTextSize"],[name="appTheme"]').forEach(input => { input.checked = input.defaultChecked; });
  renderSaved();
  renderConnection();
})();
