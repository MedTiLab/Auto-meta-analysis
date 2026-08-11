import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('medautodataDesktop', {
  isDesktop: true,
  platform: process.platform,
  writeClipboardText: (text) => ipcRenderer.invoke('desktop:write-clipboard-text', text),
  chooseDirectory: (defaultPath) => ipcRenderer.invoke('desktop:choose-directory', defaultPath),
  saveFile: (payload) => ipcRenderer.invoke('desktop:save-file', payload),
});
