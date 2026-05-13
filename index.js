require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { createObjectCsvWriter } = require('csv-writer');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const csvWriter = createObjectCsvWriter({
  path: 'orders.csv',
  header: [
    { id: 'date', title: 'Date' },
    { id: 'customer', title: 'Customer' },
    { id: 'product', title: 'Product' },
    { id: 'quantity', title: 'Quantity' },
    { id: 'price', title: 'Price' },
    { id: 'rawMessage', title: 'RawMessage' },
  ],
  append: true,
});

const ORDER_KEYWORDS = ['+1', '要買', '訂購', '數量', '幾個', '幾件', '購買', '下單', '訂', '買', '元', '個', '件', '份'];

function containsOrderKeyword(text) {
  return ORDER_KEYWORDS.some((kw) => text.includes(kw));
}

function verifySignature(body, signature) {
  const hash = crypto
    .createHmac('sha256', process.env.LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  return hash === signature;
}

async function extractOrderWithClaude(message) {
  const prompt = `你是一個訂單資訊擷取助理。請判斷以下訊息是否包含購買訂單意圖。
如果是訂單，請以 JSON 格式回傳以下欄位（所有値用繁體中文）：
{
  "isOrder": true,
  "customer": "顧客名稱（若無則填 unknown）",
  "product": "商品名稱",
  "quantity": "數量（純數字）",
  "price": "單價（純數字，若無則填 0）"
}

如果不是訂單，只回傳：
{ "isOrder": false }

訊息：${message}

只回傳 JSON，不要加其他說明。`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { isOrder: false };
  return JSON.parse(jsonMatch[0]);
}

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
    console.error('JSON 解析失敗');
    return;
  }

  for (const event of body.events || []) {
    if (event.type !== 'message' || event.message.type !== 'text') continue;

    const text = event.message.text;
    const userId = event.source.userId || 'unknown';

    if (!containsOrderKeyword(text)) continue;

    console.log(`[偵測到潛在訂單] 用戶：${userId} | 訊息：${text}`);
    console.log('已偵測到潛在訂單，正在寫入 CSV...');

    try {
      const result = await extractOrderWithClaude(text);
      if (!result.isOrder) {
        console.log('  -> Claude 判斷：非訂單，略過。');
        continue;
      }

      const row = {
        date: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
        customer: result.customer || userId,
        product: result.product || '',
        quantity: result.quantity || '',
        price: result.price || '0',
        rawMessage: text.replace(/,/g, '，'),
      };

      await csvWriter.writeRecords([row]);
      console.log(`  -> 已寫入 orders.csv：${JSON.stringify(row)}`);
    } catch (err) {
      console.error('  -> 處理訂單時發生錯誤：', err.message);
    }
  }
});

app.get('/', (_req, res) => res.send('LINE Order Recorder is running.'));

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`伺服器啟動，監聴 port ${PORT}`);
  console.log('等待 LINE Webhook 訊息...');
});
