require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// 環境変数で固定登録できる（カンマ区切りで複数指定可）
// 例: FIXED_GROUP_IDS=Cxxx,Cyyy
const fixedGroupIds = (process.env.FIXED_GROUP_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// メモリ上に保持（再デプロイでリセットされるが webhookで再登録される）
const contacts = {
  groups: fixedGroupIds.map((id) => ({ groupId: id, groupName: id })),
  users: [],
};

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

// 疎通確認用
app.get('/', (_req, res) => res.send('LINE bot server is running'));

// ── Webhook ────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];

  if (CHANNEL_SECRET && !verifySignature(req.rawBody, signature)) {
    console.error('Invalid signature');
    return res.status(400).send('Invalid signature');
  }

  const events = req.body.events || [];

  for (const event of events) {
    const source = event.source;

    if (event.type === 'join' && source.type === 'group') {
      const groupId = source.groupId;
      if (!contacts.groups.find((g) => g.groupId === groupId)) {
        const groupName = await fetchGroupName(groupId);
        contacts.groups.push({ groupId, groupName });
        console.log(`Group joined: ${groupName} (${groupId})`);
      }
    } else if (event.type === 'leave' && source.type === 'group') {
      contacts.groups = contacts.groups.filter(
        (g) => g.groupId !== source.groupId
      );
    } else if (event.type === 'follow') {
      const userId = source.userId;
      if (!contacts.users.find((u) => u.userId === userId)) {
        const displayName = await fetchUserName(userId);
        contacts.users.push({ userId, displayName });
        console.log(`User followed: ${displayName} (${userId})`);
      }
    } else if (event.type === 'unfollow') {
      contacts.users = contacts.users.filter(
        (u) => u.userId !== source.userId
      );
    }
  }

  res.status(200).send('OK');
});

// ── グループ・ユーザー一覧 ──────────────────────────────────
app.get('/contacts', (_req, res) => {
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
