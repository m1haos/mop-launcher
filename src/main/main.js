// Electron main process: the window and everything that touches disk and network.
// The interface (src/renderer) talks to it only through window.mop (see preload.js).

const path = require('path');
const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const settings = require('./settings');
const manifest = require('./manifest');
const paths = require('./paths');
const stateFile = require('./state');
const game = require('./game');

let win = null;
let maps = [];
const busy = new Set();      // maps being installed or started right now
const running = new Map();   // map id -> game process

function dirs() {
  return paths.layout(paths.gameRoot(app.getPath('userData')));
}

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function isInstalled(map) {
  const installed = stateFile.load(dirs().state).maps[map.id];
  return !!installed && installed.version === map.version && installed.neoforge === map.neoforge;
}

function status(id) {
  const map = maps.find(m => m.id === id);
  if (!map) return { installed: false, running: false };
  return { installed: isInstalled(map), running: running.has(id) };
}

async function install(map) {
  const d = dirs();
  await game.prepare(d, map, p => send('progress', { id: map.id, ...p }));
  const state = stateFile.load(d.state);
  state.maps[map.id] = { version: map.version, minecraft: map.minecraft, neoforge: map.neoforge };
  stateFile.save(d.state, state);
  return { ok: true, message: 'Готово. Нажми «Играть».' };
}

async function play(map) {
  const d = dirs();
  const { versionId, java } = await game.prepare(d, map);
  const startedAt = Date.now();
  const proc = await game.start(d, {
    mapId: map.id,
    versionId,
    javaw: java.javaw,
    nick: settings.load().nick,
  });
  running.set(map.id, proc);

  proc.on('exit', code => {
    running.delete(map.id);
    const crash = code !== 0 ? game.lastCrashReport(d, map.id, startedAt) : null;
    const logs = path.join(d.instances, map.id, 'logs');
    send('game', { id: map.id, running: false, code, crash, logs });
  });
  send('game', { id: map.id, running: true });
  return { ok: true, message: 'Игра запускается. Первый запуск с модами может идти пару минут.' };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 700,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#16161a',
    title: 'MOP Launcher',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

ipcMain.handle('settings:get', () => settings.load());
ipcMain.handle('settings:setNick', (_e, nick) => settings.setNick(nick));

ipcMain.handle('maps:list', async () => {
  const res = await manifest.load();
  maps = res.maps;
  return res;
});

ipcMain.handle('map:status', (_e, id) => status(id));

// One button: installs if needed, otherwise starts the game
ipcMain.handle('map:play', async (_e, id) => {
  const map = maps.find(m => m.id === id);
  if (!map) return { ok: false, error: true, message: 'Игра не найдена в списке' };
  if (busy.has(id) || running.has(id)) return { ok: false, message: 'Уже идёт' };

  busy.add(id);
  try {
    return isInstalled(map) ? await play(map) : await install(map);
  } catch (err) {
    console.error(err);
    return { ok: false, error: true, message: `Ошибка: ${err.message}` };
  } finally {
    busy.delete(id);
  }
});

ipcMain.handle('folder:open', (_e, target) => shell.openPath(target));

Menu.setApplicationMenu(null);
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
