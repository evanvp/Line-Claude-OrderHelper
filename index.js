require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { insertRawMessage, insertOrder } = require('./db');

const app = express();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// --- LINE helpers ---

function verifySignature(body, signature) {
  const hash = crypto
    .createHmac('sha256', process.env.LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  return hash === signature;
}

async function lineGet(url) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
  });
  return res;
}

async function getGroupName(groupId) {
  if (!groupId) return '個人對話';
  try {
    const res = await lineGet(`https://api.line.me/v2/bot/group/${groupId}/summary`);
    if (!res.ok) return groupId;
    const data = await res.json();
    return data.groupName || groupId;
  } catch {
    return groupId;
  }
}

async function getDisplayName(userId, groupId) {
  try {
    const url = groupId
      ? `https://api.line.me/v2/bot/group/${groupId}/member/${userId}`
      : `https://api.line.me/v2/bot/profile/${userId}`;
    const res = await lineGet(url);
    if (!res.ok) return userId;
    const data = await res.json();
    return data.displayName || userId;
  } catch {
    return userId;
  }
}

async function downloadImage(messageId) {
  const res = await lineGet(`https://api-data.line.me/v2/bot/message/${messageId}/content`);
  if (!res.ok) return null;
  const imgDir = path.join(__dirname, 'images');
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir);
  const filePath = path.join(imgDir, `${messageId}.jpg`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// --- Claude helpers ---

async function analyzeText(text) {
  const prompt = `你是一個訂單資訊擷取助理。請判斷以下訊息是否包含購買訂單意圖。

如果包含訂單，請回傳 JSON 陣列，每個商品一個物件：
[
  { "product": "商品名稱", "quantity": "數量（純數字）", "price": "單價（純數字，若無則填 0）" }
]

如果完全不是訂單，只回傳：
[]

訊息：${text}

只回傳 JSON，不要加其他說明。`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].text.trim();
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  return JSON.parse(match[0]);
}

async function analyzeImage(imagePath) {
  const imageData = fs.readFileSync(imagePath).toString('base64');
  const prompt = `這是一張訂單圖片（可能是手寫）。請擷取所有訂單項目，回傳 JSON 陣列：
[
  { "product": "商品名稱", "quantity": "數量（純數字）", "price": "單價（純數字，若無則填 0）" }
]

若圖片沒有訂單資訊，回傳 []。只回傳 JSON，不要加其他說明。`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageData } },
        { type: 'text', text: prompt },
      ],
    }],
  });

  const raw = response.content[0].text.trim();
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  return JSON.parse(match[0]);
}

// --- Webhook ---

app.use('/webhook', express.raw({ type: 'application/json' }));

app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];
  if (!verifySignature(req.body, signature)) {
    console.warn('簽名驗證失敗，忽略此請求。');
    return res.sendStatus(401);
  }

  res.sendStatus(200);

  let body;
  try {
    body = JSON.parse(req.body.toString());
  } catch {
    return;
  }

  for (const event of body.events || []) {
    if (event.type !== 'message') continue;

    const msgType = event.message.type;
    if (msgType !== 'text' && msgType !== 'image') continue;

    const userId  = event.source.userId  || 'unknown';
    const groupId = event.source.groupId || null;
    const now     = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });

    const [displayName, groupName] = await Promise.all([
      getDisplayName(userId, groupId),
      getGroupName(groupId),
    ]);

    let rawId, items;

    if (msgType === 'text') {
      const text = event.message.text;
      rawId = insertRawMessage({
        createdAt: now, groupId, groupName,
        userId, userName: displayName,
        type: 'text', content: text, imagePath: null,
      });
      console.log(`[訊息] ${groupName} / ${displayName}：${text}`);
      items = await analyzeText(text);

    } else {
      const imagePath = await downloadImage(event.message.id);
      rawId = insertRawMessage({
        createdAt: now, groupId, groupName,
        userId, userName: displayName,
        type: 'image', content: null, imagePath,
      });
      console.log(`[圖片] ${groupName} / ${displayName} → ${imagePath}`);
      items = imagePath ? await analyzeImage(imagePath) : [];
    }

    if (!items.length) {
      console.log('  -> 非訂單，略過。');
      continue;
    }

    console.log(`已偵測到潛在訂單，正在寫入資料庫... (${items.length} 項)`);
    for (const item of items) {
      insertOrder({
        createdAt: now, groupName, customer: displayName,
        product: item.product, quantity: item.quantity, price: item.price,
        rawMessageId: rawId,
      });
      console.log(`  -> 已寫入：${item.product} x${item.quantity}`);
    }
  }
});

// --- API 端點（前端使用）---

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/orders', (_req, res) => {
  const { search, from, to } = _req.query;
  const { getOrders } = require('./db');
  res.json(getOrders({ search, from, to }));
});

app.get('/api/unrecognized', (_req, res) => {
  const { getUnrecognized } = require('./db');
  res.json(getUnrecognized());
});

// --- 啟動 ---

app.get('/', (_req, res) => res.redirect('/index.html'));

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`伺服器啟動，監聽 port ${PORT}`);
  console.log(`前端介面：http://localhost:${PORT}`);
});
