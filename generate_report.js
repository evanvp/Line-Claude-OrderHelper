require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function generateReport() {
  const csvPath = path.join(__dirname, 'orders.csv');

  if (!fs.existsSync(csvPath)) {
    console.error('找不到 orders.csv，請先收集一些訂單再執行報表。');
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf8').trim();
  const rows = csvContent.split('\n');

  if (rows.length <= 1) {
    console.log('orders.csv 目前沒有任何訂單資料。');
    process.exit(0);
  }

  console.log(`讀取到 ${rows.length - 1} 筆訂單，正在請 Claude 分析...`);

  const prompt = [
    '你是一個銷售分析師。以下是從 LINE 收集到的訂單 CSV 資料：',
    '',
    csvContent,
    '',
    '請根據這份資料產出一份完整的繁體中文銷售報表，格式為 HTML。',
    '',
    '報表需包含：',
    '1. 摘要卡片：總訂單數、總營業額、最熱銷商品、平均客單價',
    '2. 各商品銷售統計表格（商品名稱、總數量、總金額、佔比）',
    '3. 訂單明細表格（日期、顧客、商品、數量、單價、小計）',
    '4. 銷售趨勢文字分析（3-5 句話）',
    '5. 建議事項（2-3 點）',
    '',
    'HTML 需使用內嵌 CSS 讓報表美觀，可使用漸層色、卡片陰影等現代設計。',
    '回傳完整 HTML 檔案內容（包含 <!DOCTYPE html> 到 </html>）。',
  ].join('\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const html = response.content[0].text.trim();
  const htmlMatch = html.match(/<!DOCTYPE html>[\s\S]*<\/html>/i);
  const finalHtml = htmlMatch ? htmlMatch[0] : html;

  const reportPath = path.join(__dirname, 'report.html');
  fs.writeFileSync(reportPath, finalHtml, 'utf8');

  console.log('\n========== 報表已產出 ==========');
  console.log(finalHtml);
  console.log('\n=================================');
  console.log(`報表已儲存至：${reportPath}`);
}

generateReport().catch((err) => {
  console.error('產生報表時發生錯誤：', err.message);
  process.exit(1);
});
