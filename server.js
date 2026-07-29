// 偶運會時間對應表 — Web Push reminder backend
//
// This is the piece a static HTML file can never do on its own: a server that
// stays alive and pushes a real system notification to a subscribed device at
// exactly the right moment, even if the phone's screen is off and the browser
// app is fully backgrounded — because the push travels through Apple/Google's
// own push infrastructure, not through any code running in the page/tab.
//
// Storage is a flat JSON file on disk. That's fine for a small personal tool
// like this, but read the README section on Render's disk persistence before
// relying on it long-term.

require('dotenv').config();

const express = require('express');
const compression = require('compression');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const PORT = process.env.PORT || 3000;

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:example@example.com';

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY environment variables. See README.md.');
  process.exit(1);
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// ---------- tiny JSON-file "database" ----------
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    return { subscriptions: {}, reminders: [] };
  }
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
let db = loadData();

function persist() {
  saveData(db);
}

// ---------- app ----------
const app = express();
app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // Only truly static, rarely-changing assets (images) get a long cache. Everything that's
    // actual application code (html/css/js/sw.js) uses `no-cache`, which does NOT mean "don't
    // cache" — it means "always ask the server first". Express's static middleware already sets
    // ETag/Last-Modified, so that check is a cheap 304 response when nothing changed, and only
    // re-downloads the full file when it actually did. This avoids the trap of someone's browser
    // silently running week-old code after a deploy.
    if (/\.(png|jpe?g|gif|webp|svg|ico)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Register / update a push subscription for a given anonymous device id.
// deviceId is generated client-side once and stored in localStorage so the
// same browser reuses the same id across visits.
app.post('/api/subscribe', (req, res) => {
  const { deviceId, subscription } = req.body || {};
  if (!deviceId || !subscription) {
    return res.status(400).json({ error: 'deviceId and subscription are required' });
  }
  db.subscriptions[deviceId] = subscription;
  persist();
  res.json({ ok: true });
});

app.post('/api/unsubscribe', (req, res) => {
  const { deviceId } = req.body || {};
  if (deviceId) {
    delete db.subscriptions[deviceId];
    db.reminders = db.reminders.filter(r => r.deviceId !== deviceId);
    persist();
  }
  res.json({ ok: true });
});

// Replace the full set of reminders for a device (simplest possible sync model —
// the client always sends its complete desired list, we overwrite).
app.post('/api/reminders', (req, res) => {
  const { deviceId, reminders } = req.body || {};
  if (!deviceId || !Array.isArray(reminders)) {
    return res.status(400).json({ error: 'deviceId and reminders[] are required' });
  }
  db.reminders = db.reminders.filter(r => r.deviceId !== deviceId);
  const now = Date.now();
  reminders.forEach(r => {
    if (!r.triggerAt || !r.title || !r.body) return;
    db.reminders.push({
      id: `${deviceId}-${r.key}-${r.triggerAt}`,
      deviceId,
      key: r.key,
      title: r.title,
      body: r.body,
      triggerAt: r.triggerAt, // epoch ms
      sent: r.triggerAt < now, // don't re-fire anything already in the past
    });
  });
  persist();
  res.json({ ok: true, count: db.reminders.filter(r => r.deviceId === deviceId).length });
});

app.get('/api/reminders', (req, res) => {
  const { deviceId } = req.query;
  res.json({ reminders: db.reminders.filter(r => r.deviceId === deviceId) });
});

app.delete('/api/reminders', (req, res) => {
  const { deviceId } = req.body || {};
  db.reminders = db.reminders.filter(r => r.deviceId !== deviceId);
  persist();
  res.json({ ok: true });
});

// delete a single reminder by id — used by the "查看已排程的推播提醒" list so a specific
// pending item can be removed without wiping out everything else
app.delete('/api/reminders/:id', (req, res) => {
  const { id } = req.params;
  const { deviceId } = req.body || {};
  const before = db.reminders.length;
  db.reminders = db.reminders.filter(r => !(r.id === id && r.deviceId === deviceId));
  persist();
  res.json({ ok: true, deleted: before - db.reminders.length });
});

// keep-alive endpoint for external cron pingers (see README) — also doubles as
// a manual "check now" trigger, harmless to call anytime
app.get('/api/tick', async (req, res) => {
  const sent = await runScheduler();
  res.json({ ok: true, sent });
});

// lightweight health check — used by the self-ping keep-alive below, and can also be
// pointed at by an external uptime monitor if you want one
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ---------- the actual scheduler ----------
async function runScheduler() {
  const now = Date.now();
  const due = db.reminders.filter(r => !r.sent && r.triggerAt <= now);
  let sentCount = 0;

  for (const reminder of due) {
    const sub = db.subscriptions[reminder.deviceId];
    if (!sub) {
      reminder.sent = true; // no subscription to send to, drop it
      continue;
    }
    try {
      await webpush.sendNotification(sub, JSON.stringify({
        title: reminder.title,
        body: reminder.body,
      }));
      sentCount++;
    } catch (err) {
      // 404/410 means the subscription is gone (user revoked permission, uninstalled, etc.)
      if (err.statusCode === 404 || err.statusCode === 410) {
        delete db.subscriptions[reminder.deviceId];
      } else {
        console.error('push send failed', err.statusCode, err.body);
      }
    }
    reminder.sent = true;
  }

  if (due.length > 0) {
    // prune old sent reminders (older than 1 day) so the file doesn't grow forever
    const cutoff = now - 24 * 60 * 60 * 1000;
    db.reminders = db.reminders.filter(r => !r.sent || r.triggerAt > cutoff);
    persist();
  }
  return sentCount;
}

// check every 30 seconds while the process is alive
setInterval(() => { runScheduler().catch(err => console.error(err)); }, 30 * 1000);

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// --- Render 防止休眠 --- //
// Only matters on Render itself (RENDER=true is set automatically by Render's environment) —
// running this locally or elsewhere would just be pinging yourself for no reason.
if (process.env.RENDER === 'true') {
  const SELF_URL = process.env.RENDER_EXTERNAL_URL;

  if (!SELF_URL) {
    console.warn('⚠️ RENDER_EXTERNAL_URL 未設定，保活機制無法啟用（Render 通常會自動提供這個變數）');
  } else {
    const interval = 14 * 60 * 1000; // 每14分鐘 ping 一次（免費方案 15 分鐘無流量就會睡著）
    console.log(`🕓 Render 保活功能啟用（09:00~23:59），每 ${interval / 60000} 分鐘檢查一次`);

    setInterval(async () => {
      // 取得台灣時間（UTC+8）
      const now = new Date();
      const taiwanHour = (now.getUTCHours() + 8) % 24;
      const taiwanMinute = now.getUTCMinutes();

      // 只在 09:00~23:59 保活，凌晨 0~8 點不觸發（省得整晚白白耗掉免費方案的執行時數）
      if (taiwanHour >= 9) {
        try {
          const res = await fetch(`${SELF_URL}/api/health`);
          if (res.ok) {
            console.log(`✅ 保活成功（台灣時間 ${taiwanHour}:${taiwanMinute.toString().padStart(2, '0')}）`);
          } else {
            console.warn('⚠️ 保活請求失敗:', res.status);
          }
        } catch (err) {
          console.warn('⚠️ 保活錯誤:', err.message);
        }
      } else {
        console.log(`🌙 非保活時段（台灣時間 ${taiwanHour}:${taiwanMinute.toString().padStart(2, '0')}），略過`);
      }
    }, interval);
  }
}
