// The only bridge between the interface and the main process.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mop', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setNick: nick => ipcRenderer.invoke('settings:setNick', nick),
  setMusic: on => ipcRenderer.invoke('settings:setMusic', on),
  setGraphics: level => ipcRenderer.invoke('settings:setGraphics', level),
  getGraphics: id => ipcRenderer.invoke('map:graphics', id),
  getMusic: () => ipcRenderer.invoke('music:get'),
  listMaps: () => ipcRenderer.invoke('maps:list'),
  onMaps: callback => ipcRenderer.on('maps', (_e, data) => callback(data)),
  getMapStatus: id => ipcRenderer.invoke('map:status', id),
  play: id => ipcRenderer.invoke('map:play', id),
  copy: text => ipcRenderer.invoke('clipboard:write', text),
  openFolder: target => ipcRenderer.invoke('folder:open', target),
  onProgress: callback => ipcRenderer.on('progress', (_e, data) => callback(data)),
  onGame: callback => ipcRenderer.on('game', (_e, data) => callback(data)),
});
