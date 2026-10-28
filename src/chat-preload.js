'use strict';

// Ty's chat window (src/chatwin): typing to him, and his answers coming back from his overlay.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chatwin', {
  init: () => ipcRenderer.invoke('chatwin:init'),
  send: (text) => ipcRenderer.send('chatwin:send', String(text)),
  answer: (id) => ipcRenderer.send('chatwin:answer', String(id)),
  setSkin: (skin) => ipcRenderer.send('chatwin:skin', String(skin)),
  onUpdate: (fn) => ipcRenderer.on('chatwin:update', (_e, u) => fn(u)),
});
