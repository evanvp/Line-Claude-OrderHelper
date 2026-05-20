# LINE 訂單管理系統

A silent LINE bot that listens to messages, uses Claude AI to detect and extract orders, and stores them for review.

---

## Version History

### v1 — Basic Order Recorder
**Commit:** `731d83f`

**Architecture:**
```
LINE message → keyword filter → Claude Haiku (JSON) → orders.csv
```

**Features:**
- Express webhook receives LINE messages
- Keyword filter (`要買`, `訂購`, `個`, `元` etc.) as a pre-check before calling Claude
- Claude Haiku extracts order info and returns a single JSON object
- Writes to `orders.csv` (Date, Customer, Product, Quantity, Price, RawMessage)
- Fully silent — no replies sent back to LINE users
- `generate_report.js` reads CSV and generates a styled `report.html` via Claude Sonnet

**Known limitations:**
- Keyword filter could miss orders that don't use expected vocabulary
- One message always produces one CSV row (multi-product orders get merged into one cell)
- Customer name shows as `unknown` if user hasn't added the bot as a friend
- No group name recorded
- No image/photo order support
- No live frontend — report is a static HTML file generated on demand

---

### v2 — SQLite + Frontend + Image Support
**Branch:** `master` (current)

**Architecture:**
```
LINE message (text or image)
  ├── always saved to raw_messages (SQLite) — 100% backup
  └── Claude Haiku (text) / Claude Sonnet Vision (image)
        └── returns array of items → orders table (one row per product)
```

**Features:**
- Removed keyword filter — every message is evaluated by Claude
- Dual-table SQLite database:
  - `raw_messages` — full backup of every message received
  - `orders` — confirmed order rows, linked back to raw message
- Multi-product support — one message can produce multiple order rows
- Image order support — downloads LINE image, runs Claude Sonnet Vision on handwritten or photo orders
- Images saved locally to `/images/` for audit trail
- Group name recorded via LINE Group Summary API
- Display name resolved via Group Member Profile API (works even if user hasn't friended the bot)
- Live web frontend at `http://localhost:8000`:
  - Order table with search, date range filter
  - Summary stats (total orders, unique customers, product types)
  - "Unrecognized messages" tab for manual review of potential missed orders
  - Auto-refreshes every 30 seconds

**Files added/changed:**
| File | Change |
|------|--------|
| `db.js` | New — SQLite setup, insert/query helpers |
| `index.js` | Rewritten — no filter, image handling, array response, API endpoints |
| `public/index.html` | New — frontend UI |

---

### v3 — Planned
> In progress

TBD — polish and enhancements based on v2 real-world testing.

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
Copy `.env` and fill in your keys:
```
LINE_CHANNEL_ACCESS_TOKEN=your_token
LINE_CHANNEL_SECRET=your_secret
ANTHROPIC_API_KEY=your_key
PORT=8000
```

### 3. Run
```bash
node index.js
```

Frontend available at `http://localhost:8000`

### 4. Expose to LINE (VS Code Port Forwarding or ngrok)
Set your webhook URL in LINE Developer Console:
```
https://<your-tunnel-url>/webhook
```

---

## Project Structure
```
├── index.js              # Main server — webhook + Claude logic
├── db.js                 # SQLite helpers
├── generate_report.js    # Standalone report generator (v1 era)
├── public/
│   └── index.html        # Frontend UI
├── images/               # Downloaded LINE image orders
├── orders.db             # SQLite database (auto-created)
├── orders.csv            # Legacy v1 CSV (kept for reference)
└── .env                  # API keys (not committed)
```
