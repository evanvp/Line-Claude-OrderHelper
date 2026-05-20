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
    created_at     TEXT NOT NULL,
    group_name     TEXT,
    customer       TEXT,
    product        TEXT,
    quantity       TEXT,
    price          TEXT,
    raw_message_id INTEGER REFERENCES raw_messages(id)
  );
`);

function insertRawMessage({ createdAt, groupId, groupName, userId, userName, type, content, imagePath }) {
  return db.prepare(`
    INSERT INTO raw_messages (created_at, group_id, group_name, user_id, user_name, type, content, image_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(createdAt, groupId, groupName, userId, userName, type, content, imagePath).lastInsertRowid;
}

function insertOrder({ createdAt, groupName, customer, product, quantity, price, rawMessageId }) {
  db.prepare(`
    INSERT INTO orders (created_at, group_name, customer, product, quantity, price, raw_message_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(createdAt, groupName, customer, product, quantity, price, rawMessageId);
}

function getOrders({ search, from, to } = {}) {
  let sql = `
    SELECT o.*, r.content as raw_content, r.image_path
    FROM orders o
    LEFT JOIN raw_messages r ON o.raw_message_id = r.id
    WHERE 1=1
  `;
  const params = [];
  if (from)   { sql += ' AND o.created_at >= ?'; params.push(from); }
  if (to)     { sql += ' AND o.created_at <= ?'; params.push(to); }
  if (search) { sql += ' AND (o.customer LIKE ? OR o.product LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY o.created_at DESC';
  return db.prepare(sql).all(...params);
}

function getUnrecognized() {
  return db.prepare(`
    SELECT r.*
    FROM raw_messages r
    LEFT JOIN orders o ON o.raw_message_id = r.id
    WHERE o.id IS NULL
    ORDER BY r.created_at DESC
  `).all();
}

module.exports = { insertRawMessage, insertOrder, getOrders, getUnrecognized };
