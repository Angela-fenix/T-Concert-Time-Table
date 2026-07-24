const DATA = JSON.parse(document.getElementById('scheduleData').textContent);

const CAT_COLOR_VAR = {
  '表演舞台': '--c-stage',
  '戶外舞台': '--c-outdoor',
  '福利VIP': '--c-vip',
  '拍貼合照': '--c-photo',
  '握手會': '--c-shake',
  '水槍挑戰': '--c-water',
};

function dateLabel(key){
  // key like "20260801"
  const y = key.slice(0,4), m = key.slice(4,6), d = key.slice(6,8);
  const dt = new Date(Number(y), Number(m)-1, Number(d));
  const wk = ['日','一','二','三','四','五','六'][dt.getDay()];
  return { md: `${Number(m)}/${Number(d)}`, wk: `星期${wk}`, full: `${y}/${m}/${d}` };
}

function timeToMinutes(t){
  const [h,m] = t.split(':').map(Number);
  return h*60+m;
}

// ---------- selection & event registry (used by the reminder feature) ----------
const STORAGE_KEY = 'oundongxi_reminders_v1';

function makeEventKey(dateKey, cat, ev){
  return `${dateKey}::${cat}::${ev.start}::${ev.end || ''}`;
}

// pre-register every event so reminders can be looked up regardless of which date is on screen
const eventRegistry = {};
Object.keys(DATA).forEach(dateKey => {
  Object.keys(DATA[dateKey]).forEach(cat => {
    DATA[dateKey][cat].forEach(ev => {
      const key = makeEventKey(dateKey, cat, ev);
      eventRegistry[key] = { dateKey, cat, text: ev.text, start: ev.start, end: ev.end };
    });
  });
});

const selectedKeys = new Set();
let savedMinutesBefore = [];

// ---------- debug mode: lets you manually override an event's trigger time for testing ----------
const DEBUG_PASSWORD = 'fenix_vemtt';
let debugMode = (sessionStorage.getItem('oundongxi_debug') === '1');
const debugOverrides = {}; // key -> 'YYYY-MM-DDTHH:mm' string, only affects reminder trigger time

const debugToggleBtn = document.getElementById('debugToggleBtn');

// ---------- theme toggle (dark / light), persisted across visits ----------
const themeToggleBtn = document.getElementById('themeToggleBtn');
const htmlEl = document.documentElement;
function applyTheme(theme){
  htmlEl.setAttribute('data-theme', theme);
  themeToggleBtn.textContent = theme === 'light' ? '☀️' : '🌙';
  try{ localStorage.setItem('oundongxi_theme', theme); }catch(err){}
}
(function initTheme(){
  let saved = null;
  try{ saved = localStorage.getItem('oundongxi_theme'); }catch(err){}
  applyTheme(saved === 'dark' ? 'dark' : 'light');
})();
themeToggleBtn.addEventListener('click', () => {
  applyTheme(htmlEl.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
});

function refreshDebugBtn(){
  debugToggleBtn.classList.toggle('is-on', debugMode);
  debugToggleBtn.textContent = debugMode ? 'debug: on' : 'debug';
}
refreshDebugBtn();

debugToggleBtn.addEventListener('click', () => {
  if(debugMode){
    debugMode = false;
    sessionStorage.removeItem('oundongxi_debug');
    refreshDebugBtn();
    return;
  }
  const pwd = prompt('輸入偵錯模式密碼：');
  if(pwd === null) return;
  if(pwd === DEBUG_PASSWORD){
    debugMode = true;
    sessionStorage.setItem('oundongxi_debug', '1');
    refreshDebugBtn();
  } else {
    alert('密碼錯誤');
  }
});

function toDatetimeLocalValue(date){
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// resolves the actual Date used to calculate reminder trigger times — uses the debug override
// when debug mode is on and the user has set one, otherwise falls back to the real schedule time.
// This never touches the displayed schedule table itself.
function getEffectiveStartDate(item, key){
  if(debugMode && debugOverrides[key]){
    const d = new Date(debugOverrides[key]);
    if(!isNaN(d.getTime())) return d;
  }
  const y = Number(item.dateKey.slice(0,4)), m = Number(item.dateKey.slice(4,6)), d = Number(item.dateKey.slice(6,8));
  const [hh, mm] = item.start.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

function loadSavedReminders(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return;
    const saved = JSON.parse(raw);
    (saved.keys || []).forEach(k => { if(eventRegistry[k]) selectedKeys.add(k); });
    savedMinutesBefore = saved.minutes || [];
    // re-arm browser notifications for anything still in the future
    if(Notification && Notification.permission === 'granted'){
      scheduleAllSelectedNotifications(savedMinutesBefore);
    }
  }catch(err){ /* ignore corrupt storage */ }
}
if(typeof localStorage !== 'undefined'){
  try{ loadSavedReminders(); }catch(err){}
}

// ---------- build date tickets ----------
const ticketRow = document.getElementById('ticketRow');
Object.keys(DATA).forEach(dateKey => {
  const lbl = dateLabel(dateKey);
  const card = document.createElement('button');
  card.className = 'ticket';
  card.innerHTML = `
    <span class="perf"></span>
    <span class="day-label">DAY</span>
    <span class="day-date display">${lbl.md}</span>
    <span class="day-week">${lbl.wk}</span>
    <span class="day-go">點擊查看場次表 →</span>
  `;
  card.addEventListener('click', () => showSchedule(dateKey));
  ticketRow.appendChild(card);
});

const dateScreen = document.getElementById('dateScreen');
const scheduleScreen = document.getElementById('scheduleScreen');
const schedTitle = document.getElementById('schedTitle');
const schedTable = document.getElementById('schedTable');
const legendEl = document.getElementById('legend');

document.getElementById('backBtn').addEventListener('click', () => {
  scheduleScreen.classList.add('hidden');
  dateScreen.classList.remove('hidden');
});

let currentDateKey = null;

function showSchedule(dateKey){
  currentDateKey = dateKey;
  const lbl = dateLabel(dateKey);
  schedTitle.innerHTML = `${lbl.full}（${lbl.wk}）場次時間表 <span class="wk"></span>`;
  buildLegend(DATA[dateKey]);
  buildTable(DATA[dateKey]);
  dateScreen.classList.add('hidden');
  scheduleScreen.classList.remove('hidden');
  scheduleScreen.scrollTop = 0;
  window.scrollTo(0,0);
}

function buildLegend(categories){
  legendEl.innerHTML = '';
  Object.keys(categories).forEach(cat => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<span class="legend-dot dot-${cat}"></span>${cat}`;
    legendEl.appendChild(item);
  });
}

// manually-inserted breakpoints — purely visual dividers to make an empty gap between two
// unrelated blocks read more clearly as "these are not the same thing", not tied to any real event
const EXTRA_BREAKPOINTS = {
  '20260801': ['18:20'],
  '20260802': ['16:10'],
};

function buildTable(categories){
  const catNames = Object.keys(categories);

  // gather all distinct time breakpoints
  const timeSet = new Set();
  catNames.forEach(cat => {
    categories[cat].forEach(ev => {
      if(ev.start) timeSet.add(ev.start);
      if(ev.end) timeSet.add(ev.end);
    });
  });
  (EXTRA_BREAKPOINTS[currentDateKey] || []).forEach(t => timeSet.add(t));
  const times = Array.from(timeSet).sort((a,b) => timeToMinutes(a) - timeToMinutes(b));

  // rowState[cat] = array over intervals [i, i+1): null | 'skip' | {event, span}
  const rowState = {};
  catNames.forEach(cat => {
    const arr = new Array(times.length - 1).fill(null);
    categories[cat].forEach(ev => {
      if(!ev.start) return;
      let startIdx = times.indexOf(ev.start);
      let endIdx = ev.end ? times.indexOf(ev.end) : startIdx + 1;
      if(endIdx <= startIdx) endIdx = startIdx + 1;
      endIdx = Math.min(endIdx, arr.length);
      if(startIdx >= arr.length) return;
      arr[startIdx] = { event: ev, span: endIdx - startIdx };
      for(let i = startIdx+1; i < endIdx; i++){ arr[i] = 'skip'; }
    });
    rowState[cat] = arr;
  });

  // Extend each event's color to visually reach its own end-time row, but ONLY when that
  // row is still unclaimed (a genuine gap before the next thing starts). If another event
  // already starts exactly at this end time (a back-to-back / touching case, very common in
  // this sheet), we leave the boundary as-is — otherwise the two colored blocks would fight
  // over the same table row and break the layout.
  catNames.forEach(cat => {
    const arr = rowState[cat];
    for(let i = 0; i < arr.length; i++){
      const cell = arr[i];
      if(!cell || typeof cell !== 'object') continue;
      const endIdx = i + cell.span;
      if(endIdx < arr.length && arr[endIdx] === null){
        arr[endIdx] = 'skip';
        cell.span += 1;
      }
    }
  });

  // header
  let html = '<thead><tr><th>時間</th>';
  catNames.forEach(cat => { html += `<th>${cat}</th>`; });
  html += '</tr></thead><tbody>';

  const eventIndexByCat = {}; // running counter per category, used to alternate shading between consecutive blocks
  catNames.forEach(cat => { eventIndexByCat[cat] = 0; });

  for(let r = 0; r < times.length - 1; r++){
    html += `<tr><td class="time-col">${times[r]}</td>`;
    catNames.forEach(cat => {
      const cell = rowState[cat][r];
      if(cell === 'skip') return; // covered by rowspan above
      if(cell === null){
        html += '<td class="empty"></td>';
      } else {
        const ev = cell.event;
        const key = makeEventKey(currentDateKey, cat, ev);
        const checked = selectedKeys.has(key) ? 'checked' : '';
        const selCls = selectedKeys.has(key) ? ' is-selected' : '';
        const altCls = (eventIndexByCat[cat]++ % 2 === 1) ? ' alt' : '';
        html += `<td class="event${selCls}${altCls}" data-cat="${cat}" data-key="${key}" rowspan="${cell.span}" data-start="${ev.start}" data-end="${ev.end || ''}" data-text="${escapeAttr(ev.text)}">`;
        html += `<input type="checkbox" class="event-checkbox" data-key="${key}" ${checked}>`;
        html += `<div class="event-inner">${escapeHtml(ev.text)}</div></td>`;
      }
    });
    html += '</tr>';
  }
  html += '</tbody>';
  schedTable.innerHTML = html;

  schedTable.querySelectorAll('td.event').forEach(td => {
    td.addEventListener('click', () => {
      openModal(td.getAttribute('data-cat'), td.getAttribute('data-start'), td.getAttribute('data-end'), td.getAttribute('data-text'));
    });
  });

  schedTable.querySelectorAll('.event-checkbox').forEach(cb => {
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      const key = cb.getAttribute('data-key');
      const td = cb.closest('td.event');
      if(cb.checked){ selectedKeys.add(key); td.classList.add('is-selected'); }
      else{ selectedKeys.delete(key); td.classList.remove('is-selected'); }
      updateReminderBar();
    });
  });
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
function escapeAttr(str){
  return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}

// ---------- modal ----------
const modalOverlay = document.getElementById('modalOverlay');
const modalCat = document.getElementById('modalCat');
const modalTime = document.getElementById('modalTime');
const modalText = document.getElementById('modalText');

function openModal(cat, start, end, text){
  modalCat.textContent = cat;
  const varName = CAT_COLOR_VAR[cat] || '--c-vip';
  modalCat.style.background = `color-mix(in srgb, var(${varName}) 30%, transparent)`;
  modalCat.style.color = `var(${varName})`;
  modalTime.innerHTML = end ? `${start}<span class="arrow">→</span>${end}` : `${start}<span class="arrow">→</span>…`;
  modalText.textContent = text;
  modalOverlay.classList.remove('hidden');
}
document.getElementById('modalClose').addEventListener('click', () => modalOverlay.classList.add('hidden'));
modalOverlay.addEventListener('click', (e) => { if(e.target === modalOverlay) modalOverlay.classList.add('hidden'); });

// ---------- map modal ----------
const mapModalOverlay = document.getElementById('mapModalOverlay');
document.getElementById('mapBtn').addEventListener('click', () => mapModalOverlay.classList.remove('hidden'));
document.getElementById('mapModalClose').addEventListener('click', () => mapModalOverlay.classList.add('hidden'));
mapModalOverlay.addEventListener('click', (e) => { if(e.target === mapModalOverlay) mapModalOverlay.classList.add('hidden'); });
document.addEventListener('keydown', (e) => { if(e.key === 'Escape'){ modalOverlay.classList.add('hidden'); reminderModalOverlay.classList.add('hidden'); document.getElementById('mapModalOverlay').classList.add('hidden'); } });

// ---------- reminder floating bar ----------
const reminderBar = document.getElementById('reminderBar');
const selCountEl = document.getElementById('selCount');

function updateReminderBar(){
  const n = selectedKeys.size;
  selCountEl.textContent = n;
  reminderBar.classList.toggle('hidden', n === 0);
}
document.getElementById('clearSelectionBtn').addEventListener('click', () => {
  selectedKeys.clear();
  updateReminderBar();
  // re-render current table (if visible) to uncheck boxes
  if(currentDateKey && !scheduleScreen.classList.contains('hidden')){ buildTable(DATA[currentDateKey]); }
});
updateReminderBar();

// ---------- reminder settings modal ----------
const reminderModalOverlay = document.getElementById('reminderModalOverlay');
const selectedListEl = document.getElementById('selectedList');
const reminderStatus = document.getElementById('reminderStatus');

document.getElementById('reminderBtn').addEventListener('click', openReminderModal);
document.getElementById('reminderClose').addEventListener('click', () => reminderModalOverlay.classList.add('hidden'));
reminderModalOverlay.addEventListener('click', (e) => { if(e.target === reminderModalOverlay) reminderModalOverlay.classList.add('hidden'); });

function openReminderModal(){
  reminderStatus.textContent = '';
  // populate selected list, sorted by date then time
  const items = Array.from(selectedKeys).map(k => ({ key: k, item: eventRegistry[k] })).filter(x => x.item);
  items.sort((a,b) => (a.item.dateKey + a.item.start).localeCompare(b.item.dateKey + b.item.start));

  const debugBanner = debugMode
    ? `<div class="debug-banner">🐞 偵錯模式已開啟：可手動調整下方每個場次的觸發時間來測試提醒，不會影響原本的表格時間。</div>`
    : '';

  const listHtml = items.map(({key, item}) => {
    const lbl = dateLabel(item.dateKey);
    const firstLine = item.text.split('\n')[0];
    if(debugMode){
      const effective = getEffectiveStartDate(item, key);
      return `<li><span class="sl-what">${escapeHtml(item.cat)} · ${escapeHtml(firstLine)}<br><span style="color:var(--ink-faint)">原時間 ${lbl.md} ${item.start}</span>
        <div class="debug-preview" data-preview-for="${key}"></div></span>
        <input type="datetime-local" step="1" class="debug-time-input" data-key="${key}" value="${toDatetimeLocalValue(effective)}"></li>`;
    }
    return `<li><span class="sl-what">${escapeHtml(item.cat)} · ${escapeHtml(firstLine)}</span><span class="sl-when">${lbl.md} ${item.start}</span></li>`;
  }).join('') || '<li><span class="sl-what">尚未選擇任何場次</span></li>';

  selectedListEl.innerHTML = listHtml;
  document.getElementById('debugBannerSlot').innerHTML = debugBanner;

  if(debugMode){
    selectedListEl.querySelectorAll('.debug-time-input').forEach(input => {
      input.addEventListener('input', () => {
        debugOverrides[input.getAttribute('data-key')] = input.value;
        updateDebugPreviews();
      });
      input.addEventListener('change', () => {
        debugOverrides[input.getAttribute('data-key')] = input.value;
        updateDebugPreviews();
      });
    });
    updateDebugPreviews();
  }

  // restore previously chosen minute checkboxes
  document.querySelectorAll('#minuteOptions input[type=checkbox]').forEach(cb => {
    cb.checked = savedMinutesBefore.includes(Number(cb.value));
  });

  reminderModalOverlay.classList.remove('hidden');
}

// live preview: for every selected event, show exactly when each checked "minutes before" would fire,
// and whether that moment is still in the future — this replaces guesswork when testing in debug mode
function updateDebugPreviews(){
  const minutes = getCheckedMinutes();
  const now = new Date();
  document.querySelectorAll('.debug-preview').forEach(div => {
    const key = div.getAttribute('data-preview-for');
    const item = eventRegistry[key];
    if(!item) return;
    const startDate = getEffectiveStartDate(item, key);
    if(minutes.length === 0){
      div.innerHTML = '<span class="chip past">尚未勾選提醒分鐘</span>';
      return;
    }
    div.innerHTML = minutes.map(min => {
      const target = new Date(startDate.getTime() - min * 60000);
      const isFuture = target.getTime() > now.getTime();
      const t = `${String(target.getHours()).padStart(2,'0')}:${String(target.getMinutes()).padStart(2,'0')}:${String(target.getSeconds()).padStart(2,'0')}`;
      return `<span class="chip ${isFuture ? 'future' : 'past'}">${min}分前 → ${t} ${isFuture ? '✓' : '✕已過'}</span>`;
    }).join('');
  });
}
document.querySelectorAll('#minuteOptions input[type=checkbox]').forEach(cb => {
  cb.addEventListener('change', () => { if(debugMode) updateDebugPreviews(); });
});

function getCheckedMinutes(){
  return Array.from(document.querySelectorAll('#minuteOptions input[type=checkbox]:checked')).map(cb => Number(cb.value));
}

// setTimeout can't handle delays over ~24.8 days in one call — chain it so long waits still work
function longTimeout(fn, delay){
  const MAX = 2147483647;
  if(delay > MAX){ setTimeout(() => longTimeout(fn, delay - MAX), MAX); }
  else{ setTimeout(fn, Math.max(delay, 0)); }
}

const inPageAlert = document.getElementById('inPageAlert');
let inPageAlertTimer = null;

function beep(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(); osc.stop(ctx.currentTime + 0.5);
  }catch(err){ /* audio not available, ignore */ }
}

function showInPageAlert(title, body){
  inPageAlert.innerHTML = `<span class="icon">⏰</span><div class="txt"><b>${escapeHtml(title)}</b><span>${escapeHtml(body)}</span></div><button aria-label="關閉">✕</button>`;
  inPageAlert.querySelector('button').addEventListener('click', () => inPageAlert.classList.add('hidden'));
  inPageAlert.classList.remove('hidden');
  beep();
  clearTimeout(inPageAlertTimer);
  inPageAlertTimer = setTimeout(() => inPageAlert.classList.add('hidden'), 15000);
}

function fireReminder(item, minutesBefore){
  const firstLine = item.text.split('\n')[0];
  const title = `⏰ ${minutesBefore} 分鐘後開始`;
  const body = `${item.cat}｜${item.start} ${firstLine}`;
  // always show the in-page fallback — this is the only guaranteed-visible path while the tab is open
  showInPageAlert(title, body);
  // additionally try a real OS notification; many mobile browsers throw here, which is fine, it's a bonus
  if(typeof Notification !== 'undefined' && Notification.permission === 'granted'){
    try{ new Notification(title, { body }); }catch(err){ /* not supported on this browser, in-page alert already shown */ }
  }
}

document.getElementById('testNotifBtn').addEventListener('click', () => {
  const supportsNotification = typeof Notification !== 'undefined';
  const permission = supportsNotification ? Notification.permission : 'unsupported';
  fireReminder({ cat: '測試', text: '這是一則測試提醒', start: 'now' }, 0);
  if(!supportsNotification){
    reminderStatus.textContent = '這個瀏覽器不支援系統通知，請改用日曆提醒檔。';
  } else if(permission !== 'granted'){
    reminderStatus.textContent = `目前通知權限為「${permission}」，系統通知可能不會出現，但網頁內提示應該看得到。`;
  } else {
    reminderStatus.textContent = '已送出測試——有看到網頁內的提示框嗎？系統通知也應該同時跳出。';
  }
});

function scheduleAllSelectedNotifications(minutes){
  const now = new Date();
  const scheduled = [];
  selectedKeys.forEach(key => {
    const item = eventRegistry[key];
    if(!item) return;
    const startDate = getEffectiveStartDate(item, key);
    minutes.forEach(min => {
      const target = new Date(startDate.getTime() - min * 60000);
      const delay = target.getTime() - now.getTime();
      if(delay > 0){
        longTimeout(() => fireReminder(item, min), delay);
        scheduled.push({ target, item, min });
      }
    });
  });
  return scheduled;
}

document.getElementById('saveReminderBtn').addEventListener('click', () => {
  const minutes = getCheckedMinutes();
  if(selectedKeys.size === 0){
    reminderStatus.textContent = '請先勾選至少一個場次';
    return;
  }
  if(minutes.length === 0){
    reminderStatus.textContent = '請至少選擇一個提前提醒時間';
    return;
  }
  savedMinutesBefore = minutes;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ keys: Array.from(selectedKeys), minutes }));

  if(typeof Notification === 'undefined'){
    reminderStatus.textContent = '此瀏覽器不支援通知，建議改用下方日曆提醒檔';
    return;
  }
  Notification.requestPermission().then(perm => {
    if(perm === 'granted'){
      const scheduled = scheduleAllSelectedNotifications(minutes);
      if(scheduled.length === 0){
        reminderStatus.textContent = '已儲存，但沒有任何一筆提醒時間落在未來（可能都已經過了）。';
      } else {
        scheduled.sort((a,b) => a.target - b.target);
        const next = scheduled[0].target;
        const nextStr = `${next.getMonth()+1}/${next.getDate()} ${String(next.getHours()).padStart(2,'0')}:${String(next.getMinutes()).padStart(2,'0')}:${String(next.getSeconds()).padStart(2,'0')}`;
        reminderStatus.textContent = `已排程 ${scheduled.length} 筆提醒，最近一筆將在 ${nextStr} 觸發。請保持分頁開啟。`;
      }
    } else {
      reminderStatus.textContent = '通知權限被拒絕，請改用下方日曆提醒檔（更保險）。';
    }
  });
});

// ---------- .ics calendar export (works even with the browser fully closed) ----------
function pad2(n){ return String(n).padStart(2, '0'); }

function formatIcsLocal(dt){
  return `${dt.getFullYear()}${pad2(dt.getMonth()+1)}${pad2(dt.getDate())}T${pad2(dt.getHours())}${pad2(dt.getMinutes())}00`;
}

function escapeIcsText(str){
  return String(str).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
}

function buildIcsContent(minutes){
  const items = Array.from(selectedKeys).map(k => ({ key: k, item: eventRegistry[k] })).filter(x => x.item);
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//偶運會時間對應表//zh-TW//'];
  const stamp = formatIcsLocal(new Date()) + 'Z';
  items.forEach(({key, item}, idx) => {
    const start = getEffectiveStartDate(item, key);
    let end;
    if(item.end && !(debugMode && debugOverrides[key])){
      const y = Number(item.dateKey.slice(0,4)), m = Number(item.dateKey.slice(4,6)), d = Number(item.dateKey.slice(6,8));
      const [eh, em] = item.end.split(':').map(Number);
      end = new Date(y, m-1, d, eh, em, 0, 0);
    } else {
      end = new Date(start.getTime() + 15*60000);
    }
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:oundongxi-${item.dateKey}-${idx}-${item.start.replace(':','')}@schedule`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${formatIcsLocal(start)}`);
    lines.push(`DTEND:${formatIcsLocal(end)}`);
    lines.push(`SUMMARY:${escapeIcsText(item.cat + '｜' + item.text.split('\n')[0])}`);
    lines.push(`DESCRIPTION:${escapeIcsText(item.text)}`);
    minutes.forEach(min => {
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:${escapeIcsText(min + ' 分鐘後：' + item.cat + ' ' + item.text.split('\n')[0])}`);
      lines.push(`TRIGGER:-PT${min}M`);
      lines.push('END:VALARM');
    });
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

document.getElementById('downloadIcsBtn').addEventListener('click', () => {
  const minutes = getCheckedMinutes();
  if(selectedKeys.size === 0){
    reminderStatus.textContent = '請先勾選至少一個場次';
    return;
  }
  if(minutes.length === 0){
    reminderStatus.textContent = '請至少選擇一個提前提醒時間';
    return;
  }
  savedMinutesBefore = minutes;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ keys: Array.from(selectedKeys), minutes }));

  const ics = buildIcsContent(minutes);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '偶運會提醒.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  reminderStatus.textContent = '已下載！匯入手機/平板的行事曆 App 即可，即使關閉網頁也會提醒。';
});

// ---------- portrait/landscape hint (mobile) ----------
const orientationHint = document.getElementById('orientationHint');
let orientationHintTimer = null;

function checkOrientationHint(){
  let isPortrait = true;
  try{ isPortrait = window.matchMedia('(orientation: portrait)').matches; }catch(err){}
  const isNarrow = window.innerWidth < 700; // avoid nagging on tall desktop windows
  if(isPortrait && isNarrow){
    orientationHint.classList.remove('hidden');
    clearTimeout(orientationHintTimer);
    orientationHintTimer = setTimeout(() => orientationHint.classList.add('hidden'), 3000);
  }
}
window.addEventListener('load', checkOrientationHint);
window.addEventListener('orientationchange', () => setTimeout(checkOrientationHint, 300));
