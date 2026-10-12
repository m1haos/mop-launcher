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
  working: new Set(),
};

// Elements of the open game page; null on the library screen
let gameView = null;

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
  gameView = null;
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

  gameView = {
    id: map.id,
    button: section.querySelector('.btn-play'),
    label: section.querySelector('.btn-play span'),
    status: section.querySelector('.game-status'),
    progress: section.querySelector('.progress'),
    fill: section.querySelector('.progress-fill'),
  };
  updateButton();

  gameView.button.addEventListener('click', async () => {
    if (!state.settings.nick) {
      openNickDialog();
      return;
    }
    const id = map.id;
    const wasInstalled = state.statuses[id]?.installed;
    state.working.add(id);
    updateButton();
    setStatus(id, wasInstalled ? 'Запускаю…' : 'Готовлю установку…');
    try {
      const res = await window.mop.play(id);
      state.statuses[id] = await window.mop.getMapStatus(id);
      setStatus(id, res.message || '', res.ok ? 'ok' : res.error ? 'error' : '');
    } catch (err) {
      setStatus(id, err.message, 'error');
    } finally {
      state.working.delete(id);
      showProgress(id, null);
      updateButton();
    }
  });

  show(section);
}

// ---------- install / play state ----------

function updateButton() {
  if (!gameView) return;
  const st = state.statuses[gameView.id] || {};
  const working = state.working.has(gameView.id);
  gameView.label.textContent = st.running ? 'Игра запущена'
    : working ? (st.installed ? 'Запускаю…' : 'Устанавливаю…')
    : st.installed ? 'Играть' : 'Установить';
  gameView.button.disabled = working || !!st.running;
}

function setStatus(id, text, kind = '') {
  if (!gameView || gameView.id !== id) return;
  gameView.status.className = 'game-status' + (kind ? ` is-${kind}` : '');
  gameView.status.replaceChildren(text);
}

// share: 0..1, 'unknown' for a running step without numbers, null to hide
function showProgress(id, share) {
  if (!gameView || gameView.id !== id) return;
  gameView.progress.hidden = share === null;
  gameView.progress.classList.toggle('is-unknown', share === 'unknown');
  gameView.fill.style.width = typeof share === 'number' ? `${Math.round(share * 100)}%` : '';
}

window.mop.onProgress(({ id, text, progress, total }) => {
  if (total > 0) {
    const share = Math.min(progress / total, 1);
    showProgress(id, share);
    setStatus(id, `${text}: ${Math.round(share * 100)}%`);
  } else {
    showProgress(id, 'unknown');
    setStatus(id, `${text}…`);
  }
});

window.mop.onGame(({ id, running, code, crash, logs }) => {
  state.statuses[id] = { ...state.statuses[id], running };
  updateButton();
  if (running || code === 0 || code === null) {
    if (!running) setStatus(id, '');
    return;
  }
  setStatus(id, `Игра закрылась с ошибкой (код ${code}). `, 'error');
  if (gameView && gameView.id === id) {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'link-btn';
    open.textContent = crash ? 'Открыть отчёт о сбое' : 'Открыть папку с логами';
    open.addEventListener('click', () => window.mop.openFolder(crash || logs));
    gameView.status.append(open);
  }
});

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
