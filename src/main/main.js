// Electron main process: the window and everything that touches disk and network.
// The interface (src/renderer) talks to it only through window.mop (see preload.js).

const path = require('path');
const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const settings = require('./settings');
const manifest = require('./manifest');

function createWindow() {
  const win = new BrowserWindow({
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
ipcMain.handle('maps:list', () => manifest.load());

// Installation arrives in the next steps; for now the button only answers
ipcMain.handle('map:status', () => ({ installed: false }));
ipcMain.handle('map:play', () => ({
  ok: false,
  message: 'Установка ещё не подключена: она появится на следующем шаге.',
}));

Menu.setApplicationMenu(null);
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
