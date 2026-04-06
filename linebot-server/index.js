require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const DATA_FILE = path.join(__dirname, 'data', 'contacts.json');

// data/ ディレクトリがなければ作成
if (!fs.existsSync(path.dirname(DATA_FILE))) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}

// 連絡先データ（グループ・ユーザー）を読み書き
function loadContacts() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { groups: [], users: [] };
  }
}

function saveContacts(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// LINE webhook のシグネチャ検証
function verifySignature(rawBody, signature) {
  const hash = crypto
    .createHmac('sha256', CHANNEL_SECRET)
    .update(rawBody)
    .digest('base64');
  return hash === signature;
}

// rawBody を保持しながら JSON パース
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ── Webhook ────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];

  if (!verifySignature(req.rawBody, signature)) {
    console.error('Invalid signature');
    return res.status(400).send('Invalid signature');
  }

  const events = req.body.events || [];
  const contacts = loadContacts();

  for (const event of events) {
    const source = event.source;

    if (event.type === 'join' && source.type === 'group') {
      // ボットがグループに追加された
      const groupId = source.groupId;
      if (!contacts.groups.find((g) => g.groupId === groupId)) {
        const groupName = await fetchGroupName(groupId);
        contacts.groups.push({ groupId, groupName });
        console.log(`Group joined: ${groupName} (${groupId})`);
        saveContacts(contacts);
      }
    } else if (event.type === 'leave' && source.type === 'group') {
      // ボットがグループから退出した
      contacts.groups = contacts.groups.filter(
        (g) => g.groupId !== source.groupId
      );
      saveContacts(contacts);
    } else if (event.type === 'follow') {
      // ユーザーが友達追加した
      const userId = source.userId;
      if (!contacts.users.find((u) => u.userId === userId)) {
        const displayName = await fetchUserName(userId);
        contacts.users.push({ userId, displayName });
        console.log(`User followed: ${displayName} (${userId})`);
        saveContacts(contacts);
      }
    } else if (event.type === 'unfollow') {
      contacts.users = contacts.users.filter(
        (u) => u.userId !== source.userId
      );
      saveContacts(contacts);
    }
  }

  res.status(200).send('OK');
});

// ── グループ・ユーザー一覧 ──────────────────────────────────
app.get('/contacts', (_req, res) => {
  const contacts = loadContacts();
  res.json(contacts);
});

// ── todo をLINEに送信 ─────────────────────────────────────
app.post('/send', async (req, res) => {
  const { to, title, dueDate } = req.body;

  if (!to || !title) {
    return res.status(400).json({ error: 'to と title は必須です' });
  }

  const dateText = dueDate ? `\n📅 ${dueDate}` : '';
  const text = `📌 ${title}${dateText}`;

  try {
    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      {
        to,
        messages: [{ type: 'text', text }],
      },
      {
        headers: {
          Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    res.json({ success: true });
  } catch (error) {
    const detail = error.response?.data || error.message;
    console.error('Send error:', detail);
    res.status(500).json({ error: detail });
  }
});

// ── helpers ───────────────────────────────────────────────
async function fetchGroupName(groupId) {
  try {
    const { data } = await axios.get(
      `https://api.line.me/v2/bot/group/${groupId}/summary`,
      { headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` } }
    );
    return data.groupName;
  } catch {
    return groupId;
  }
}

async function fetchUserName(userId) {
  try {
    const { data } = await axios.get(
      `https://api.line.me/v2/bot/profile/${userId}`,
      { headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` } }
    );
    return data.displayName;
  } catch {
    return userId;
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LINE bot server running on port ${PORT}`));
