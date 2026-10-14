// Electron main process: the window and everything that touches disk and network.
// The interface (src/renderer) talks to it only through window.mop (see preload.js).

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, clipboard, ipcMain, Menu, shell } = require('electron');
const settings = require('./settings');
const manifest = require('./manifest');
const paths = require('./paths');
const stateFile = require('./state');
const game = require('./game');
const pack = require('./pack');
const world = require('./world');
const graphics = require('./graphics');
const covers = require('./covers');

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
  return !!installed && installed.version === map.version && installed.neoforge === map.neoforge
    && installed.pack === (map.pack?.sha1 || null)
    && installed.world === (map.world?.sha1 || null);
}

function status(id) {
  const map = maps.find(m => m.id === id);
  if (!map) return { installed: false, running: false };
  return { installed: isInstalled(map), running: running.has(id) };
}

async function install(map) {
  const d = dirs();
  const report = p => send('progress', { id: map.id, ...p });
  await game.prepare(d, map, report);
  const previous = stateFile.load(d.state).maps[map.id]?.files;
  // World first: the datapack of the pack goes inside it
  await world.installWorld(d, map, report);
  const { files } = await pack.installPack(d, map, previous, report);
  const state = stateFile.load(d.state);
  state.maps[map.id] = {
    version: map.version,
    minecraft: map.minecraft,
    neoforge: map.neoforge,
    pack: map.pack?.sha1 || null,
    world: map.world?.sha1 || null,
    files,
  };
  stateFile.save(d.state, state);
  return { ok: true, message: 'Готово. Нажми «Играть».' };
}

// Opens the main menu of the map; its "Play -> Host a lobby" opens the world for friends
// and "Play -> Join" goes to a friend.
async function play(map) {
  const d = dirs();
  const { versionId, java } = await game.prepare(d, map);
  world.allowOfflineFriends(d, map);
  graphics.apply(path.join(d.instances, map.id), settings.load().graphics);
  const startedAt = Date.now();
  const proc = await game.start(d, {
    mapId: map.id,
    versionId,
    javaw: java.javaw,
    nick: settings.load().nick,
  });
  running.set(map.id, proc);

  game.onHostAddress(proc, address => send('game', { id: map.id, running: true, address }));
  proc.on('exit', code => {
    running.delete(map.id);
    const crash = code !== 0 ? game.lastCrashReport(d, map.id, startedAt) : null;
    const logs = path.join(d.instances, map.id, 'logs');
    send('game', { id: map.id, running: false, code, crash, logs });
  });
  send('game', { id: map.id, running: true, host: true });
  return {
    ok: true,
    message: 'Игра запускается. Первый запуск с модами может идти пару минут.',
  };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 700,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#16161a',
    title: 'MOP Launcher',
    // The installed launcher takes its icon from the .exe
    ...(app.isPackaged ? {} : { icon: path.join(__dirname, '..', '..', 'build', 'icon.png') }),
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
ipcMain.handle('settings:setMusic', (_e, on) => settings.setMusic(on));

// The page cannot fetch its own file:// assets, so the track goes over IPC.
// Replace src/renderer/assets/music.ogg to change it; without the file the launcher is silent.
ipcMain.handle('music:get', () => {
  try {
    return fs.readFileSync(path.join(__dirname, '..', 'renderer', 'assets', 'music.ogg'));
  } catch {
    return null;
  }
});

ipcMain.handle('maps:list', async () => {
  const res = await manifest.load();
  maps = res.maps;
  const cacheDir = path.join(app.getPath('userData'), 'covers');
  for (const map of res.maps) map.cover = covers.localCover(map, cacheDir, manifest.bundledDir());
  return res;
});

ipcMain.handle('map:status', (_e, id) => status(id));

// Graphics levels of an installed map and the one chosen; null before the install
ipcMain.handle('map:graphics', (_e, id) => {
  const info = graphics.levels(path.join(dirs().instances, id));
  if (!info) return null;
  const chosen = settings.load().graphics;
  return { ...info, chosen: info.levels.some(l => l.id === chosen) ? chosen : info.default };
});
ipcMain.handle('settings:setGraphics', (_e, level) => settings.setGraphics(level));

// One map at a time: no second install or launch while the first one runs
async function guarded(id, action) {
  const map = maps.find(m => m.id === id);
  if (!map) return { ok: false, error: true, message: 'Игра не найдена в списке' };
  if (busy.has(id) || running.has(id)) return { ok: false, message: 'Уже идёт' };

  busy.add(id);
  try {
    return await action(map);
  } catch (err) {
    console.error(game.errorDetails(err));
    return { ok: false, error: true, message: game.describeError(err) };
  } finally {
    busy.delete(id);
  }
}

// One button: installs if needed, otherwise starts the game
ipcMain.handle('map:play', (_e, id) => guarded(id, map => (isInstalled(map) ? play(map) : install(map))));


ipcMain.handle('clipboard:write', (_e, text) => clipboard.writeText(String(text)));
ipcMain.handle('folder:open', (_e, target) => shell.openPath(target));

Menu.setApplicationMenu(null);
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
