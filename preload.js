const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  getDiskInfo: () => ipcRenderer.invoke('get-disk-info'),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  getGpuInfo: () => ipcRenderer.invoke('get-gpu-info'),
  getConfigInfo: () => ipcRenderer.invoke('get-config-info'),
  getNetworkInfo: () => ipcRenderer.invoke('get-network-info'),
  getProxyStatus: () => ipcRenderer.invoke('get-proxy-status'),
  setProxyStatus: (enabled) => ipcRenderer.invoke('set-proxy-status', enabled),
  pingTest: (target) => ipcRenderer.invoke('ping-test', target),
  pingStart: (target) => ipcRenderer.send('ping-start', target),
  pingStop: () => ipcRenderer.invoke('ping-stop'),
  onPingData: (callback) => ipcRenderer.on('ping-data', (event, data) => callback(data)),
  onPingEnd: (callback) => ipcRenderer.on('ping-end', () => callback()),
  removePingListeners: () => {
    ipcRenderer.removeAllListeners('ping-data');
    ipcRenderer.removeAllListeners('ping-end');
  },
  openSystemTool: (command) => ipcRenderer.invoke('open-system-tool', command),
  getRealtimeStats: () => ipcRenderer.invoke('get-realtime-stats'),
  getDiskSlots: () => ipcRenderer.invoke('get-disk-slots')
});
