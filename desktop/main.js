// 1대1채팅 데스크톱 앱 (Windows)
// - 창을 닫으면 트레이로 숨고 계속 실행된다 (선톡을 받기 위해)
// - 캐릭터 위젯 창(투명, 항상 위)을 띄우고 위치·크기를 기억한다
// - 화면 쪽(app/index.html)과는 preload.js의 window.desktop으로만 이야기한다
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, protocol, net, shell, nativeImage, screen, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const APP_ID = 'kr.oneonone.chat';
const APP_NAME = '1대1채팅';
const ORIGIN = 'app://local';
const ROOT = path.join(__dirname, 'app');
const WIDGET_BASE = { w: 260, h: 380 };

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let main = null, tray = null, quitting = false, unread = 0;
const widgets = new Map(); // roomId → BrowserWindow
const notes = new Set();   // 알림이 사라지기 전에 정리되지 않게 붙잡아 둔다

/* ───── 상태 저장 (창 위치, 열린 위젯) ───── */
const statePath = () => path.join(app.getPath('userData'), 'desktop-state.json');
let state = { main: null, widgets: {}, trayTip: false };
function loadState() { try { state = { ...state, ...JSON.parse(fs.readFileSync(statePath(), 'utf8')) }; } catch { } }
let saveTimer = null;
function saveState() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { fs.writeFileSync(statePath(), JSON.stringify(state, null, 1)); } catch { } }, 400); }

const icon = name => nativeImage.createFromPath(path.join(ROOT, name));

/* ───── 화면 업데이트 ─────
   새 버전의 화면(index.html)을 받아 사용자 폴더에 저장해 두고, 앱에 들어 있는 것보다 새것이면 그걸 쓴다.
   앱 껍데기(main.js·preload.js)가 바뀐 버전은 update.json의 minShell로 알려 주고, 그때는 새 압축 파일이 필요하다. */
const verCmp = (a, b) => { const x = String(a).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0), y = String(b).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
const uiDir = () => path.join(app.getPath('userData'), 'ui');
function uiOverride() {
  try {
    const v = fs.readFileSync(path.join(uiDir(), 'version.txt'), 'utf8').trim(), f = path.join(uiDir(), 'index.html');
    if (verCmp(v, app.getVersion()) > 0 && fs.existsSync(f)) return f;
  } catch { }
  return null;
}
async function applyUpdate({ version, htmlUrl, metaUrl }) {
  if (!/^https:\/\/github\.com\/harp1455\/chat\/releases\/download\//i.test(String(htmlUrl))) return { ok: false, error: '업데이트 주소가 올바르지 않습니다.' };
  if (metaUrl) {
    try { const meta = await (await net.fetch(metaUrl)).json(); if (meta?.minShell && verCmp(meta.minShell, app.getVersion()) > 0) return { ok: false, needFull: true }; }
    catch { return { ok: false, error: '업데이트 정보를 읽지 못했습니다.' }; }
  }
  const res = await net.fetch(htmlUrl); if (!res.ok) return { ok: false, error: '내려받지 못했습니다 (' + res.status + ')' };
  const html = await res.text();
  if (!html.includes('<title>1:1 채팅</title>') || !html.includes("const APP_VERSION = '" + version + "'")) return { ok: false, error: '받은 파일이 이 앱의 화면 파일이 아닙니다.' };
  fs.mkdirSync(uiDir(), { recursive: true });
  fs.writeFileSync(path.join(uiDir(), 'index.html.tmp'), html); fs.renameSync(path.join(uiDir(), 'index.html.tmp'), path.join(uiDir(), 'index.html'));
  fs.writeFileSync(path.join(uiDir(), 'version.txt'), String(version));
  setTimeout(() => { for (const w of [main, ...widgets.values()]) if (w && !w.isDestroyed()) w.webContents.reloadIgnoringCache(); }, 800);
  return { ok: true };
}

/* ───── 메인 창 ───── */
function createMain(hidden) {
  const b = state.main || {};
  main = new BrowserWindow({
    width: b.width || 1280, height: b.height || 860, x: b.x, y: b.y,
    minWidth: 380, minHeight: 560, show: false, title: APP_NAME,
    backgroundColor: '#161a24', icon: icon('icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  main.setMenuBarVisibility(false);
  main.loadURL(ORIGIN + '/index.html');
  main.once('ready-to-show', () => { if (!hidden) main.show(); });
  const remember = () => { if (!main.isMinimized() && !main.isMaximized()) { state.main = main.getBounds(); saveState(); } };
  main.on('resize', remember); main.on('move', remember);
  // 창이 실제로 보이고 선택돼 있는지 화면 쪽에 알려 준다 (선톡 알림을 띄울지 판단)
  const sendState = () => { if (!main.isDestroyed()) main.webContents.send('win-state', { active: main.isVisible() && !main.isMinimized() && main.isFocused() }); };
  for (const ev of ['show', 'hide', 'focus', 'blur', 'minimize', 'restore']) main.on(ev, sendState);
  main.webContents.on('did-finish-load', sendState);
  main.on('close', e => {
    if (quitting) return;
    e.preventDefault(); main.hide();
    if (!state.trayTip) { // 처음 한 번만 안내
      state.trayTip = true; saveState();
      notify({ title: APP_NAME, body: '창을 닫아도 작업 표시줄 오른쪽 아래 트레이에서 계속 실행됩니다. 완전히 끄려면 트레이 아이콘을 오른쪽 클릭해 ‘종료’를 누르세요.' });
    }
  });
  guardLinks(main);
}
function showMain(roomId) {
  if (!main || main.isDestroyed()) createMain(false);
  if (main.isMinimized()) main.restore();
  main.show(); main.focus();
  if (roomId) main.webContents.send('open-room', roomId);
}
// 바깥 링크(AI Studio 결제 화면 등)는 앱 안이 아니라 기본 브라우저로 연다
function guardLinks(win) {
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
}

/* ───── 위젯 창 ───── */
function widgetSize(scale) { return { width: Math.round(WIDGET_BASE.w * scale), height: Math.round(WIDGET_BASE.h * scale) }; }
function createWidget(roomId) {
  if (widgets.has(roomId)) { const w = widgets.get(roomId); w.showInactive(); return; }
  const saved = state.widgets[roomId] || {};
  const scale = saved.scale || 1, size = widgetSize(scale);
  const wa = screen.getPrimaryDisplay().workArea;
  const n = widgets.size;
  let x = saved.x ?? (wa.x + wa.width - size.width - 24 - n * 40), y = saved.y ?? (wa.y + wa.height - size.height - 8);
  // 저장된 위치가 지금 화면 밖이면 기본 위치로
  const onScreen = screen.getAllDisplays().some(d => x + size.width > d.workArea.x + 20 && x < d.workArea.x + d.workArea.width - 20 && y + 40 > d.workArea.y && y < d.workArea.y + d.workArea.height - 20);
  if (!onScreen) { x = wa.x + wa.width - size.width - 24; y = wa.y + wa.height - size.height - 8; }
  const w = new BrowserWindow({
    ...size, x, y, transparent: true, frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, backgroundColor: '#00000000', show: false, title: APP_NAME + ' 위젯', icon: icon('icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  w.setAlwaysOnTop(true, 'floating');
  w.setIgnoreMouseEvents(true, { forward: true }); // 투명한 곳은 클릭이 뒤 창으로 통과
  w.loadURL(ORIGIN + '/index.html?widget=' + encodeURIComponent(roomId));
  w.once('ready-to-show', () => w.showInactive());
  w._roomId = roomId; w._scale = scale;
  widgets.set(roomId, w);
  state.widgets[roomId] = { x, y, scale }; saveState();
  w.on('closed', () => { widgets.delete(roomId); if (!quitting) { delete state.widgets[roomId]; saveState(); } refreshTray(); });
  guardLinks(w);
  refreshTray();
}
const fromSender = e => BrowserWindow.fromWebContents(e.sender);

/* ───── 알림 ───── */
function notify({ title, body, roomId, icon: dataUrl }) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: title || APP_NAME, body: body || '', icon: dataUrl ? nativeImage.createFromDataURL(dataUrl) : icon('icon.png'), silent: false });
  notes.add(n);
  n.on('click', () => { notes.delete(n); showMain(roomId); });
  n.on('close', () => notes.delete(n));
  n.show();
  if (roomId && main && !main.isVisible()) main.flashFrame?.(true);
}

/* ───── 트레이 ───── */
function autostart() { return app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin; }
function setAutostart(on) { app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] }); refreshTray(); return autostart(); }
function refreshTray() {
  if (!tray) return;
  tray.setImage(icon(unread ? 'tray-unread.png' : 'tray.png').resize({ width: 16, height: 16 }));
  tray.setToolTip(unread ? `${APP_NAME} · 안 읽은 메시지 ${unread}개` : APP_NAME);
  const wl = [...widgets.values()];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '열기', click: () => showMain() },
    { type: 'separator' },
    ...(wl.length ? [{ label: `위젯 모두 닫기 (${wl.length}개)`, click: () => wl.forEach(w => w.close()) }] : []),
    { label: '컴퓨터를 켜면 자동으로 실행', type: 'checkbox', checked: autostart(), click: i => setAutostart(i.checked) },
    { type: 'separator' },
    { label: '종료', click: () => { quitting = true; app.quit(); } },
  ]));
}
function createTray() {
  tray = new Tray(icon('tray.png').resize({ width: 16, height: 16 }));
  tray.on('click', () => showMain());
  tray.on('double-click', () => showMain());
  refreshTray();
}

/* ───── 화면 쪽과의 연결 ───── */
ipcMain.on('notify', (e, o) => notify(o || {}));
ipcMain.on('unread', (e, n) => { unread = Number(n) || 0; refreshTray(); if (!unread) main?.flashFrame?.(false); });
ipcMain.on('show-main', () => showMain());
ipcMain.on('open-widget', (e, roomId) => { if (typeof roomId === 'string' && roomId) createWidget(roomId); });
ipcMain.on('widget-close', e => fromSender(e)?.close());
ipcMain.on('widget-move', (e, p) => {
  const w = fromSender(e); if (!w || !p) return;
  const x = Math.round(p.x), y = Math.round(p.y); if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  w.setPosition(x, y);
  if (w._roomId) { state.widgets[w._roomId] = { ...(state.widgets[w._roomId] || {}), x, y }; saveState(); }
});
ipcMain.on('widget-ignore', (e, on) => fromSender(e)?.setIgnoreMouseEvents(!!on, { forward: true }));
ipcMain.on('widget-scale', (e, s) => {
  const w = fromSender(e); if (!w) return;
  const scale = Math.min(1.8, Math.max(0.6, Number(s) || 1)), old = w.getBounds(), size = widgetSize(scale);
  // 아래쪽 가운데를 기준으로 크기를 바꾼다 (캐릭터 발 위치 유지)
  const x = Math.round(old.x + (old.width - size.width) / 2), y = old.y + old.height - size.height;
  w.setBounds({ x, y, ...size }); w._scale = scale;
  if (w._roomId) { state.widgets[w._roomId] = { x, y, scale }; saveState(); }
});
ipcMain.handle('get-autostart', () => autostart());
ipcMain.handle('apply-update', (e, o) => applyUpdate(o || {}));
ipcMain.handle('shell-version', () => app.getVersion());
ipcMain.handle('set-autostart', (e, on) => setAutostart(on));

/* ───── 시작 ───── */
app.on('second-instance', () => showMain());
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* 트레이에서 계속 실행 */ });
app.whenReady().then(() => {
  loadState();
  protocol.handle('app', req => {
    const u = new URL(req.url);
    let rel = decodeURIComponent(u.pathname); if (rel === '/' || !rel) rel = '/index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) return new Response('not found', { status: 404 });
    if (rel === '/index.html') { const o = uiOverride(); if (o) return net.fetch(pathToFileURL(o).toString()); }
    return net.fetch(pathToFileURL(file).toString());
  });
  const hidden = process.argv.includes('--hidden');
  createMain(hidden);
  createTray();
  for (const roomId of Object.keys(state.widgets || {})) createWidget(roomId);
  powerMonitor.on('resume', () => { for (const w of [main, ...widgets.values()]) w?.webContents.send('resumed'); });
});
