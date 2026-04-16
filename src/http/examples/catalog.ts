export interface ExampleApp {
  id: string;
  name: string;
  description: string;
  tags: string[];
  files: Record<string, string>;
}

const EXPRESS_INVENTORY_API: ExampleApp = {
  id: 'express-inventory-api',
  name: 'Inventory API',
  description: 'Express.js REST API with in-memory inventory store',
  tags: ['backend', 'node', 'express', 'rest'],
  files: {
    'package.json': JSON.stringify(
      {
        name: 'inventory-api',
        version: '1.0.0',
        scripts: { start: 'node index.js' },
        dependencies: { express: '^4.21.0' },
      },
      null,
      2,
    ),
    'index.js': `const express = require('express');
const app = express();
app.use(express.json());

const items = new Map();
let nextId = 1;

app.get('/items', (_req, res) => {
  res.json([...items.values()]);
});

app.get('/items/:id', (req, res) => {
  const item = items.get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

app.post('/items', (req, res) => {
  const { name, quantity, price } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const item = { id: nextId++, name, quantity: quantity ?? 0, price: price ?? 0 };
  items.set(item.id, item);
  res.status(201).json(item);
});

app.put('/items/:id', (req, res) => {
  const item = items.get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Not found' });
  Object.assign(item, req.body, { id: item.id });
  res.json(item);
});

app.delete('/items/:id', (req, res) => {
  if (!items.delete(Number(req.params.id))) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(204).end();
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(\`Inventory API on port \${port}\`));
`,
  },
};

const REACT_STOREFRONT: ExampleApp = {
  id: 'react-storefront',
  name: 'Storefront SPA',
  description: 'React storefront with product catalog and cart',
  tags: ['frontend', 'react', 'vite', 'spa'],
  files: {
    'package.json': JSON.stringify(
      {
        name: 'storefront',
        version: '1.0.0',
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'vite build',
          preview: 'vite preview',
        },
        dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
        devDependencies: { '@vitejs/plugin-react': '^4.3.1', vite: '^5.3.1' },
      },
      null,
      2,
    ),
    'vite.config.js': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
`,
    'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Storefront</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
`,
    'src/main.jsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);
`,
    'src/App.jsx': `import { useState } from 'react';

const PRODUCTS = [
  { id: 1, name: 'Wireless Keyboard', price: 49.99 },
  { id: 2, name: 'USB-C Hub', price: 34.99 },
  { id: 3, name: 'Monitor Stand', price: 29.99 },
  { id: 4, name: 'Desk Lamp', price: 24.99 },
];

export default function App() {
  const [cart, setCart] = useState([]);

  const addToCart = (product) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === product.id);
      if (existing) return prev.map((i) => i.id === product.id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { ...product, qty: 1 }];
    });
  };

  const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <h1>Storefront</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {PRODUCTS.map((p) => (
          <div key={p.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
            <h3>{p.name}</h3>
            <p>\${p.price.toFixed(2)}</p>
            <button onClick={() => addToCart(p)}>Add to Cart</button>
          </div>
        ))}
      </div>
      {cart.length > 0 && (
        <div style={{ marginTop: 32, padding: 16, background: '#f9f9f9', borderRadius: 8 }}>
          <h2>Cart ({cart.reduce((s, i) => s + i.qty, 0)} items)</h2>
          {cart.map((i) => (
            <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <span>{i.name} x{i.qty}</span>
              <span>\${(i.price * i.qty).toFixed(2)}</span>
            </div>
          ))}
          <hr />
          <strong>Total: \${total.toFixed(2)}</strong>
        </div>
      )}
    </div>
  );
}
`,
  },
};

const FULLSTACK_CHAT: ExampleApp = {
  id: 'fullstack-chat',
  name: 'Chat App',
  description: 'Express backend + React frontend chat application',
  tags: ['fullstack', 'node', 'react', 'websocket'],
  files: {
    'package.json': JSON.stringify(
      {
        name: 'chat-app',
        version: '1.0.0',
        scripts: {
          start: 'node server/index.js',
          'build:client': 'cd client && npm install && npm run build',
        },
        dependencies: { express: '^4.21.0', ws: '^8.18.0' },
      },
      null,
      2,
    ),
    'server/index.js': `const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));

const messages = [];

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'history', messages }));

  ws.on('message', (raw) => {
    const data = JSON.parse(raw);
    const msg = { user: data.user, text: data.text, ts: Date.now() };
    messages.push(msg);
    if (messages.length > 200) messages.shift();
    const payload = JSON.stringify({ type: 'message', ...msg });
    wss.clients.forEach((c) => { if (c.readyState === 1) c.send(payload); });
  });
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(\`Chat server on port \${port}\`));
`,
    'client/package.json': JSON.stringify(
      {
        name: 'chat-client',
        version: '1.0.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build' },
        dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
        devDependencies: { '@vitejs/plugin-react': '^4.3.1', vite: '^5.3.1' },
      },
      null,
      2,
    ),
    'client/index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Chat</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
`,
    'client/vite.config.js': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/ws': { target: 'ws://localhost:3000', ws: true }, '/api': 'http://localhost:3000' } },
});
`,
    'client/src/main.jsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);
`,
    'client/src/App.jsx': `import { useState, useEffect, useRef } from 'react';

export default function App() {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [user] = useState('user-' + Math.random().toString(36).slice(2, 6));
  const wsRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(\`\${proto}://\${location.host}/ws\`);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'history') setMessages(data.messages);
      else if (data.type === 'message') setMessages((prev) => [...prev, data]);
    };

    return () => ws.close();
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = () => {
    if (!text.trim()) return;
    wsRef.current?.send(JSON.stringify({ user, text }));
    setText('');
  };

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <h1>Chat</h1>
      <div style={{ height: 400, overflowY: 'auto', border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 12 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 8 }}>
            <strong>{m.user}</strong>: {m.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Type a message..." style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
        <button onClick={send} style={{ padding: '8px 20px' }}>Send</button>
      </div>
    </div>
  );
}
`,
  },
};

const EXPRESS_POSTGRES_STORE: ExampleApp = {
  id: 'express-postgres-store',
  name: 'Store API + Postgres',
  description: 'Express REST API with PostgreSQL for product storage',
  tags: ['backend', 'node', 'express', 'postgres', 'database'],
  files: {
    'package.json': JSON.stringify(
      {
        name: 'store-api',
        version: '1.0.0',
        scripts: { start: 'node index.js' },
        dependencies: { express: '^4.21.0', pg: '^8.13.0' },
      },
      null,
      2,
    ),
    'docker-compose.yml': `services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: store
      POSTGRES_USER: store
      POSTGRES_PASSWORD: store
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql

volumes:
  pgdata:
`,
    'init.sql': `CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO products (name, description, price, stock) VALUES
  ('Mechanical Keyboard', 'Cherry MX switches, RGB backlight', 89.99, 50),
  ('Ergonomic Mouse', 'Vertical design, wireless', 45.99, 120),
  ('Monitor Arm', 'Gas spring, VESA mount', 59.99, 30);
`,
    'index.js': `const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://store:store@localhost:5432/store',
});

app.get('/products', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM products ORDER BY id');
  res.json(rows);
});

app.get('/products/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

app.post('/products', async (req, res) => {
  const { name, description, price, stock } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const { rows } = await pool.query(
    'INSERT INTO products (name, description, price, stock) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, description || '', price || 0, stock || 0]
  );
  res.status(201).json(rows[0]);
});

app.put('/products/:id', async (req, res) => {
  const { name, description, price, stock } = req.body;
  const { rows } = await pool.query(
    'UPDATE products SET name=COALESCE($1,name), description=COALESCE($2,description), price=COALESCE($3,price), stock=COALESCE($4,stock) WHERE id=$5 RETURNING *',
    [name, description, price, stock, req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

app.delete('/products/:id', async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(\`Store API on port \${port}\`));
`,
  },
};

const FLASK_NOTES_API: ExampleApp = {
  id: 'flask-notes-api',
  name: 'Notes API (Python)',
  description: 'Flask REST API for note-taking with SQLite',
  tags: ['backend', 'python', 'flask', 'sqlite', 'database'],
  files: {
    'requirements.txt': `flask==3.1.0
gunicorn==23.0.0
`,
    'app.py': `import sqlite3
import os
from flask import Flask, request, jsonify, g

app = Flask(__name__)
DB_PATH = os.environ.get("DB_PATH", "notes.db")


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.execute("""
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            body TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    db.commit()
    db.close()


@app.get("/notes")
def list_notes():
    rows = get_db().execute("SELECT * FROM notes ORDER BY created_at DESC").fetchall()
    return jsonify([dict(r) for r in rows])


@app.get("/notes/<int:note_id>")
def get_note(note_id):
    row = get_db().execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if row is None:
        return jsonify({"error": "Not found"}), 404
    return jsonify(dict(row))


@app.post("/notes")
def create_note():
    data = request.get_json()
    title = data.get("title")
    if not title:
        return jsonify({"error": "Title required"}), 400
    db = get_db()
    cursor = db.execute(
        "INSERT INTO notes (title, body) VALUES (?, ?)",
        (title, data.get("body", "")),
    )
    db.commit()
    row = db.execute("SELECT * FROM notes WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201


@app.delete("/notes/<int:note_id>")
def delete_note(note_id):
    db = get_db()
    cursor = db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    db.commit()
    if cursor.rowcount == 0:
        return jsonify({"error": "Not found"}), 404
    return "", 204


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
`,
    Procfile: `web: gunicorn app:app --bind 0.0.0.0:$PORT
`,
  },
};

export const EXAMPLE_APPS: ExampleApp[] = [
  EXPRESS_INVENTORY_API,
  REACT_STOREFRONT,
  FULLSTACK_CHAT,
  EXPRESS_POSTGRES_STORE,
  FLASK_NOTES_API,
];

export function getExample(id: string): ExampleApp | undefined {
  return EXAMPLE_APPS.find((e) => e.id === id);
}
