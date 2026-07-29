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

// events pre-checked by default for first-time visitors (until they save their own selection)
const DEFAULT_SELECTED_KEYS = [
  '20260801::表演舞台::19:20::20:35',   // 8/1 表演舞台 場次D
  '20260801::福利VIP::19:10::20:05',    // 8/1 福利VIP 場次D 入座時間
  '20260801::水槍挑戰::12:10::12:20',   // 8/1 水槍挑戰 MAX / 家齊
  '20260801::水槍挑戰::14:00::14:20',   // 8/1 水槍挑戰 浦洋 / 峻廷
  '20260801::戶外舞台::18:50::19:00',   // 8/1 戶外舞台 星願舞台-承隆
  '20260802::表演舞台::19:35::20:45',   // 8/2 表演舞台 場次H
  '20260802::福利VIP::19:25::20:15',    // 8/2 福利VIP 場次H 入座時間
  '20260802::握手會::16:00::17:00',     // 8/2 握手會 FEniX / HAKU
];

function loadSavedReminders(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw){
      // no saved state yet on this device — start from the built-in defaults
      DEFAULT_SELECTED_KEYS.forEach(k => { if(eventRegistry[k]) selectedKeys.add(k); });
      return;
    }
    const saved = JSON.parse(raw);
    (saved.keys || []).forEach(k => { if(eventRegistry[k]) selectedKeys.add(k); });
    savedMinutesBefore = saved.minutes || [];
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

  if(typeof rebuildStickyHeaderClone === 'function') rebuildStickyHeaderClone();
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
document.addEventListener('keydown', (e) => { if(e.key === 'Escape'){ modalOverlay.classList.add('hidden'); reminderModalOverlay.classList.add('hidden'); document.getElementById('mapModalOverlay').classList.add('hidden'); const sm = document.getElementById('scheduledModalOverlay'); if(sm) sm.classList.add('hidden'); } });

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
  savedMinutesBefore = [];
  try{ localStorage.removeItem(STORAGE_KEY); }catch(err){}
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
      // default to "right now" so you can immediately test without doing date math yourself —
      // once you've touched a field, we remember whatever you set instead of resetting it
      if(!debugOverrides[key]){
        debugOverrides[key] = toDatetimeLocalValue(new Date());
      }
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
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);

  if(isIOS){
    // iOS Safari: navigating straight to a data: URI with the calendar MIME type pops the
    // "Add All Events" screen immediately — skips the separate "go find the downloaded file" step
    const dataUri = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
    window.location.href = dataUri;
    reminderStatus.textContent = '請在跳出的畫面點「加入全部」完成加入行事曆。';
  } else {
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '偶運會提醒.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    reminderStatus.textContent = '已下載！點開下載的檔案，通常會直接跳出加入行事曆的畫面。';
  }
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

// ---------- floating header clone (keeps the header pinned while the page scrolls normally) ----------
// Native `position: sticky` on <thead> doesn't reliably stay pinned to the viewport once its
// ancestor also has `overflow-x: auto` for horizontal scrolling (a well-known CSS limitation),
// and we want to keep that normal horizontal-scroll / normal page-scroll behavior as-is.
// So instead: when the real header scrolls above the viewport top (but the table is still
// partially visible below it), show a fixed-position clone of the header row in its place,
// keeping column widths and horizontal scroll position in sync with the real table.
const stickyClone = document.getElementById('stickyHeaderClone');
let stickyCloneTableWrap = null;

function rebuildStickyHeaderClone(){
  stickyCloneTableWrap = document.querySelector('.table-wrap');
  if(!stickyCloneTableWrap){ stickyClone.classList.add('hidden'); return; }
  const realHeaderRow = stickyCloneTableWrap.querySelector('thead tr');
  if(!realHeaderRow){ stickyClone.classList.add('hidden'); return; }

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  thead.appendChild(realHeaderRow.cloneNode(true));
  table.appendChild(thead);
  stickyClone.innerHTML = '';
  stickyClone.appendChild(table);

  syncStickyHeaderClone();
}

function syncStickyHeaderClone(){
  if(!stickyCloneTableWrap) return;
  const realThs = stickyCloneTableWrap.querySelectorAll('thead th');
  const cloneThs = stickyClone.querySelectorAll('thead th');
  if(realThs.length !== cloneThs.length) return;
  realThs.forEach((th, i) => {
    const w = th.getBoundingClientRect().width;
    cloneThs[i].style.width = w + 'px';
    cloneThs[i].style.minWidth = w + 'px';
    cloneThs[i].style.maxWidth = w + 'px';
  });
  const rect = stickyCloneTableWrap.getBoundingClientRect();
  stickyClone.style.width = rect.width + 'px';
  stickyClone.style.left = rect.left + 'px';
  stickyClone.scrollLeft = stickyCloneTableWrap.scrollLeft;
}

function updateStickyHeaderVisibility(){
  if(!stickyCloneTableWrap || stickyCloneTableWrap.offsetParent === null){
    stickyClone.classList.add('hidden');
    return;
  }
  const rect = stickyCloneTableWrap.getBoundingClientRect();
  const headerHeight = stickyClone.offsetHeight || 44;
  const shouldShow = rect.top < 0 && rect.bottom > headerHeight;
  if(shouldShow){
    syncStickyHeaderClone();
    stickyClone.classList.remove('hidden');
  } else {
    stickyClone.classList.add('hidden');
  }
}

window.addEventListener('scroll', updateStickyHeaderVisibility, { passive: true });
window.addEventListener('resize', () => { syncStickyHeaderClone(); updateStickyHeaderVisibility(); });
document.querySelector('.table-wrap') && document.querySelector('.table-wrap').addEventListener('scroll', () => {
  if(stickyCloneTableWrap) stickyClone.scrollLeft = stickyCloneTableWrap.scrollLeft;
});
// re-bind the table-wrap scroll listener each time the schedule screen is (re)shown, since the
// element inside it doesn't change but this keeps things simple and safe to call repeatedly
const _origShowSchedule = showSchedule;
showSchedule = function(dateKey){
  _origShowSchedule(dateKey);
  const wrap = document.querySelector('.table-wrap');
  if(wrap && !wrap.dataset.stickyBound){
    wrap.dataset.stickyBound = '1';
    wrap.addEventListener('scroll', () => { if(stickyCloneTableWrap) stickyClone.scrollLeft = wrap.scrollLeft; });
  }
  setTimeout(updateStickyHeaderVisibility, 50);
};

// ---------- background push notifications (works even backgrounded / screen off) ----------
// Requires being served over HTTPS (e.g. the Render deployment) — Service Workers don't run
// at all over a plain file:// page, so this section quietly no-ops in that case.

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

function getDeviceId(){
  let id = null;
  try{ id = localStorage.getItem('oundongxi_device_id'); }catch(err){}
  if(!id){
    id = 'dev-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    try{ localStorage.setItem('oundongxi_device_id', id); }catch(err){}
  }
  return id;
}

function pushSupported(){
  return 'serviceWorker' in navigator && 'PushManager' in window && window.isSecureContext;
}

function isIOSDevice(){
  return /iP(hone|ad|od)/.test(navigator.userAgent) ||
    // iPadOS 13+ reports itself as "Macintosh" but still has touch support, unlike a real Mac
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandaloneDisplay(){
  return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

// gives a specific, actionable reason instead of a generic "not supported" — the actual cause
// on iPhone is almost always "opened via a Safari tab instead of the home-screen icon", not a
// genuine lack of support
function diagnosePushSupport(){
  if(!window.isSecureContext){
    return '需透過 https 網址開啟才能使用背景推播（本機檔案無法使用這項功能）';
  }
  if('serviceWorker' in navigator && 'PushManager' in window){
    return null; // fully supported, nothing to report
  }
  if(isIOSDevice() && !isStandaloneDisplay()){
    return '偵測到你是用 Safari 分頁開啟的，不是從主畫面圖示開啟。iPhone 一定要先「加入主畫面」，然後關掉這個分頁，改用主畫面上新出現的圖示重新開啟，才能啟用背景推播。';
  }
  if(isIOSDevice()){
    return '此裝置不支援背景推播，iPhone 需要 iOS 16.4（含）以上版本才有支援，可以到「設定→一般→關於本機」確認目前的系統版本。';
  }
  return '此瀏覽器不支援背景推播通知';
}

async function ensurePushSubscription(){
  if(!pushSupported()) return null;
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if(!sub){
    const res = await fetch('/api/vapid-public-key');
    const { publicKey } = await res.json();
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  await fetch('/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: getDeviceId(), subscription: sub }),
  });
  return sub;
}

async function syncPushReminders(minutes){
  const items = Array.from(selectedKeys).map(k => ({ key: k, item: eventRegistry[k] })).filter(x => x.item);
  const reminders = [];
  items.forEach(({key, item}) => {
    const startDate = getEffectiveStartDate(item, key);
    const firstLine = item.text.split('\n')[0];
    minutes.forEach(min => {
      const triggerAt = startDate.getTime() - min * 60000;
      reminders.push({
        key: `${key}::${min}`,
        title: `⏰ ${min} 分鐘後開始`,
        body: `${item.cat}｜${item.start} ${firstLine}`,
        triggerAt,
      });
    });
  });
  const res = await fetch('/api/reminders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: getDeviceId(), reminders }),
  });
  return res.json();
}

const enablePushBtn = document.getElementById('enablePushBtn');
const pushStatus = document.getElementById('pushStatus');

if(enablePushBtn){
  const reason = diagnosePushSupport();
  if(reason){
    enablePushBtn.disabled = true;
    pushStatus.textContent = reason;
  }

  enablePushBtn.addEventListener('click', async () => {
    const minutes = getCheckedMinutes();
    if(selectedKeys.size === 0){ pushStatus.textContent = '請先勾選至少一個場次'; return; }
    if(minutes.length === 0){ pushStatus.textContent = '請至少選擇一個提前提醒時間'; return; }

    enablePushBtn.disabled = true;
    pushStatus.textContent = '啟用中…';
    try{
      const perm = await Notification.requestPermission();
      if(perm !== 'granted'){
        pushStatus.textContent = '通知權限被拒絕，無法啟用背景推播。';
        enablePushBtn.disabled = false;
        return;
      }
      await ensurePushSubscription();
      const result = await syncPushReminders(minutes);
      savedMinutesBefore = minutes;
      pushStatus.textContent = `背景推播已啟用！已排程 ${result.count ?? minutes.length * selectedKeys.size} 筆提醒，就算把 App 切到背景或關螢幕也會收到。`;
    }catch(err){
      pushStatus.textContent = '啟用失敗：' + err.message;
    }
    enablePushBtn.disabled = false;
  });
}

// ---------- view currently-scheduled push reminders (queries the server directly) ----------
const scheduledModalOverlay = document.getElementById('scheduledModalOverlay');
const scheduledList = document.getElementById('scheduledList');
const viewScheduledBtn = document.getElementById('viewScheduledBtn');
const refreshScheduledBtn = document.getElementById('refreshScheduledBtn');

function formatReminderTime(ms){
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function loadScheduledReminders(){
  scheduledList.innerHTML = '<li><span class="sl-what">載入中…</span></li>';
  try{
    const res = await fetch(`/api/reminders?deviceId=${encodeURIComponent(getDeviceId())}`);
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const { reminders } = await res.json();

    if(!reminders || reminders.length === 0){
      scheduledList.innerHTML = '<li><div class="scheduled-empty">這台裝置目前在伺服器上沒有任何已排程的推播提醒。</div></li>';
      return;
    }

    reminders.sort((a,b) => a.triggerAt - b.triggerAt);
    scheduledList.innerHTML = reminders.map(r => {
      const statusCls = r.sent ? 'sent' : 'pending';
      const statusText = r.sent ? '已發送' : '等待中';
      const deleteBtn = r.sent ? '' : `<button class="sl-delete" data-id="${escapeAttr(r.id)}" aria-label="刪除這則提醒">🗑</button>`;
      return `<li>
        <span class="sl-what">${escapeHtml(r.title)}<br><span style="color:var(--ink-faint)">${escapeHtml(r.body)}</span></span>
        <span class="sl-when">${formatReminderTime(r.triggerAt)}</span>
        <span class="sl-status ${statusCls}">${statusText}</span>
        ${deleteBtn}
      </li>`;
    }).join('');

    scheduledList.querySelectorAll('.sl-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        btn.disabled = true;
        try{
          const res = await fetch(`/api/reminders/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: getDeviceId() }),
          });
          if(!res.ok) throw new Error('HTTP ' + res.status);
          await loadScheduledReminders();
        }catch(err){
          btn.disabled = false;
          alert('刪除失敗：' + err.message);
        }
      });
    });
  }catch(err){
    scheduledList.innerHTML = `<li><div class="scheduled-error">查詢失敗：${escapeHtml(err.message)}<br>（如果還沒按過「啟用背景推播並儲存」，伺服器上本來就還沒有資料）</div></li>`;
  }
}

if(viewScheduledBtn){
  viewScheduledBtn.addEventListener('click', () => {
    scheduledModalOverlay.classList.remove('hidden');
    loadScheduledReminders();
  });
  document.getElementById('scheduledModalClose').addEventListener('click', () => scheduledModalOverlay.classList.add('hidden'));
  scheduledModalOverlay.addEventListener('click', (e) => { if(e.target === scheduledModalOverlay) scheduledModalOverlay.classList.add('hidden'); });
  refreshScheduledBtn.addEventListener('click', loadScheduledReminders);
}
