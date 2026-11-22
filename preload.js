const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ----------------------------- Configurações -----------------------------
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial),

  // ----------------------------- Créditos -----------------------------
  addCredits: (amount) => ipcRenderer.invoke('credits:add', amount),
  consumeCredit: () => ipcRenderer.invoke('credits:consume'),
  getCreditsInfo: () => ipcRenderer.invoke('credits:info'),

  // ----------------------------- Plano de fundo (galeria) -----------------------------
  chooseBackground: () => ipcRenderer.invoke('background:choose'),
  setBackgroundImage: (dataUrl) => ipcRenderer.invoke('background:set-data', { dataUrl }),
  removeBackground: () => ipcRenderer.invoke('background:remove'),

  // ----------------------------- Administração -----------------------------
  verifyAdmin: (pin) => ipcRenderer.invoke('admin:verify', pin),
  setAdminPin: (pin) => ipcRenderer.invoke('admin:setPin', pin),

  // ----------------------------- Músicas / Bloco de Notas -----------------------------
  resolveSong: (query) => ipcRenderer.invoke('song:resolve', query),
  searchSongs: (query) => ipcRenderer.invoke('song:search', query),
  openInSystem: (filePath) => ipcRenderer.invoke('song:open-system', filePath),

  // ----------------------------- Biblioteca -----------------------------
  getLibrary: () => ipcRenderer.invoke('library:get'),
  chooseLibrary: () => ipcRenderer.invoke('library:choose'),
  rescanLibrary: () => ipcRenderer.invoke('library:rescan'),
  revealLibrary: () => ipcRenderer.invoke('library:reveal'),
  onLibraryUpdated: (callback) =>
    ipcRenderer.on('library:updated', (event, value) => callback(value)),

  // ----------------------------- Janela -----------------------------
  setWindowSize: (size) => ipcRenderer.invoke('window:size', size),
  closeWindow: () => ipcRenderer.send('window:close'),
  toggleFullscreen: () => ipcRenderer.send('window:toggle-fullscreen'),
  onFullscreenChanged: (callback) =>
    ipcRenderer.on('fullscreen:changed', (event, value) => callback(value))
});
