const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'orders.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS raw_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT    NOT NULL,
    group_id    TEXT,
    group_name  TEXT,
    user_id     TEXT,
    user_name   TEXT,
    type        TEXT    NOT NULL,
    content     TEXT,
    image_path  TEXT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no       TEXT    NOT NULL UNIQUE,
    created_at     TEXT    NOT NULL,
    group_name     TEXT,
    customer       TEXT,
    shipped        INTEGER NOT NULL DEFAULT 0,
    raw_message_id INTEGER REFERENCES raw_messages(id)
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id  INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product   TEXT,
    quantity  TEXT,
    price     TEXT
  );
`);

// 產生訂單號：ORD-YYYYMMDD-XXXX
function generateOrderNo() {
  const today = new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' })
    .replace(/\//g, '');
  const prefix = `ORD-${today}-`;
  const last = db.prepare(
    `SELECT order_no FROM orders WHERE order_no LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`${prefix}%`);
  const seq = last ? parseInt(last.order_no.split('-').pop(), 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// 新增 raw message，回傳 id
function insertRawMessage({ createdAt, groupId, groupName, userId, userName, type, content, imagePath }) {
  return db.prepare(`
    INSERT INTO raw_messages (created_at, group_id, group_name, user_id, user_name, type, content, image_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(createdAt, groupId, groupName, userId, userName, type, content, imagePath).lastInsertRowid;
}

// 新增一筆訂單（含多個 items），回傳 order_no
function insertOrder({ createdAt, groupName, customer, items, rawMessageId }) {
  const orderNo = generateOrderNo();
  const orderId = db.prepare(`
    INSERT INTO orders (order_no, created_at, group_name, customer, raw_message_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(orderNo, createdAt, groupName, customer, rawMessageId).lastInsertRowid;

  const insertItem = db.prepare(`
    INSERT INTO order_items (order_id, product, quantity, price) VALUES (?, ?, ?, ?)
  `);
  for (const item of items) {
    insertItem.run(orderId, item.product, item.quantity, item.price);
  }
  return orderNo;
}

// 查詢訂單列表（含 items）
function getOrders({ search, from, to, customer, groupName } = {}) {
  let sql = `
    SELECT o.id, o.order_no, o.created_at, o.group_name, o.customer, o.shipped,
           r.content as raw_content, r.image_path, r.type as msg_type
    FROM orders o
    LEFT JOIN raw_messages r ON o.raw_message_id = r.id
    WHERE 1=1
  `;
  const params = [];
  if (from)       { sql += ' AND o.created_at >= ?';                           params.push(from); }
  if (to)         { sql += ' AND o.created_at <= ?';                           params.push(to + ' 23:59:59'); }
  if (customer)   { sql += ' AND o.customer = ?';                              params.push(customer); }
  if (groupName)  { sql += ' AND o.group_name = ?';                            params.push(groupName); }
  if (search)     { sql += ' AND (o.customer LIKE ? OR r.content LIKE ?)';     params.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY o.created_at DESC';

  const orders = db.prepare(sql).all(...params);
  const getItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  return orders.map(o => ({ ...o, items: getItems.all(o.id) }));
}

// 取不重複的顧客和群組（用於 dropdown）
function getFilterOptions() {
  const customers  = db.prepare('SELECT DISTINCT customer  FROM orders WHERE customer  IS NOT NULL ORDER BY customer').all().map(r => r.customer);
  const groupNames = db.prepare('SELECT DISTINCT group_name FROM orders WHERE group_name IS NOT NULL ORDER BY group_name').all().map(r => r.group_name);
  return { customers, groupNames };
}

// 更新 order_item 的商品名 / 數量
function updateOrderItem(id, { product, quantity }) {
  db.prepare('UPDATE order_items SET product = ?, quantity = ? WHERE id = ?').run(product, quantity, id);
}

// 切換出貨狀態
function toggleShipped(orderId) {
  db.prepare('UPDATE orders SET shipped = CASE WHEN shipped = 0 THEN 1 ELSE 0 END WHERE id = ?').run(orderId);
}

// 未辨識訊息
function getUnrecognized() {
  return db.prepare(`
    SELECT r.*
    FROM raw_messages r
    LEFT JOIN orders o ON o.raw_message_id = r.id
    WHERE o.id IS NULL
    ORDER BY r.created_at DESC
  `).all();
}

module.exports = {
  insertRawMessage, insertOrder,
  getOrders, getFilterOptions,
  updateOrderItem, toggleShipped,
  getUnrecognized,
};
