import { createServer } from 'node:http';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'invoices.sqlite');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

if (Boolean(ADMIN_USER) !== Boolean(ADMIN_PASSWORD)) {
  throw new Error('Set both ADMIN_USER and ADMIN_PASSWORD, or leave both unset for a local demo.');
}
if (!['127.0.0.1', 'localhost', '::1'].includes(HOST) && (!ADMIN_USER || !ADMIN_PASSWORD)) {
  throw new Error('Non-loopback binding requires ADMIN_USER and ADMIN_PASSWORD.');
}
await mkdir(DATA_DIR, { recursive: true });
await mkdir(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    doc_no TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    language TEXT NOT NULL DEFAULT 'th_en',
    currency TEXT NOT NULL DEFAULT 'THB',
    issue_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    seller_name TEXT NOT NULL DEFAULT '',
    seller_tax_id TEXT NOT NULL DEFAULT '',
    seller_branch TEXT NOT NULL DEFAULT '',
    seller_address TEXT NOT NULL DEFAULT '',
    seller_email TEXT NOT NULL DEFAULT '',
    seller_phone TEXT NOT NULL DEFAULT '',
    customer_name TEXT NOT NULL DEFAULT '',
    customer_tax_id TEXT NOT NULL DEFAULT '',
    customer_branch TEXT NOT NULL DEFAULT '',
    customer_address TEXT NOT NULL DEFAULT '',
    customer_email TEXT NOT NULL DEFAULT '',
    customer_phone TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    terms TEXT NOT NULL DEFAULT '',
    discount_rate REAL NOT NULL DEFAULT 0,
    vat_rate REAL NOT NULL DEFAULT 7,
    withholding_rate REAL NOT NULL DEFAULT 3,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS line_items (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    quantity REAL NOT NULL DEFAULT 1,
    unit TEXT NOT NULL DEFAULT '',
    unit_price REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON documents(updated_at);
  CREATE INDEX IF NOT EXISTS idx_documents_search ON documents(doc_no, customer_name, seller_name);
`);

seedDatabase();

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(requestUrl.pathname);

    if (pathname.startsWith('/api/')) {
      if (!isAuthorized(req, res, pathname, requestUrl)) return;
      await routeApi(req, res, pathname, requestUrl);
      return;
    }

    if (pathname === '/' && !isAuthorized(req, res, pathname, requestUrl)) return;
    await serveStatic(req, res, pathname);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Invoice app running at http://localhost:${server.address().port}`);
  console.log(`SQLite database: ${DB_PATH}`);
  if (!ADMIN_USER || !ADMIN_PASSWORD) {
    console.log('ADMIN_USER/ADMIN_PASSWORD are not set. The editor is open to anyone who can reach this server.');
  }
});

async function routeApi(req, res, pathname, requestUrl) {
  const segments = pathname.split('/').filter(Boolean);

  if (segments[1] === 'settings') {
    await routeSettings(req, res, segments);
    return;
  }

  if (segments[1] !== 'documents') {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  if (req.method === 'GET' && segments.length === 2) {
    const search = requestUrl.searchParams.get('search') || '';
    sendJson(res, 200, { documents: listDocuments(search) });
    return;
  }

  if (req.method === 'POST' && segments.length === 2) {
    const payload = await readJson(req);
    const document = saveDocument(payload);
    sendJson(res, 201, { document });
    return;
  }

  if (segments.length >= 3) {
    const id = segments[2];

    if (req.method === 'GET' && segments.length === 3) {
      const document = readDocument(id);
      if (!document) {
        sendJson(res, 404, { error: 'Document not found' });
        return;
      }
      sendJson(res, 200, { document });
      return;
    }

    if (req.method === 'PUT' && segments.length === 3) {
      const payload = await readJson(req);
      const document = saveDocument({ ...payload, id });
      sendJson(res, 200, { document });
      return;
    }

    if (req.method === 'DELETE' && segments.length === 3) {
      db.prepare('DELETE FROM documents WHERE id = ?').run(id);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && segments.length === 4 && segments[3] === 'duplicate') {
      const existing = readDocument(id);
      if (!existing) {
        sendJson(res, 404, { error: 'Document not found' });
        return;
      }
      const copy = saveDocument({
        ...existing,
        id: undefined,
        items: existing.items.map(({ id: _id, ...item }) => item),
        docNo: nextDocumentNumber(existing.documentType),
        status: 'draft',
        issueDate: todayIso(),
        dueDate: addDaysIso(30)
      });
      sendJson(res, 201, { document: copy });
      return;
    }
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}

async function routeSettings(req, res, segments) {
  if (segments.length !== 2) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  if (req.method === 'GET') {
    sendJson(res, 200, { settings: readSettings() });
    return;
  }

  if (req.method === 'PUT') {
    const payload = await readJson(req);
    const settings = saveSettings(payload.settings || payload);
    sendJson(res, 200, { settings });
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const isAppRoute = pathname === '/' || pathname.startsWith('/view/');
  const cleanPath = isAppRoute ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, cleanPath);

  const relativePath = path.relative(PUBLIC_DIR, filePath);
  if (relativePath === '..' || relativePath.startsWith('..' + path.sep) || path.isAbsolute(relativePath)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  if (!existsSync(filePath) || !(await stat(filePath)).isFile()) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  const body = await readFile(filePath);
  const extension = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': mimeType(filePath),
    'Cache-Control': ['.png', '.svg', '.ico'].includes(extension) ? 'public, max-age=86400' : 'no-store'
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
}

function isAuthorized(req, res, pathname, requestUrl) {
  if (!ADMIN_USER || !ADMIN_PASSWORD) return true;
  if (req.method === 'GET' && pathname.startsWith('/view/')) return true;

  if (req.method === 'GET' && pathname === '/api/settings') return true;
  if (
    req.method === 'GET' &&
    pathname.startsWith('/api/documents/') &&
    requestUrl.searchParams.get('public') === '1'
  ) {
    return true;
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const user = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    if (user === ADMIN_USER && password === ADMIN_PASSWORD) return true;
  }

  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Invoice Desk"',
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify({ error: 'Authentication required' }));
  return false;
}

function listDocuments(search) {
  const like = `%${String(search).trim()}%`;
  const rows = db.prepare(`
    SELECT d.*,
      COALESCE(SUM(i.quantity * i.unit_price), 0) AS subtotal,
      COUNT(i.id) AS item_count
    FROM documents d
    LEFT JOIN line_items i ON i.document_id = d.id
    WHERE ? = '%%'
      OR d.doc_no LIKE ?
      OR d.customer_name LIKE ?
      OR d.seller_name LIKE ?
      OR d.status LIKE ?
      OR d.type LIKE ?
    GROUP BY d.id
    ORDER BY datetime(d.updated_at) DESC
  `).all(like, like, like, like, like, like);

  return rows.map((row) => {
    const totals = calculateTotals({
      discountRate: row.discount_rate,
      vatRate: row.vat_rate,
      withholdingRate: row.withholding_rate
    }, row.subtotal);

    return {
      id: row.id,
      docNo: row.doc_no,
      documentType: row.type,
      status: row.status,
      issueDate: row.issue_date,
      dueDate: row.due_date,
      customerName: row.customer_name,
      sellerName: row.seller_name,
      itemCount: row.item_count,
      total: totals.grandTotal,
      updatedAt: row.updated_at
    };
  });
}

function readDocument(id) {
  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  if (!row) return null;
  const items = db.prepare(`
    SELECT id, description, quantity, unit, unit_price
    FROM line_items
    WHERE document_id = ?
    ORDER BY sort_order
  `).all(id);

  return rowToDocument(row, items);
}

function saveDocument(input = {}) {
  const now = new Date().toISOString();
  const id = input.id || randomUUID();
  const existing = db.prepare('SELECT created_at FROM documents WHERE id = ?').get(id);
  const document = normalizeDocument(input, id, existing?.created_at || now);

  db.exec('BEGIN');
  try {
    if (existing) {
      db.prepare(`
        UPDATE documents SET
          doc_no = ?, type = ?, status = ?, language = ?, currency = ?, issue_date = ?, due_date = ?,
          seller_name = ?, seller_tax_id = ?, seller_branch = ?, seller_address = ?, seller_email = ?, seller_phone = ?,
          customer_name = ?, customer_tax_id = ?, customer_branch = ?, customer_address = ?, customer_email = ?, customer_phone = ?,
          notes = ?, terms = ?, discount_rate = ?, vat_rate = ?, withholding_rate = ?, updated_at = ?
        WHERE id = ?
      `).run(
        document.docNo, document.documentType, document.status, document.language, document.currency,
        document.issueDate, document.dueDate,
        document.seller.name, document.seller.taxId, document.seller.branch, document.seller.address, document.seller.email, document.seller.phone,
        document.customer.name, document.customer.taxId, document.customer.branch, document.customer.address, document.customer.email, document.customer.phone,
        document.notes, document.terms, document.discountRate, document.vatRate, document.withholdingRate, now, id
      );
    } else {
      db.prepare(`
        INSERT INTO documents (
          id, doc_no, type, status, language, currency, issue_date, due_date,
          seller_name, seller_tax_id, seller_branch, seller_address, seller_email, seller_phone,
          customer_name, customer_tax_id, customer_branch, customer_address, customer_email, customer_phone,
          notes, terms, discount_rate, vat_rate, withholding_rate, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, document.docNo, document.documentType, document.status, document.language, document.currency,
        document.issueDate, document.dueDate,
        document.seller.name, document.seller.taxId, document.seller.branch, document.seller.address, document.seller.email, document.seller.phone,
        document.customer.name, document.customer.taxId, document.customer.branch, document.customer.address, document.customer.email, document.customer.phone,
        document.notes, document.terms, document.discountRate, document.vatRate, document.withholdingRate, document.createdAt, now
      );
    }

    db.prepare('DELETE FROM line_items WHERE document_id = ?').run(id);
    const insertItem = db.prepare(`
      INSERT INTO line_items (id, document_id, sort_order, description, quantity, unit, unit_price)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    document.items.forEach((item, index) => {
      insertItem.run(item.id || randomUUID(), id, index, item.description, item.quantity, item.unit, item.unitPrice);
    });

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return readDocument(id);
}

function normalizeDocument(input, id, createdAt) {
  const seller = input.seller || {};
  const customer = input.customer || {};
  const documentType = allowed(input.documentType || input.type, [
    'quotation', 'invoice', 'receipt', 'tax_invoice', 'billing_note', 'cash_bill', 'delivery_note'
  ], 'invoice');

  const items = Array.isArray(input.items) && input.items.length > 0 ? input.items : [{
    description: 'สินค้า / บริการ',
    quantity: 1,
    unit: 'รายการ',
    unitPrice: 0
  }];

  return {
    id,
    docNo: clean(input.docNo) || nextDocumentNumber(documentType),
    documentType,
    status: allowed(input.status, ['draft', 'sent', 'paid', 'overdue', 'cancelled'], 'draft'),
    language: allowed(input.language, ['th', 'en', 'th_en'], 'th_en'),
    currency: clean(input.currency || 'THB').slice(0, 8),
    issueDate: clean(input.issueDate) || todayIso(),
    dueDate: clean(input.dueDate) || addDaysIso(30),
    seller: normalizeParty(seller),
    customer: normalizeParty(customer),
    notes: clean(input.notes),
    terms: clean(input.terms),
    discountRate: number(input.discountRate, 0),
    vatRate: number(input.vatRate, 7),
    withholdingRate: number(input.withholdingRate, 3),
    createdAt,
    items: items.map((item) => ({
      id: item.id || randomUUID(),
      description: clean(item.description),
      quantity: number(item.quantity, 1),
      unit: clean(item.unit || 'รายการ'),
      unitPrice: number(item.unitPrice, 0)
    }))
  };
}

function normalizeParty(party) {
  return {
    name: clean(party.name),
    taxId: clean(party.taxId),
    branch: clean(party.branch),
    address: clean(party.address),
    email: clean(party.email),
    phone: clean(party.phone)
  };
}

function rowToDocument(row, items) {
  const document = {
    id: row.id,
    docNo: row.doc_no,
    documentType: row.type,
    status: row.status,
    language: row.language,
    currency: row.currency,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    seller: {
      name: row.seller_name,
      taxId: row.seller_tax_id,
      branch: row.seller_branch,
      address: row.seller_address,
      email: row.seller_email,
      phone: row.seller_phone
    },
    customer: {
      name: row.customer_name,
      taxId: row.customer_tax_id,
      branch: row.customer_branch,
      address: row.customer_address,
      email: row.customer_email,
      phone: row.customer_phone
    },
    notes: row.notes,
    terms: row.terms,
    discountRate: row.discount_rate,
    vatRate: row.vat_rate,
    withholdingRate: row.withholding_rate,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.map((item) => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unit_price
    }))
  };
  document.totals = calculateTotals(document);
  return document;
}

function calculateTotals(document, subtotalOverride) {
  const subtotal = subtotalOverride ?? document.items.reduce((sum, item) => {
    return sum + number(item.quantity, 0) * number(item.unitPrice, 0);
  }, 0);
  const discount = subtotal * number(document.discountRate, 0) / 100;
  const taxable = Math.max(0, subtotal - discount);
  const vat = taxable * number(document.vatRate, 0) / 100;
  const withholding = taxable * number(document.withholdingRate, 0) / 100;
  const grandTotal = taxable + vat - withholding;

  return {
    subtotal: round2(subtotal),
    discount: round2(discount),
    taxable: round2(taxable),
    vat: round2(vat),
    withholding: round2(withholding),
    grandTotal: round2(grandTotal)
  };
}

function nextDocumentNumber(type = 'invoice') {
  const prefixes = {
    quotation: 'QT',
    invoice: 'INV',
    receipt: 'REC',
    tax_invoice: 'TAX',
    billing_note: 'BIL',
    cash_bill: 'CASH',
    delivery_note: 'DN'
  };
  const prefix = prefixes[type] || 'INV';
  const year = new Date().getFullYear();
  const pattern = `${prefix}-${year}-%`;
  const row = db.prepare('SELECT COUNT(*) AS count FROM documents WHERE doc_no LIKE ?').get(pattern);
  return `${prefix}-${year}-${String(row.count + 1).padStart(5, '0')}`;
}

function seedDatabase() {
  const row = db.prepare('SELECT COUNT(*) AS count FROM documents').get();
  if (row.count > 0) return;

  saveDocument({
    docNo: 'INV-2026-00001',
    documentType: 'tax_invoice',
    status: 'sent',
    issueDate: todayIso(),
    dueDate: addDaysIso(30),
    seller: {
      name: 'Demo Seller (Fictional)' ,
      taxId: '',
      branch: 'สำนักงานใหญ่',
      address: 'Example address — demonstration only',
      phone: '',
      email: 'seller@example.com'
    },
    customer: {
      name: 'Demo Customer (Fictional)' ,
      taxId: '',
      branch: 'สำนักงานใหญ่',
      address: 'Example address — demonstration only',
      phone: '',
      email: 'customer@example.com'
    },
    notes: 'ขอบคุณที่ใช้บริการ',
    terms: 'ชำระเงินภายใน 30 วัน',
    discountRate: 0,
    vatRate: 7,
    withholdingRate: 3,
    items: [
      { description: 'บริการออกแบบและจัดทำเอกสาร', quantity: 1, unit: 'งาน', unitPrice: 12000 },
      { description: 'ค่าดูแลระบบรายเดือน', quantity: 3, unit: 'เดือน', unitPrice: 2500 }
    ]
  });
}

function readSettings() {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('app');
  if (!row) return defaultSettings();
  try {
    return normalizeSettings(JSON.parse(row.value));
  } catch {
    return defaultSettings();
  }
}

function saveSettings(input = {}) {
  const settings = normalizeSettings(input);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run('app', JSON.stringify(settings), now);
  return settings;
}

function defaultSettings() {
  return {
    brandName: 'Invoice Desk',
    logoMode: 'document',
    logoInitials: 'ID',
    logoImage: '',
    theme: {
      accent: '#007c78',
      accentDark: '#00635f',
      accentSoft: '#e5f6f5',
      background: '#f7f8fa',
      surface: '#ffffff',
      surfaceAlt: '#f1f5f5',
      text: '#121617',
      muted: '#667579',
      line: '#d9e1e2',
      tableHeader: '#007c78',
      totalBackground: '#e5f6f5'
    }
  };
}

function normalizeSettings(input = {}) {
  const fallback = defaultSettings();
  const theme = input.theme || {};
  const logoImage = clean(input.logoImage);

  return {
    brandName: clean(input.brandName || fallback.brandName).slice(0, 80),
    logoMode: allowed(input.logoMode, ['document', 'receipt', 'building', 'initials', 'image'], fallback.logoMode),
    logoInitials: clean(input.logoInitials || fallback.logoInitials).slice(0, 4).toUpperCase(),
    logoImage: logoImage.startsWith('data:image/') && logoImage.length <= 700_000 ? logoImage : '',
    theme: {
      accent: color(theme.accent, fallback.theme.accent),
      accentDark: color(theme.accentDark, fallback.theme.accentDark),
      accentSoft: color(theme.accentSoft, fallback.theme.accentSoft),
      background: color(theme.background, fallback.theme.background),
      surface: color(theme.surface, fallback.theme.surface),
      surfaceAlt: color(theme.surfaceAlt, fallback.theme.surfaceAlt),
      text: color(theme.text, fallback.theme.text),
      muted: color(theme.muted, fallback.theme.muted),
      line: color(theme.line, fallback.theme.line),
      tableHeader: color(theme.tableHeader, fallback.theme.tableHeader),
      totalBackground: color(theme.totalBackground, fallback.theme.totalBackground)
    }
  };
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('Request body too large');
  }
  return body ? JSON.parse(body) : {};
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function mimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  }[extension] || 'application/octet-stream';
}

function allowed(value, values, fallback) {
  return values.includes(value) ? value : fallback;
}

function clean(value) {
  return String(value ?? '').trim();
}

function color(value, fallback) {
  const text = clean(value);
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
