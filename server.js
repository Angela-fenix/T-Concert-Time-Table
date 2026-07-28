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
    // sw.js and index.html must always be re-checked so updates take effect immediately;
    // everything else (css/js/image) is safe to cache aggressively since filenames don't change.
    if (filePath.endsWith('sw.js') || filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days
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

// keep-alive endpoint for external cron pingers (see README) — also doubles as
// a manual "check now" trigger, harmless to call anytime
app.get('/api/tick', async (req, res) => {
  const sent = await runScheduler();
  res.json({ ok: true, sent });
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
