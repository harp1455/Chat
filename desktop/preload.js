// 화면(app/index.html)에서 쓸 수 있는 데스크톱 기능. 이 목록 밖의 기능은 화면에서 쓸 수 없다.
const { contextBridge, ipcRenderer } = require('electron');
let active = true;
ipcRenderer.on('win-state', (_, st) => { active = !!st?.active; window.dispatchEvent(new Event('desktop-state')); });

contextBridge.exposeInMainWorld('desktop', {
  isActive: () => active,
  notify: o => ipcRenderer.send('notify', { title: String(o?.title || ''), body: String(o?.body || ''), roomId: o?.roomId || null, icon: typeof o?.icon === 'string' ? o.icon : null }),
  setUnread: n => ipcRenderer.send('unread', Number(n) || 0),
  showMain: () => ipcRenderer.send('show-main'),
  openWidget: roomId => ipcRenderer.send('open-widget', String(roomId)),
  closeWidget: () => ipcRenderer.send('widget-close'),
  moveWidget: (x, y) => ipcRenderer.send('widget-move', { x, y }),
  setIgnore: on => ipcRenderer.send('widget-ignore', !!on),
  scaleWidget: s => ipcRenderer.send('widget-scale', Number(s) || 1),
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  setAutostart: on => ipcRenderer.invoke('set-autostart', !!on),
  applyUpdate: o => ipcRenderer.invoke('apply-update', { version: String(o?.version || ''), htmlUrl: String(o?.htmlUrl || ''), minShell: String(o?.minShell || '') }),
  shellVersion: () => ipcRenderer.invoke('shell-version'),
  onOpenRoom: cb => ipcRenderer.on('open-room', (_, id) => cb(id)),
  onResume: cb => ipcRenderer.on('resumed', () => cb()),
});
