const DOC_TYPES = {
  quotation: { th: 'ใบเสนอราคา', en: 'Quotation' },
  invoice: { th: 'ใบแจ้งหนี้', en: 'Invoice' },
  receipt: { th: 'ใบเสร็จรับเงิน', en: 'Receipt' },
  tax_invoice: { th: 'ใบกำกับภาษี', en: 'Tax Invoice' },
  billing_note: { th: 'ใบวางบิล', en: 'Billing Note' },
  cash_bill: { th: 'บิลเงินสด', en: 'Cash Bill' },
  delivery_note: { th: 'ใบส่งของ', en: 'Delivery Note' }
};

const STATUS_LABELS = {
  draft: 'ร่าง',
  sent: 'รอชำระ',
  paid: 'ชำระแล้ว',
  overdue: 'เกินกำหนด',
  cancelled: 'ยกเลิก'
};

const DEFAULT_SETTINGS = {
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

const THEME_CONTROLS = [
  ['accent', 'สีหลัก / ปุ่ม'],
  ['accentDark', 'สี hover / ตัวอักษรเน้น'],
  ['accentSoft', 'พื้นหลังแถบที่เลือก'],
  ['background', 'พื้นหลังระบบ'],
  ['surface', 'พื้นผิว panel'],
  ['surfaceAlt', 'หัวตาราง / แถบรอง'],
  ['text', 'ตัวอักษรหลัก'],
  ['muted', 'ตัวอักษรรอง'],
  ['line', 'เส้นขอบ'],
  ['tableHeader', 'หัวตารางในเอกสาร'],
  ['totalBackground', 'กล่องยอดรวมสุทธิ']
];

const PRESETS = {
  teal: {
    label: 'Teal',
    theme: DEFAULT_SETTINGS.theme
  },
  navy: {
    label: 'Navy',
    theme: {
      accent: '#1f4e79',
      accentDark: '#173b5c',
      accentSoft: '#e8f1f8',
      background: '#f6f8fb',
      surface: '#ffffff',
      surfaceAlt: '#edf2f7',
      text: '#111827',
      muted: '#64748b',
      line: '#d6dee8',
      tableHeader: '#1f4e79',
      totalBackground: '#e8f1f8'
    }
  },
  graphite: {
    label: 'Graphite',
    theme: {
      accent: '#3f4752',
      accentDark: '#252b33',
      accentSoft: '#eceff2',
      background: '#f7f7f8',
      surface: '#ffffff',
      surfaceAlt: '#f0f1f2',
      text: '#15171a',
      muted: '#6a717a',
      line: '#d7dadd',
      tableHeader: '#3f4752',
      totalBackground: '#eceff2'
    }
  }
};

const state = {
  documents: [],
  allDocuments: [],
  current: null,
  activeStatus: '',
  view: 'documents',
  previewScale: 100,
  settings: structuredClone(DEFAULT_SETTINGS),
  readonly: location.pathname.startsWith('/view/')
};

const els = {
  editorPanel: document.querySelector('#editorPanel'),
  preview: document.querySelector('#invoicePreview'),
  documentList: document.querySelector('#documentList'),
  searchInput: document.querySelector('#searchInput'),
  quickStatus: document.querySelector('#quickStatus'),
  saveState: document.querySelector('#saveState'),
  brandName: document.querySelector('#brandName'),
  brandMark: document.querySelector('#brandMark'),
  sideRail: document.querySelector('.side-rail'),
  statusTabs: document.querySelector('.status-tabs'),
  newButton: document.querySelector('#newButton'),
  saveButton: document.querySelector('#saveButton'),
  duplicateButton: document.querySelector('#duplicateButton'),
  shareButton: document.querySelector('#shareButton'),
  printButton: document.querySelector('#printButton'),
  deleteButton: document.querySelector('#deleteButton'),
  zoomOutButton: document.querySelector('#zoomOutButton'),
  zoomInButton: document.querySelector('#zoomInButton'),
  previewScale: document.querySelector('#previewScale')
};

const moneyFormatters = new Map();
let previewFrame = 0;
let totalsFrame = 0;
let searchTimer = 0;

await init();

async function init() {
  await loadSettings();
  applySettings();
  bindEvents();

  if (state.readonly) {
    document.body.classList.add('is-readonly');
    await loadPublicDocument();
    return;
  }

  await boot();
}

function bindEvents() {
  els.editorPanel.addEventListener('input', onEditorInput);
  els.editorPanel.addEventListener('change', onEditorChange);
  els.editorPanel.addEventListener('click', onEditorClick);
  els.documentList.addEventListener('click', onDocumentListClick);
  els.statusTabs.addEventListener('click', onStatusTabClick);
  els.sideRail.addEventListener('click', onRailClick);

  els.quickStatus.addEventListener('change', async () => {
    state.activeStatus = els.quickStatus.value;
    syncStatusTabs();
    await loadDocuments();
    renderCurrentView();
  });

  els.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      await loadDocuments();
      renderCurrentView();
    }, 220);
  });

  els.newButton.addEventListener('click', () => {
    state.current = emptyDocument(state.current);
    setView('documents');
    renderPreviewNow();
    setSaveState('เอกสารใหม่');
  });

  els.saveButton.addEventListener('click', saveCurrent);
  els.duplicateButton.addEventListener('click', duplicateCurrent);
  els.shareButton.addEventListener('click', shareCurrent);
  els.printButton.addEventListener('click', () => window.print());
  els.deleteButton.addEventListener('click', deleteCurrent);
  els.zoomOutButton.addEventListener('click', () => setPreviewScale(state.previewScale - 10));
  els.zoomInButton.addEventListener('click', () => setPreviewScale(state.previewScale + 10));
}

async function boot() {
  await loadDocuments();
  if (state.documents[0]) {
    await selectDocument(state.documents[0].id, false);
  } else {
    state.current = emptyDocument();
  }
  renderCurrentView();
  renderPreviewNow();
}

async function loadSettings() {
  try {
    const response = await fetch('/api/settings');
    if (!response.ok) return;
    const payload = await response.json();
    state.settings = mergeSettings(payload.settings);
  } catch {
    state.settings = structuredClone(DEFAULT_SETTINGS);
  }
}

async function loadPublicDocument() {
  const id = location.pathname.split('/view/')[1];
  const response = await fetch(`/api/documents/${encodeURIComponent(id)}?public=1`);
  if (!response.ok) {
    els.preview.innerHTML = '<div class="empty-state">ไม่พบเอกสารที่ต้องการแชร์</div>';
    return;
  }
  const payload = await response.json();
  state.current = payload.document;
  renderPreviewNow();
  setSaveState('โหมดอ่านอย่างเดียว');
}

async function loadDocuments() {
  const response = await fetch(`/api/documents?search=${encodeURIComponent(els.searchInput.value || '')}`);
  const payload = await response.json();
  state.allDocuments = payload.documents || [];
  state.documents = state.activeStatus
    ? state.allDocuments.filter((doc) => doc.status === state.activeStatus)
    : state.allDocuments;
  renderList();
}

async function selectDocument(id, shouldRender = true) {
  const response = await fetch(`/api/documents/${encodeURIComponent(id)}`);
  if (!response.ok) return;
  const payload = await response.json();
  state.current = payload.document;
  renderList();
  if (shouldRender) {
    setView('documents');
    renderPreviewNow();
  }
  setSaveState('โหลดเอกสารแล้ว');
}

async function saveCurrent() {
  if (!state.current) return;
  setSaveState('กำลังบันทึก...');
  const method = state.current.id ? 'PUT' : 'POST';
  const url = state.current.id ? `/api/documents/${encodeURIComponent(state.current.id)}` : '/api/documents';
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.current)
  });
  const payload = await response.json();
  if (!response.ok) {
    setSaveState(payload.error || 'บันทึกไม่สำเร็จ');
    return;
  }
  state.current = payload.document;
  await loadDocuments();
  renderCurrentView();
  renderPreviewNow();
  setSaveState(`บันทึกแล้ว ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`);
}

async function duplicateCurrent() {
  if (!state.current?.id) await saveCurrent();
  if (!state.current?.id) return;

  const response = await fetch(`/api/documents/${encodeURIComponent(state.current.id)}/duplicate`, { method: 'POST' });
  const payload = await response.json();
  if (!response.ok) {
    setSaveState(payload.error || 'ทำสำเนาไม่สำเร็จ');
    return;
  }
  state.current = payload.document;
  await loadDocuments();
  setView('documents');
  renderPreviewNow();
  setSaveState('ทำสำเนาแล้ว');
}

async function shareCurrent() {
  if (!state.current?.id) await saveCurrent();
  if (!state.current?.id) return;
  const url = `${location.origin}/view/${state.current.id}`;
  await navigator.clipboard?.writeText(url).catch(() => null);
  setSaveState('คัดลอกลิงก์แชร์แล้ว');
}

async function deleteCurrent() {
  if (!state.current?.id) return;
  const confirmed = confirm(`ลบเอกสาร ${state.current.docNo || ''}?`);
  if (!confirmed) return;
  await fetch(`/api/documents/${encodeURIComponent(state.current.id)}`, { method: 'DELETE' });
  state.current = null;
  await boot();
  setSaveState('ลบเอกสารแล้ว');
}

async function saveSettings() {
  setSaveState('กำลังบันทึกแบรนด์...');
  const response = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.settings)
  });
  const payload = await response.json();
  if (!response.ok) {
    setSaveState(payload.error || 'บันทึกแบรนด์ไม่สำเร็จ');
    return;
  }
  state.settings = mergeSettings(payload.settings);
  applySettings();
  renderBrandView();
  renderPreviewNow();
  setSaveState('บันทึกแบรนด์แล้ว');
}

function onEditorInput(event) {
  const settingPath = event.target.dataset.setting;
  if (settingPath) {
    setPath(state.settings, settingPath, event.target.value);
    applySettings();
    schedulePreviewRender();
    setSaveState('ตั้งค่ายังไม่ได้บันทึก');
    return;
  }

  const path = event.target.dataset.path;
  if (!path || !state.current) return;
  setPath(state.current, path, event.target.value);
  updateLineAmountFromPath(path);
  scheduleTotalsRender();
  schedulePreviewRender();
  markDirty();
}

async function onEditorChange(event) {
  if (event.target.id === 'logoUpload') {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 600_000) {
      setSaveState('โลโก้ต้องเป็นรูปภาพและไม่เกิน 600 KB');
      return;
    }
    state.settings.logoImage = await readFileAsDataUrl(file);
    state.settings.logoMode = 'image';
    applySettings();
    renderBrandView();
    renderPreviewNow();
    setSaveState('อัปโหลดโลโก้แล้ว ยังไม่ได้บันทึก');
    return;
  }

  const settingPath = event.target.dataset.setting;
  if (settingPath) {
    setPath(state.settings, settingPath, event.target.value);
    applySettings();
    renderBrandView();
    renderPreviewNow();
    setSaveState('ตั้งค่ายังไม่ได้บันทึก');
    return;
  }

  const path = event.target.dataset.path;
  if (!path || !state.current) return;
  setPath(state.current, path, event.target.value);
  if (path === 'documentType' && !state.current.id) state.current.docNo = '';
  renderDocumentsView();
  renderPreviewNow();
  markDirty();
}

async function onEditorClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;

  if (action === 'add-item' && state.current) {
    state.current.items.push({ description: '', quantity: 1, unit: 'รายการ', unitPrice: 0 });
    renderDocumentsView();
    renderPreviewNow();
    markDirty();
  }

  if (action === 'remove-item' && state.current) {
    const index = Number(button.dataset.index);
    state.current.items.splice(index, 1);
    if (state.current.items.length === 0) {
      state.current.items.push({ description: '', quantity: 1, unit: 'รายการ', unitPrice: 0 });
    }
    renderDocumentsView();
    renderPreviewNow();
    markDirty();
  }

  if (action === 'save-settings') await saveSettings();

  if (action === 'reset-settings') {
    state.settings = structuredClone(DEFAULT_SETTINGS);
    applySettings();
    renderBrandView();
    renderPreviewNow();
    setSaveState('รีเซ็ตสีแล้ว ยังไม่ได้บันทึก');
  }

  if (action === 'clear-logo') {
    state.settings.logoImage = '';
    state.settings.logoMode = 'document';
    applySettings();
    renderBrandView();
    renderPreviewNow();
    setSaveState('ลบรูปโลโก้แล้ว ยังไม่ได้บันทึก');
  }

  if (action === 'preset-theme') {
    state.settings.theme = structuredClone(PRESETS[button.dataset.preset].theme);
    applySettings();
    renderBrandView();
    renderPreviewNow();
    setSaveState('เลือกชุดสีแล้ว ยังไม่ได้บันทึก');
  }

  if (action === 'new-for-customer') {
    state.current = emptyDocument(state.current);
    state.current.customer.name = button.dataset.customer || '';
    setView('documents');
    renderPreviewNow();
    setSaveState('สร้างเอกสารจากลูกค้าแล้ว');
  }

  if (action === 'open-doc') {
    await selectDocument(button.dataset.id);
  }
}

async function onDocumentListClick(event) {
  const button = event.target.closest('[data-id]');
  if (!button) return;
  await selectDocument(button.dataset.id);
}

async function onStatusTabClick(event) {
  const button = event.target.closest('[data-status]');
  if (!button) return;
  state.activeStatus = button.dataset.status;
  els.quickStatus.value = state.activeStatus;
  syncStatusTabs();
  await loadDocuments();
  renderCurrentView();
}

function onRailClick(event) {
  const button = event.target.closest('[data-view]');
  if (!button) return;
  setView(button.dataset.view);
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  renderCurrentView();
}

function renderCurrentView() {
  if (state.readonly) return;
  if (state.view === 'customers') {
    renderCustomersView();
    return;
  }
  if (state.view === 'reports') {
    renderReportsView();
    return;
  }
  if (state.view === 'brand') {
    renderBrandView();
    return;
  }
  renderDocumentsView();
}

function renderList() {
  if (!state.documents.length) {
    els.documentList.innerHTML = '<div class="empty-state">ยังไม่มีเอกสาร</div>';
    return;
  }
  els.documentList.innerHTML = state.documents.map((doc) => `
    <button class="doc-card ${state.current?.id === doc.id ? 'active' : ''}" type="button" data-id="${escapeHtml(doc.id)}">
      <span class="doc-card-head">
        <strong>${escapeHtml(doc.docNo)}</strong>
        <span class="badge ${escapeHtml(doc.status)}">${escapeHtml(STATUS_LABELS[doc.status] || doc.status)}</span>
      </span>
      <p>${escapeHtml(doc.customerName || 'ยังไม่ระบุลูกค้า')}</p>
      <span class="doc-card-foot">
        <span>${formatDate(doc.issueDate)}</span>
        <span class="doc-total">${formatMoney(doc.total)}</span>
      </span>
    </button>
  `).join('');
}

function renderDocumentsView() {
  if (!state.current) return;
  const doc = state.current;
  els.editorPanel.innerHTML = `
    <form id="invoiceForm" class="form-shell" autocomplete="off">
      <div class="form-title">
        <h1>สร้าง / แก้ไข${escapeHtml(typeLabel(doc.documentType).th)}</h1>
        <span class="badge ${escapeHtml(doc.status)}">${escapeHtml(STATUS_LABELS[doc.status] || doc.status)}</span>
      </div>

      <section class="section">
        <div class="field-grid three">
          ${selectField('ประเภทเอกสาร', 'documentType', DOC_TYPES, doc.documentType)}
          ${textField('เลขที่เอกสาร', 'docNo', doc.docNo || '', 'ระบบจะออกเลขให้อัตโนมัติถ้าว่าง')}
          ${selectSimpleField('สถานะ', 'status', STATUS_LABELS, doc.status)}
          ${dateField('วันที่ออกเอกสาร', 'issueDate', doc.issueDate)}
          ${dateField('วันที่ครบกำหนด', 'dueDate', doc.dueDate)}
          ${selectSimpleField('ภาษาเอกสาร', 'language', { th: 'ไทย', en: 'English', th_en: 'ไทย / English' }, doc.language)}
        </div>
      </section>

      <section class="section">
        <h2>ข้อมูลผู้ขาย (Seller)</h2>
        ${partyFields('seller', doc.seller)}
      </section>

      <section class="section">
        <h2>ข้อมูลลูกค้า (Customer)</h2>
        ${partyFields('customer', doc.customer)}
      </section>

      <section class="section">
        <h2>รายการสินค้า / บริการ</h2>
        <div class="line-table-wrap">
          <table class="line-table">
            <thead>
              <tr>
                <th>#</th>
                <th>รายการ</th>
                <th>จำนวน</th>
                <th>หน่วย</th>
                <th>ราคา/หน่วย</th>
                <th>มูลค่า</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${doc.items.map((item, index) => lineRow(item, index)).join('')}</tbody>
          </table>
        </div>
        <div class="line-toolbar">
          <button class="ghost small" type="button" data-action="add-item">เพิ่มรายการ</button>
        </div>
      </section>

      <section class="section">
        <div class="totals-grid">
          <div class="field">
            <label for="notes">หมายเหตุ</label>
            <textarea id="notes" data-path="notes">${escapeHtml(doc.notes || '')}</textarea>
            <label for="terms" class="terms-label">เงื่อนไขการชำระเงิน</label>
            <textarea id="terms" data-path="terms">${escapeHtml(doc.terms || '')}</textarea>
          </div>
          <div>
            <div class="field-grid">
              ${numberField('ส่วนลด (%)', 'discountRate', doc.discountRate)}
              ${numberField('VAT (%)', 'vatRate', doc.vatRate)}
              ${numberField('หัก ณ ที่จ่าย (%)', 'withholdingRate', doc.withholdingRate)}
              ${textField('สกุลเงิน', 'currency', doc.currency || 'THB')}
            </div>
            <div id="totalsBox" class="totals-box"></div>
          </div>
        </div>
      </section>
    </form>
  `;
  renderTotalsNow();
}

function renderCustomersView() {
  const customers = customerStats();
  els.editorPanel.innerHTML = `
    <section class="form-shell">
      <div class="form-title">
        <h1>ลูกค้า</h1>
        <span class="badge">${customers.length} รายการ</span>
      </div>
      <div class="view-toolbar">
        <p>สรุปลูกค้าจากเอกสารทั้งหมดในฐานข้อมูล ใช้ปุ่มสร้างเอกสารเพื่อเริ่ม invoice ใหม่จากชื่อลูกค้าเดิม</p>
      </div>
      <div class="customer-grid">
        ${customers.length ? customers.map((customer) => `
          <article class="customer-card">
            <strong>${escapeHtml(customer.name)}</strong>
            <span>${customer.count} เอกสาร</span>
            <b>${formatMoney(customer.total)}</b>
            <button class="ghost small" type="button" data-action="new-for-customer" data-customer="${escapeAttr(customer.name)}">สร้างเอกสาร</button>
          </article>
        `).join('') : '<div class="empty-state">ยังไม่มีข้อมูลลูกค้า</div>'}
      </div>
    </section>
  `;
}

function renderReportsView() {
  const docs = state.allDocuments;
  const total = docs.reduce((sum, doc) => sum + number(doc.total), 0);
  const paid = docs.filter((doc) => doc.status === 'paid').reduce((sum, doc) => sum + number(doc.total), 0);
  const waiting = docs.filter((doc) => ['sent', 'overdue'].includes(doc.status)).reduce((sum, doc) => sum + number(doc.total), 0);
  const byStatus = Object.keys(STATUS_LABELS).map((status) => ({
    status,
    count: docs.filter((doc) => doc.status === status).length
  })).filter((row) => row.count > 0);
  const maxCount = Math.max(1, ...byStatus.map((row) => row.count));

  els.editorPanel.innerHTML = `
    <section class="form-shell">
      <div class="form-title">
        <h1>รายงาน</h1>
        <span class="badge">${docs.length} เอกสาร</span>
      </div>
      <div class="metric-grid">
        ${metricCard('ยอดเอกสารรวม', formatMoney(total))}
        ${metricCard('รับชำระแล้ว', formatMoney(paid))}
        ${metricCard('รอชำระ / เกินกำหนด', formatMoney(waiting))}
        ${metricCard('จำนวนเอกสาร', `${docs.length} ใบ`)}
      </div>
      <section class="section">
        <h2>สถานะเอกสาร</h2>
        <div class="bar-list">
          ${byStatus.map((row) => `
            <div class="bar-row">
              <span>${escapeHtml(STATUS_LABELS[row.status])}</span>
              <div class="bar-track"><i style="width:${(row.count / maxCount) * 100}%"></i></div>
              <strong>${row.count}</strong>
            </div>
          `).join('')}
        </div>
      </section>
      <section class="section">
        <h2>เอกสารล่าสุด</h2>
        <div class="recent-list">
          ${docs.slice(0, 6).map((doc) => `
            <button class="recent-row" type="button" data-action="open-doc" data-id="${escapeAttr(doc.id)}">
              <span>${escapeHtml(doc.docNo)}</span>
              <small>${escapeHtml(doc.customerName || '-')}</small>
              <strong>${formatMoney(doc.total)}</strong>
            </button>
          `).join('')}
        </div>
      </section>
    </section>
  `;
}

function renderBrandView() {
  const settings = state.settings;
  els.editorPanel.innerHTML = `
    <section class="form-shell">
      <div class="form-title">
        <h1>แบรนด์และสีเอกสาร</h1>
        <span class="badge">ปรับใช้ทันที</span>
      </div>
      <div class="brand-preview">
        <div class="brand-mark preview-logo" aria-hidden="true">${logoInnerHtml('preview')}</div>
        <div>
          <strong>${escapeHtml(settings.brandName)}</strong>
          <small>โลโก้และสีนี้จะแสดงทั้งในระบบและตัวอย่างเอกสาร</small>
        </div>
      </div>
      <section class="section">
        <h2>โลโก้</h2>
        <div class="field-grid">
          ${textField('ชื่อระบบ / ชื่อแบรนด์', 'brandName', settings.brandName, '', 'setting')}
          ${selectSimpleField('รูปแบบโลโก้', 'logoMode', {
            document: 'เอกสาร',
            receipt: 'ใบเสร็จ',
            building: 'อาคาร',
            initials: 'ตัวอักษร',
            image: 'รูปภาพ'
          }, settings.logoMode, 'setting')}
          ${textField('ตัวอักษรบนโลโก้', 'logoInitials', settings.logoInitials, 'เช่น ID', 'setting')}
          <div class="field">
            <label>อัปโหลดรูปโลโก้</label>
            <input id="logoUpload" type="file" accept="image/*">
          </div>
        </div>
        <div class="line-toolbar">
          <button class="ghost small" type="button" data-action="clear-logo">ลบรูปโลโก้</button>
        </div>
      </section>
      <section class="section">
        <h2>ชุดสีเร็ว</h2>
        <div class="preset-row">
          ${Object.entries(PRESETS).map(([key, preset]) => `
            <button class="ghost small" type="button" data-action="preset-theme" data-preset="${key}">
              <span class="swatch" style="background:${preset.theme.accent}"></span>${escapeHtml(preset.label)}
            </button>
          `).join('')}
        </div>
      </section>
      <section class="section">
        <h2>ปรับสีแต่ละส่วน</h2>
        <div class="color-grid">
          ${THEME_CONTROLS.map(([key, label]) => colorField(label, `theme.${key}`, settings.theme[key])).join('')}
        </div>
      </section>
      <div class="line-toolbar sticky-actions">
        <button class="primary" type="button" data-action="save-settings">บันทึกแบรนด์</button>
        <button class="ghost" type="button" data-action="reset-settings">รีเซ็ตค่าเริ่มต้น</button>
      </div>
    </section>
  `;
}

function renderTotalsNow() {
  const box = document.querySelector('#totalsBox');
  if (!box || !state.current) return;
  const totals = calculateTotals(state.current);
  box.innerHTML = `
    <div class="total-row"><span>รวมมูลค่าสินค้า</span><strong>${formatMoney(totals.subtotal)}</strong></div>
    <div class="total-row"><span>ส่วนลด</span><strong>${formatMoney(totals.discount)}</strong></div>
    <div class="total-row"><span>ฐานภาษี</span><strong>${formatMoney(totals.taxable)}</strong></div>
    <div class="total-row"><span>ภาษีมูลค่าเพิ่ม</span><strong>${formatMoney(totals.vat)}</strong></div>
    <div class="total-row"><span>หัก ณ ที่จ่าย</span><strong>${formatMoney(totals.withholding)}</strong></div>
    <div class="total-row grand"><span>รวมสุทธิ</span><strong>${formatMoney(totals.grandTotal)}</strong></div>
  `;
}

function renderPreviewNow() {
  if (!state.current) {
    els.preview.innerHTML = '<div class="empty-state">เลือกหรือสร้างเอกสารเพื่อดูตัวอย่าง</div>';
    return;
  }
  const doc = state.current;
  const totals = calculateTotals(doc);
  const label = typeLabel(doc.documentType);
  const items = doc.items.length ? doc.items : [{ description: '', quantity: 0, unit: '', unitPrice: 0 }];

  els.preview.innerHTML = `
    <header class="paper-head">
      <div class="paper-company">
        <div class="paper-logo" aria-hidden="true">${logoInnerHtml('paper')}</div>
        <div>
          <h2>${escapeHtml(doc.seller.name || 'ชื่อบริษัทผู้ขาย')}</h2>
          <p>${escapeHtml(doc.seller.address || '')}</p>
          <p>เลขประจำตัวผู้เสียภาษี ${escapeHtml(doc.seller.taxId || '-')} ${escapeHtml(doc.seller.branch || '')}</p>
          <p>โทร ${escapeHtml(doc.seller.phone || '-')} อีเมล ${escapeHtml(doc.seller.email || '-')}</p>
        </div>
      </div>
      <div class="paper-title">
        <h1>${escapeHtml(label.th)}</h1>
        <h2>${escapeHtml(label.en.toUpperCase())}</h2>
        <div class="paper-meta">
          <div><span>เลขที่ (No.)</span><strong>${escapeHtml(doc.docNo || 'NEW')}</strong></div>
          <div><span>วันที่ (Date)</span><strong>${formatDate(doc.issueDate)}</strong></div>
          <div><span>ครบกำหนด</span><strong>${formatDate(doc.dueDate)}</strong></div>
        </div>
      </div>
    </header>

    <section class="paper-parties">
      ${paperParty('ผู้ขาย (Seller)', doc.seller)}
      ${paperParty('ลูกค้า (Customer)', doc.customer)}
    </section>

    <table class="paper-items">
      <thead>
        <tr>
          <th>#</th>
          <th>รายการ (Description)</th>
          <th>จำนวน<br>(Quantity)</th>
          <th>หน่วย<br>(Unit)</th>
          <th>ราคา/หน่วย<br>(Unit Price)</th>
          <th>มูลค่า<br>(Amount)</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(item.description || '-')}</td>
            <td>${formatNumber(item.quantity)}</td>
            <td>${escapeHtml(item.unit || '')}</td>
            <td>${formatMoney(item.unitPrice)}</td>
            <td>${formatMoney(number(item.quantity) * number(item.unitPrice))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <section class="paper-summary">
      <div class="paper-note">
        <strong>หมายเหตุ / Remark</strong>
        <p>${escapeHtml(doc.notes || '-')}</p>
        <p>${escapeHtml(doc.terms || '')}</p>
      </div>
      <div class="paper-totals">
        <div class="total-row"><span>รวมมูลค่าสินค้า</span><strong>${formatMoney(totals.subtotal)}</strong></div>
        <div class="total-row"><span>ส่วนลด ${formatNumber(doc.discountRate)}%</span><strong>${formatMoney(totals.discount)}</strong></div>
        <div class="total-row"><span>VAT ${formatNumber(doc.vatRate)}%</span><strong>${formatMoney(totals.vat)}</strong></div>
        <div class="total-row"><span>หัก ณ ที่จ่าย ${formatNumber(doc.withholdingRate)}%</span><strong>${formatMoney(totals.withholding)}</strong></div>
        <div class="total-row grand"><span>รวมสุทธิ</span><strong>${formatMoney(totals.grandTotal)}</strong></div>
      </div>
    </section>

    <section class="signature-grid">
      <div>ผู้รับสินค้า / ผู้รับมอบ<br>Goods Received</div>
      <div>ผู้มีอำนาจลงนาม<br>Authorized Signature</div>
    </section>
  `;
  applyPreviewScale();
}

function scheduleTotalsRender() {
  cancelAnimationFrame(totalsFrame);
  totalsFrame = requestAnimationFrame(renderTotalsNow);
}

function schedulePreviewRender() {
  cancelAnimationFrame(previewFrame);
  previewFrame = requestAnimationFrame(renderPreviewNow);
}

function updateLineAmountFromPath(path) {
  const match = path.match(/^items\.(\d+)\.(quantity|unitPrice)$/);
  if (!match || !state.current) return;
  const index = Number(match[1]);
  const cell = document.querySelector(`[data-amount-index="${index}"]`);
  const item = state.current.items[index];
  if (cell && item) cell.textContent = formatMoney(number(item.quantity) * number(item.unitPrice));
}

function lineRow(item, index) {
  const amount = number(item.quantity) * number(item.unitPrice);
  return `
    <tr>
      <td>${index + 1}</td>
      <td><input data-path="items.${index}.description" value="${escapeAttr(item.description)}" placeholder="รายละเอียดสินค้า / บริการ"></td>
      <td><input data-path="items.${index}.quantity" type="number" min="0" step="0.01" value="${escapeAttr(item.quantity)}"></td>
      <td><input data-path="items.${index}.unit" value="${escapeAttr(item.unit)}" placeholder="หน่วย"></td>
      <td><input data-path="items.${index}.unitPrice" type="number" min="0" step="0.01" value="${escapeAttr(item.unitPrice)}"></td>
      <td class="amount-cell" data-amount-index="${index}">${formatMoney(amount)}</td>
      <td><button class="icon-danger" type="button" data-action="remove-item" data-index="${index}" title="ลบรายการ">×</button></td>
    </tr>
  `;
}

function partyFields(prefix, party = {}) {
  return `
    <div class="field-grid">
      ${textField('ชื่อบริษัท / ชื่อลูกค้า', `${prefix}.name`, party.name)}
      ${textField('เลขประจำตัวผู้เสียภาษี', `${prefix}.taxId`, party.taxId)}
      ${textField('สาขา', `${prefix}.branch`, party.branch)}
      ${textField('โทรศัพท์', `${prefix}.phone`, party.phone)}
      ${textField('อีเมล', `${prefix}.email`, party.email)}
      <div class="field full">
        <label>ที่อยู่</label>
        <textarea data-path="${prefix}.address">${escapeHtml(party.address || '')}</textarea>
      </div>
    </div>
  `;
}

function textField(label, path, value = '', placeholder = '', mode = 'path') {
  const attr = mode === 'setting' ? 'data-setting' : 'data-path';
  return `
    <div class="field">
      <label>${escapeHtml(label)}</label>
      <input ${attr}="${escapeAttr(path)}" value="${escapeAttr(value)}" placeholder="${escapeAttr(placeholder)}">
    </div>
  `;
}

function dateField(label, path, value = '') {
  return `
    <div class="field">
      <label>${escapeHtml(label)}</label>
      <input type="date" data-path="${escapeAttr(path)}" value="${escapeAttr(value)}">
    </div>
  `;
}

function numberField(label, path, value = 0) {
  return `
    <div class="field">
      <label>${escapeHtml(label)}</label>
      <input type="number" min="0" step="0.01" data-path="${escapeAttr(path)}" value="${escapeAttr(value)}">
    </div>
  `;
}

function colorField(label, path, value) {
  return `
    <label class="color-control">
      <span>${escapeHtml(label)}</span>
      <input type="color" data-setting="${escapeAttr(path)}" value="${escapeAttr(value)}">
      <code>${escapeHtml(value)}</code>
    </label>
  `;
}

function selectField(label, path, options, value) {
  return `
    <div class="field">
      <label>${escapeHtml(label)}</label>
      <select data-path="${escapeAttr(path)}">
        ${Object.entries(options).map(([key, item]) => `
          <option value="${escapeAttr(key)}" ${key === value ? 'selected' : ''}>${escapeHtml(item.th)} / ${escapeHtml(item.en)}</option>
        `).join('')}
      </select>
    </div>
  `;
}

function selectSimpleField(label, path, options, value, mode = 'path') {
  const attr = mode === 'setting' ? 'data-setting' : 'data-path';
  return `
    <div class="field">
      <label>${escapeHtml(label)}</label>
      <select ${attr}="${escapeAttr(path)}">
        ${Object.entries(options).map(([key, text]) => `
          <option value="${escapeAttr(key)}" ${key === value ? 'selected' : ''}>${escapeHtml(text)}</option>
        `).join('')}
      </select>
    </div>
  `;
}

function paperParty(title, party = {}) {
  return `
    <div class="paper-party">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(party.name || '-')}</p>
      <p>เลขประจำตัวผู้เสียภาษี ${escapeHtml(party.taxId || '-')} ${escapeHtml(party.branch || '')}</p>
      <p>${escapeHtml(party.address || '')}</p>
      <p>${escapeHtml(party.phone || '')} ${escapeHtml(party.email || '')}</p>
    </div>
  `;
}

function metricCard(label, value) {
  return `
    <article class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `;
}

function customerStats() {
  const map = new Map();
  state.allDocuments.forEach((doc) => {
    const name = doc.customerName || 'ยังไม่ระบุลูกค้า';
    const current = map.get(name) || { name, count: 0, total: 0 };
    current.count += 1;
    current.total += number(doc.total);
    map.set(name, current);
  });
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function emptyDocument(previous) {
  const today = new Date();
  const due = new Date(today);
  due.setDate(today.getDate() + 30);
  return {
    documentType: 'invoice',
    docNo: '',
    status: 'draft',
    language: 'th_en',
    currency: 'THB',
    issueDate: isoDate(today),
    dueDate: isoDate(due),
    seller: previous?.seller || {
      name: '',
      taxId: '',
      branch: 'สำนักงานใหญ่',
      address: '',
      email: '',
      phone: ''
    },
    customer: { name: '', taxId: '', branch: '', address: '', email: '', phone: '' },
    notes: '',
    terms: 'ชำระเงินภายใน 30 วัน',
    discountRate: 0,
    vatRate: 7,
    withholdingRate: 3,
    items: [{ description: '', quantity: 1, unit: 'รายการ', unitPrice: 0 }]
  };
}

function setPreviewScale(value) {
  state.previewScale = Math.min(130, Math.max(70, value));
  applyPreviewScale();
}

function applyPreviewScale() {
  els.previewScale.textContent = `${state.previewScale}%`;
  els.preview.style.setProperty('--preview-scale', String(state.previewScale / 100));
}

function applySettings() {
  const root = document.documentElement;
  const theme = state.settings.theme;
  root.style.setProperty('--bg', theme.background);
  root.style.setProperty('--surface', theme.surface);
  root.style.setProperty('--surface-2', theme.surfaceAlt);
  root.style.setProperty('--ink', theme.text);
  root.style.setProperty('--muted', theme.muted);
  root.style.setProperty('--line', theme.line);
  root.style.setProperty('--line-strong', theme.line);
  root.style.setProperty('--teal', theme.accent);
  root.style.setProperty('--teal-dark', theme.accentDark);
  root.style.setProperty('--teal-soft', theme.accentSoft);
  root.style.setProperty('--table-header', theme.tableHeader);
  root.style.setProperty('--total-bg', theme.totalBackground);
  els.brandName.textContent = state.settings.brandName;
  els.brandMark.innerHTML = logoInnerHtml('app');
}

function logoInnerHtml() {
  const settings = state.settings;
  if (settings.logoMode === 'image' && settings.logoImage) {
    return `<img src="${escapeAttr(settings.logoImage)}" alt="">`;
  }
  if (settings.logoMode === 'initials') {
    return `<span class="logo-initials">${escapeHtml(settings.logoInitials || 'ID')}</span>`;
  }
  return `<span class="logo-glyph logo-${escapeAttr(settings.logoMode)}"><i></i><i></i><i></i></span>`;
}

function mergeSettings(input = {}) {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...input,
    theme: {
      ...DEFAULT_SETTINGS.theme,
      ...(input.theme || {})
    }
  };
}

function setPath(target, path, value) {
  const keys = path.split('.');
  let cursor = target;
  keys.slice(0, -1).forEach((key) => {
    cursor = cursor[key];
  });
  const finalKey = keys.at(-1);
  if (['quantity', 'unitPrice', 'discountRate', 'vatRate', 'withholdingRate'].includes(finalKey)) {
    cursor[finalKey] = number(value);
  } else {
    cursor[finalKey] = value;
  }
}

function calculateTotals(doc) {
  const subtotal = doc.items.reduce((sum, item) => sum + number(item.quantity) * number(item.unitPrice), 0);
  const discount = subtotal * number(doc.discountRate) / 100;
  const taxable = Math.max(0, subtotal - discount);
  const vat = taxable * number(doc.vatRate) / 100;
  const withholding = taxable * number(doc.withholdingRate) / 100;
  return {
    subtotal,
    discount,
    taxable,
    vat,
    withholding,
    grandTotal: taxable + vat - withholding
  };
}

function typeLabel(type) {
  return DOC_TYPES[type] || DOC_TYPES.invoice;
}

function syncStatusTabs() {
  document.querySelectorAll('.status-tabs button').forEach((button) => {
    button.classList.toggle('active', button.dataset.status === state.activeStatus);
  });
}

function markDirty() {
  setSaveState('ยังไม่ได้บันทึก');
}

function setSaveState(text) {
  els.saveState.textContent = text;
}

function formatMoney(value) {
  const currency = state.current?.currency || 'THB';
  if (!moneyFormatters.has(currency)) {
    moneyFormatters.set(currency, new Intl.NumberFormat('th-TH', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2
    }));
  }
  return moneyFormatters.get(currency).format(number(value));
}

function formatNumber(value) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(number(value));
}

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date(`${value}T00:00:00`));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}
