// Launcher interface. Works only through window.mop (src/preload.js).

const view = document.getElementById('view');
const nickChip = document.getElementById('nick-chip');
const nickValue = document.getElementById('nick-value');
const nickDialog = document.getElementById('nick-dialog');
const nickForm = document.getElementById('nick-form');
const nickInput = document.getElementById('nick-input');
const nickError = document.getElementById('nick-error');
const nickCancel = document.getElementById('nick-cancel');

const state = {
  settings: { nick: '' },
  maps: [],
  offline: false,
  statuses: {},
};

function fromTemplate(id) {
  return document.getElementById(id).content.firstElementChild.cloneNode(true);
}

function show(node) {
  view.replaceChildren(node);
  view.scrollTop = 0;
}

// ---------- nick ----------

// Same rules as src/main/settings.js; the main process checks again on save
function checkNick(nick) {
  if (nick.length === 0) return 'Введи ник';
  if (nick.length < 3) return 'Минимум 3 символа';
  if (!/^[A-Za-z0-9_]+$/.test(nick)) return 'Только латиница, цифры и _';
  return null;
}

function showNick() {
  nickValue.textContent = state.settings.nick;
  nickChip.hidden = !state.settings.nick;
}

function openNickDialog() {
  const first = !state.settings.nick;
  nickCancel.hidden = first;
  nickInput.value = state.settings.nick;
  nickError.textContent = '';
  nickInput.removeAttribute('aria-invalid');
  nickDialog.showModal();
  nickInput.focus();
}

// Without a nick the dialog cannot be closed with Esc
nickDialog.addEventListener('cancel', e => {
  if (!state.settings.nick) e.preventDefault();
});

nickCancel.addEventListener('click', () => nickDialog.close());
nickChip.addEventListener('click', openNickDialog);

nickInput.addEventListener('input', () => {
  nickError.textContent = '';
  nickInput.removeAttribute('aria-invalid');
});

nickForm.addEventListener('submit', async e => {
  e.preventDefault();
  const nick = nickInput.value.trim();
  const error = checkNick(nick);
  if (error) {
    nickError.textContent = error;
    nickInput.setAttribute('aria-invalid', 'true');
    return;
  }
  const res = await window.mop.setNick(nick);
  if (!res.ok) {
    nickError.textContent = res.error;
    nickInput.setAttribute('aria-invalid', 'true');
    return;
  }
  state.settings = res.settings;
  showNick();
  nickDialog.close();
});

// ---------- library ----------

function renderLibrary() {
  const section = fromTemplate('tpl-library');
  const grid = section.querySelector('.library-grid');

  if (state.offline) {
    const note = document.createElement('p');
    note.className = 'offline-note';
    note.textContent = 'Нет связи с сервером: показан список с прошлого запуска.';
    section.insertBefore(note, grid);
  }

  for (const map of state.maps) {
    const item = fromTemplate('tpl-card');
    const installed = state.statuses[map.id]?.installed;
    item.querySelector('.card-cover').src = map.cover || '';
    item.querySelector('.card-title').textContent = map.title;
    item.querySelector('.card-subtitle').textContent = map.subtitle || '';
    item.querySelector('.lamp').classList.toggle('on', !!installed);
    item.querySelector('.card-state-text').textContent = installed ? 'Установлена' : 'Не установлена';
    item.querySelector('.card').addEventListener('click', () => renderGame(map));
    grid.append(item);
  }

  show(section);
}

// ---------- game page ----------

function renderGame(map) {
  const section = fromTemplate('tpl-game');
  const installed = state.statuses[map.id]?.installed;

  section.querySelector('.back').addEventListener('click', renderLibrary);
  section.querySelector('.game-cover img').src = map.cover || '';
  section.querySelector('.game-title').textContent = map.title;
  section.querySelector('.game-subtitle').textContent = map.subtitle || '';

  const facts = section.querySelector('.game-facts');
  for (const text of [map.players, `Версия ${map.version}`, ...(map.tags || [])]) {
    if (!text) continue;
    const li = document.createElement('li');
    li.textContent = text;
    facts.append(li);
  }

  const desc = section.querySelector('.game-desc');
  for (const paragraph of (map.description || '').split(/\n{2,}/)) {
    const p = document.createElement('p');
    p.textContent = paragraph;
    desc.append(p);
  }

  const button = section.querySelector('.btn-play');
  const label = button.querySelector('span');
  const status = section.querySelector('.game-status');
  label.textContent = installed ? 'Играть' : 'Установить';

  button.addEventListener('click', async () => {
    if (!state.settings.nick) {
      openNickDialog();
      return;
    }
    button.disabled = true;
    status.className = 'game-status';
    status.textContent = installed ? 'Запускаю…' : 'Готовлю установку…';
    try {
      const res = await window.mop.play(map.id);
      status.textContent = res.message || '';
      status.classList.toggle('is-ok', !!res.ok);
      status.classList.toggle('is-error', !!res.error);
    } catch (err) {
      status.textContent = err.message;
      status.classList.add('is-error');
    } finally {
      button.disabled = false;
    }
  });

  show(section);
}

// ---------- start ----------

function renderError(message) {
  const section = fromTemplate('tpl-error');
  section.querySelector('.notice-text').textContent = message;
  section.querySelector('button').addEventListener('click', loadMaps);
  show(section);
}

async function loadMaps() {
  try {
    const res = await window.mop.listMaps();
    state.maps = res.maps;
    state.offline = res.offline;
    for (const map of state.maps) {
      state.statuses[map.id] = await window.mop.getMapStatus(map.id);
    }
    renderLibrary();
  } catch (err) {
    // ipcRenderer wraps errors: "Error invoking remote method 'maps:list': Error: ..."
    renderError(err.message.replace(/^.*?Error: /, ''));
  }
}

async function start() {
  state.settings = await window.mop.getSettings();
  showNick();
  await loadMaps();
  if (!state.settings.nick) openNickDialog();
}

start();
