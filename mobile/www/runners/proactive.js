// 안드로이드 백그라운드 실행기: 앱이 닫혀 있는 동안 약 15분마다 깨어나 시간이 된 선톡을 보낸다.
// 앱은 뒤로 갈 때 setCfg로 캐릭터별 지침·최근 대화(packs)를 넘기고, 다시 열릴 때 drain으로 받은 메시지를 가져간다.
// (웹뷰 밖의 별도 실행 환경이라 화면 기능은 쓸 수 없다. 최신 문법은 피해서 쓴다.)

function load(key, fallback) {
  try {
    var r = CapacitorKV.get(key);
    var v = r && typeof r === 'object' ? r.value : r;
    return v ? JSON.parse(v) : fallback;
  } catch (e) { return fallback; }
}
function save(key, v) { CapacitorKV.set(key, JSON.stringify(v)); }

var DOW = ['일', '월', '화', '수', '목', '금', '토'];
function p2(n) { return (n < 10 ? '0' : '') + n; }
function fmtStamp(ts) { var d = new Date(ts); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '(' + DOW[d.getDay()] + ') ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }
function fmtGap(ms) {
  var m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return m + '분';
  var h = Math.floor(m / 60);
  if (h < 24) return h + '시간' + (m % 60 ? ' ' + (m % 60) + '분' : '');
  var d = Math.floor(h / 24);
  return d + '일' + (h % 24 ? ' ' + (h % 24) + '시간' : '');
}
function hourOf(ts) { var d = new Date(ts); return d.getHours() + d.getMinutes() / 60; }
function quiet(cfg) { var f = Number(cfg.quietFrom), t = Number(cfg.quietTo); return isFinite(f) && isFinite(t) && f !== t ? { f: f, t: t } : null; }
function inQuiet(ts, cfg) { var q = quiet(cfg); if (!q) return false; var x = hourOf(ts); return q.f < q.t ? (x >= q.f && x < q.t) : (x >= q.f || x < q.t); }
function quietEnd(ts, cfg) { var q = quiet(cfg); var d = new Date(ts); d.setHours(q.t, 0, 0, 0); if (d.getTime() <= ts) d.setDate(d.getDate() + 1); return d.getTime(); }
function activeHours(cfg) { var q = quiet(cfg); return q ? 24 - (q.f < q.t ? q.t - q.f : 24 - q.f + q.t) : 24; }
function nextTime(p, from, cfg) {
  var mean = activeHours(cfg) * 3600e3 / Math.max(1, p.perDay || 3);
  var t = Math.max(from + mean * (0.4 + Math.random() * 1.2), from + 20 * 60e3);
  if (inQuiet(t, cfg)) t = quietEnd(t, cfg) + Math.random() * 90 * 60e3;
  return Math.round(t);
}
function plainBody(text) {
  return text.split('\n').map(function (l) { return l.replace(/^\s*(?:\[[^\]\n]{1,30}\]|\{[^}\n]{1,60}\})*\s*/, '').replace(/\*\*([^*\n]+)\*\*/g, '$1').trim(); })
    .filter(function (l) { return l; }).join('\n').slice(0, 300);
}

addEventListener('setCfg', function (resolve, reject, args) {
  try { save('cfg', args.cfg || null); resolve(); } catch (e) { reject(e); }
});
addEventListener('setActive', function (resolve, reject, args) {
  try { var cfg = load('cfg', null); if (cfg) { cfg.active = !!args.active; save('cfg', cfg); } resolve(); } catch (e) { reject(e); }
});
addEventListener('drain', function (resolve, reject) {
  try {
    var inbox = load('inbox', []), cfg = load('cfg', null);
    save('inbox', []);
    resolve({ inbox: inbox, packs: (cfg && cfg.packs || []).map(function (p) { return { charId: p.charId, next: p.next }; }) });
  } catch (e) { reject(e); }
});

addEventListener('checkIn', async function (resolve, reject) {
  try {
    var cfg = load('cfg', null), now = Date.now();
    if (!cfg || !cfg.on || cfg.active || !cfg.key || !cfg.packs || !cfg.packs.length || inQuiet(now, cfg)) { resolve(); return; }
    var inbox = load('inbox', []);
    for (var i = 0; i < cfg.packs.length; i++) {
      var p = cfg.packs[i];
      if (now < p.next) continue;
      // 휴대폰이 꺼져 있었거나 오래 잠들어 많이 밀렸으면, 몰아서 보내지 않고 다시 잡는다. 답 없는 선톡이 2개면 멈춘다.
      if (now - p.next > 3 * 3600e3 || p.streak >= 2) { p.next = nextTime(p, now, cfg); continue; }
      p.next = nextTime(p, now, cfg);
      var note = (p.streak ? p.note1 : p.note0).replace('{{NOW}}', fmtStamp(now)).replace('{{GAP}}', p.lastTs ? fmtGap(now - p.lastTs) : '');
      var contents = JSON.parse(JSON.stringify(p.contents));
      var tail = contents[contents.length - 1];
      tail.parts[0].text = tail.parts[0].text.replace('{{NOTE}}', note);
      var res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(p.model) + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: p.system }] }, contents: contents, generationConfig: p.gen || {} }),
      });
      if (!res.ok) { p.next = now + 30 * 60e3; continue; }
      var j = await res.json();
      var parts = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
      var text = parts.filter(function (x) { return x.text && !x.thought; }).map(function (x) { return x.text; }).join('').trim();
      if (!text) continue;
      var um = j.usageMetadata || {};
      inbox.push({ roomId: p.roomId, text: text, ts: Date.now(), model: p.model,
        usage: { p: um.promptTokenCount || 0, c: um.cachedContentTokenCount || 0, o: (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0) } });
      // 앱을 열기 전에 한 번 더 보낼 때를 위해, 방금 보낸 말을 대화에 이어 둔다
      var last = p.contents[p.contents.length - 1];
      last.parts[0].text = last.parts[0].text.replace('\n(시스템: {{NOTE}})', '').replace('(시스템: {{NOTE}})', '') || '(시스템: 대화 시작)';
      p.contents.push({ role: 'model', parts: [{ text: text }] }, { role: 'user', parts: [{ text: '(시스템: 상대에게서 아직 새 메시지가 없다.)\n(시스템: {{NOTE}})' }] });
      p.streak = (p.streak || 0) + 1; p.lastTs = Date.now();
      CapacitorNotifications.schedule([{ id: Math.floor(Math.random() * 2000000000), title: p.name, body: plainBody(text), smallIcon: 'ic_stat_chat', autoCancel: true, channelId: 'chat_msg', actionTypeId: 'room:' + p.roomId }]);
      break; // 한 번 깨어날 때 하나만
    }
    save('cfg', cfg); save('inbox', inbox);
    resolve();
  } catch (e) { reject(e); }
});
