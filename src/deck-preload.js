'use strict';

// Ty // Deck (src/deck): his settings window.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deck', {
  init: () => ipcRenderer.invoke('deck:init'),
  set: (patch) => ipcRenderer.invoke('deck:set', patch),
  saveApps: (apps) => ipcRenderer.invoke('deck:saveApps', apps),
  testLaunch: (index) => ipcRenderer.invoke('deck:testLaunch', index),
  browse: () => ipcRenderer.invoke('deck:browse'),
  tryCommand: (text) => ipcRenderer.invoke('deck:try', text),
  installed: () => ipcRenderer.invoke('deck:installed'),
  rescan: () => ipcRenderer.invoke('deck:rescan'),
  weather: (city, units) => ipcRenderer.invoke('deck:weather', city, units),
  greet: () => ipcRenderer.send('deck:greet'),
  skins: () => ipcRenderer.invoke('deck:skins'),
  live: () => ipcRenderer.invoke('deck:live'),
  liveNewKey: () => ipcRenderer.invoke('deck:liveNewKey'),
  openUrl: (url) => ipcRenderer.send('deck:openUrl', url),
  newSkin: (name) => ipcRenderer.invoke('deck:newSkin', name),
  openSkins: () => ipcRenderer.send('deck:openSkins'),
  openChat: () => ipcRenderer.send('chatwin:open'),
  startup: (on) => ipcRenderer.send('deck:startup', Boolean(on)),
});
