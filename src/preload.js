// The only bridge between the interface and the main process.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mop', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setNick: nick => ipcRenderer.invoke('settings:setNick', nick),
  listMaps: () => ipcRenderer.invoke('maps:list'),
  getMapStatus: id => ipcRenderer.invoke('map:status', id),
  play: id => ipcRenderer.invoke('map:play', id),
  onProgress: callback => ipcRenderer.on('progress', (_e, data) => callback(data)),
});
