const STORAGE_KEY = 'drooni-ladu-v1';
const LOW_STOCK = 1; // tõsta esile read, kus laoseis on sellest väiksem või võrdne (kui detailil on hoiatus sees)
// Nende kategooriate asjad näidatakse laos eraldi nimekirjas ja neid ei paigaldata droonile
const SECTIONS = [
  { key: 'tool', category: 'Tööriistad', match: /^tööriist/i },
  { key: 'charger', category: 'Laadijad', match: /^laadija/i },
  { key: 'pgear', category: '3D printer', match: /^3d[ -]?printer/i }, // näidatakse 3D printeri lehel
];
const PRINTER_CATEGORY = '3D printer';
const PTYPES = { filament: 'Filament', ams: 'AMS', 'ams-ht': 'AMS HT', spool: 'Korduvkasutatav spool',
  nozzle: 'Düüs / hotend', plate: 'Printimisplaat', other: 'Muu printeri asi' };

let state = load();

function normalize(data) {
  return { parts: [], drones: [], orders: [], recipes: {}, printers: [], filaments: [], coins: {}, log: [], ...data };
}

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data && Array.isArray(data.parts)) return normalize(data);
  } catch (e) { /* tühi või vigane */ }
  return normalize({});
}

let readOnly = false; // teise inimese lao vaatamine
let mailbox = { list: [], hide: null }; // tellimuskirjad Gmailist, mis on veel lisamata
let mailGroup = null; // tellimuse vorm on täidetud nende kirjade põhjal

function save() {
  if (readOnly) {
    render();
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
  if (window.cloudSave) window.cloudSave(state);
}

/* Pilve sünkroonimine (sync.js) loeb ja asendab andmeid nende kaudu */
window.appState = {
  get: () => state,
  replace(data, persist = true) {
    state = normalize(data);
    if (persist) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    render();
  },
  restoreLocal() {
    state = load();
    render();
  },
  setReadOnly(on) {
    readOnly = on;
    document.body.classList.toggle('readonly', on);
  },
  // Tellimuskirjad Gmailist (sync.js): list ja funktsioon, mis kirja nimekirjast eemaldab
  setMailbox(list, hide) {
    mailbox = { list, hide };
    applyMailUpdates();
    renderMailbox();
  },
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const partById = (id) => state.parts.find((p) => p.id === id);
const droneById = (id) => state.drones.find((d) => d.id === id);
const sectionOf = (p) => SECTIONS.find((s) => s.match.test((p.category || '').trim()));
const isSeparate = (p) => !!sectionOf(p);

/* Ühikud: tükid või meetrid. Meetrite puhul võib kogus olla murdarv. */
const unitOf = (p) => p.unit || 'tk';
const roundQty = (n) => Math.round(n * 1000) / 1000;
const qtyFmt = new Intl.NumberFormat('et-EE', { maximumFractionDigits: 3 });
const fmtQty = (n, unit = 'tk') => `${qtyFmt.format(n)} ${unit}`;

function readQty(prefix) {
  const n = Math.max(0, parseFloat($(prefix + '-qty').value) || 0);
  return $(prefix + '-unit').value === 'tk' ? Math.round(n) : roundQty(n);
}

function addLog(type, partId, qty, droneId, partName) {
  const part = partById(partId);
  const drone = droneById(droneId);
  if (state.log.length >= 1000) state.log.length = 999; // pilve dokumendi suurus on piiratud
  state.log.unshift({
    id: uid(),
    date: new Date().toISOString(),
    type,
    partName: part ? part.name : partName || '',
    droneName: drone ? drone.name : '',
    qty,
    unit: part ? unitOf(part) : undefined,
  });
}

function installedCount(partId) {
  return state.drones.reduce((sum, d) => sum + (d.parts[partId] || 0), 0);
}

/* ---------- Vahelehed ---------- */
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === btn.dataset.tab));
  });
});

/* ---------- Ladu ---------- */
$('part-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = $('part-id').value;
  const fields = {
    name: $('part-name').value.trim(),
    category: comboValue('part-category'),
    supplier: comboValue('part-supplier'),
    qty: readQty('part'),
    unit: $('part-unit').value,
    price: unitPrice(),
    note: $('part-note').value.trim(),
    link: $('part-link').value.trim(),
    warn: $('part-warn').checked,
  };
  if (!fields.name) return;
  if (Number.isNaN(fields.price)) {
    alert('Koguse hinna jaoks peab kogus olema suurem kui 0.');
    return;
  }

  if (id) {
    const part = partById(id);
    const diff = roundQty(fields.qty - part.qty);
    Object.assign(part, fields);
    addLog('Muudetud', id, diff, null);
  } else {
    const existing = state.parts.find((p) => p.name.toLowerCase() === fields.name.toLowerCase());
    if (existing && confirm(`"${existing.name}" on juba laos. Kas lisada kogus olemasolevale?`)) {
      existing.qty = roundQty(existing.qty + fields.qty);
      addLog('Lisatud lattu', existing.id, fields.qty, null);
    } else {
      const part = { id: uid(), ...fields };
      state.parts.push(part);
      addLog('Lisatud lattu', part.id, fields.qty, null);
    }
  }
  resetPartForm();
  save();
});

$('part-cancel').addEventListener('click', resetPartForm);

/* Hind salvestatakse alati ühiku (tk või m) hinnana; "kokku" puhul jagatakse kogusega */
function unitPrice(prefix = 'part') {
  const raw = $(prefix + '-price').value;
  if (raw === '') return null;
  const price = Math.max(0, parseFloat(raw) || 0);
  if ($(prefix + '-price-mode').value === 'unit') return price;
  const qty = readQty(prefix);
  return qty > 0 ? price / qty : NaN;
}

function updatePriceHint(prefix = 'part') {
  const unit = $(prefix + '-unit').value;
  $(prefix + '-price-mode').options[0].textContent = unit;
  const isTotal = $(prefix + '-price-mode').value === 'total';
  const price = isTotal ? unitPrice(prefix) : null;
  $(prefix + '-price-hint').textContent = price == null ? ''
    : Number.isNaN(price) ? 'Kogus peab olema suurem kui 0'
    : `= ${money(price)} / ${unit}`;
}

for (const prefix of ['part', 'order']) {
  ['-price', '-price-mode', '-qty', '-unit'].forEach((f) => $(prefix + f).addEventListener('input', () => updatePriceHint(prefix)));
}

function resetPartForm() {
  $('part-form').reset();
  $('part-id').value = '';
  $('part-qty').value = 1;
  $('part-form-title').textContent = 'Lisa detail';
  $('part-submit').textContent = 'Lisa lattu';
  $('part-cancel').hidden = true;
  setCombo('part-category', '');
  setCombo('part-supplier', '');
  updatePriceHint();
}

/* Ripmenüü varem sisestatud väärtustega + "Lisa uus…" valik */
const NEW_VALUE = '__new__';

function fillCombo(inputId, values) {
  const sel = $(inputId + '-select');
  const current = comboValue(inputId);
  sel.innerHTML = '<option value="">— vali —</option>'
    + values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')
    + `<option value="${NEW_VALUE}">+ Lisa uus…</option>`;
  setCombo(inputId, current);
}

function setCombo(inputId, value) {
  const sel = $(inputId + '-select');
  const input = $(inputId);
  const known = value && [...sel.options].some((o) => o.value === value);
  sel.value = !value ? '' : known ? value : NEW_VALUE;
  input.value = known ? '' : value;
  input.hidden = sel.value !== NEW_VALUE;
}

function comboValue(inputId) {
  const sel = $(inputId + '-select');
  return sel.value === NEW_VALUE ? $(inputId).value.trim() : sel.value;
}

document.querySelectorAll('select.combo').forEach((sel) => {
  sel.addEventListener('change', () => {
    const input = $(sel.dataset.input);
    input.hidden = sel.value !== NEW_VALUE;
    if (!input.hidden) input.focus();
  });
});

function editPart(id) {
  const p = partById(id);
  document.querySelector('.tab[data-tab="ladu"]').click(); // printeri tarvikuid muudetakse lao vormis
  $('part-id').value = p.id;
  $('part-name').value = p.name;
  setCombo('part-category', p.category || '');
  setCombo('part-supplier', p.supplier || '');
  $('part-qty').value = p.qty;
  $('part-unit').value = unitOf(p);
  $('part-note').value = p.note;
  $('part-price').value = p.price == null ? '' : Math.round(p.price * 100) / 100;
  $('part-price-mode').value = 'unit';
  updatePriceHint();
  $('part-link').value = p.link || '';
  $('part-warn').checked = p.warn !== false;
  $('part-form-title').textContent = 'Muuda detaili';
  $('part-submit').textContent = 'Salvesta';
  $('part-cancel').hidden = false;
  $('part-form').scrollIntoView({ behavior: 'smooth' });
  $('part-name').focus();
}

function adjustPart(id, delta) {
  const p = partById(id);
  if (p.qty + delta < 0) return;
  p.qty = roundQty(p.qty + delta);
  addLog(delta > 0 ? 'Lisatud lattu' : 'Eemaldatud laost', id, Math.abs(delta), null);
  save();
}

function deletePart(id) {
  const p = partById(id);
  if (installedCount(id) > 0) {
    alert(`"${p.name}" on mõnes droonis kasutusel. Eemalda see enne droonidest.`);
    return;
  }
  if (!confirm(`Kustutada "${p.name}" laost?`)) return;
  addLog('Kustutatud', id, p.qty, null);
  state.parts = state.parts.filter((x) => x.id !== id);
  save();
}

for (const list of ['part-list', ...SECTIONS.map((s) => s.key + '-list')]) {
  $(list).addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('tr').dataset.id;
    ({ plus: () => adjustPart(id, 1), minus: () => adjustPart(id, -1), edit: () => editPart(id), del: () => deletePart(id) })[btn.dataset.act]();
  });
}

$('part-search').addEventListener('input', renderParts);
$('part-filter').addEventListener('change', renderParts);
$('show-hidden').addEventListener('change', renderParts);

/* ---------- Droonid ---------- */
$('drone-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('drone-name').value.trim();
  if (!name) return;
  state.drones.push({ id: uid(), name, note: $('drone-note').value.trim(), created: new Date().toISOString(), parts: {} });
  $('drone-form').reset();
  save();
});

function installPart(droneId, partId, qty) {
  const part = partById(partId);
  const drone = droneById(droneId);
  if (!part || !drone || !(qty > 0)) return;
  if (unitOf(part) === 'tk') qty = Math.round(qty) || 1;
  if (qty > part.qty) {
    alert(`Laos on ainult ${fmtQty(part.qty, unitOf(part))} "${part.name}".`);
    return;
  }
  part.qty = roundQty(part.qty - qty);
  drone.parts[partId] = roundQty((drone.parts[partId] || 0) + qty);
  addLog('Paigaldatud droonile', partId, qty, droneId);
  save();
}

function removePart(droneId, partId, toStock) {
  const drone = droneById(droneId);
  const part = partById(partId);
  const qty = drone.parts[partId];
  const input = prompt(`Mitu ${unitOf(part)} "${part.name}" eemaldada droonilt "${drone.name}"?`, qty);
  const n = roundQty(parseFloat(String(input).replace(',', '.')));
  if (!(n > 0)) return;
  const take = Math.min(n, qty);
  drone.parts[partId] = roundQty(drone.parts[partId] - take);
  if (drone.parts[partId] <= 0) delete drone.parts[partId];
  if (toStock) {
    part.qty = roundQty(part.qty + take);
    addLog('Tagastatud lattu', partId, take, droneId);
  } else {
    addLog('Maha kantud (katki)', partId, take, droneId);
  }
  save();
}

function deleteDrone(id) {
  const drone = droneById(id);
  const hasParts = Object.keys(drone.parts).length > 0;
  const msg = hasParts
    ? `Kustutada droon "${drone.name}"? Selle detailid tagastatakse lattu.`
    : `Kustutada droon "${drone.name}"?`;
  if (!confirm(msg)) return;
  for (const [partId, qty] of Object.entries(drone.parts)) {
    const part = partById(partId);
    if (part) {
      part.qty = roundQty(part.qty + qty);
      addLog('Tagastatud lattu', partId, qty, id);
    }
  }
  state.drones = state.drones.filter((d) => d.id !== id);
  save();
}

$('drone-list').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  installPart(form.dataset.drone, form.part.value, parseFloat(form.qty.value) || 0);
});

$('drone-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const droneId = btn.closest('[data-drone]').dataset.drone;
  const partId = btn.dataset.part;
  if (btn.dataset.act === 'return') removePart(droneId, partId, true);
  if (btn.dataset.act === 'scrap') removePart(droneId, partId, false);
  if (btn.dataset.act === 'del-drone') deleteDrone(droneId);
});

/* ---------- Tellimused ---------- */
/* Tellimuskirjad: uus tellimus → saadetud → kohale jõudnud. Sama tellimuse nr kirjad on üks rida. */
const MAIL_STATUS = { new: 'Uus tellimus', shipped: '🚚 Saadetud', delivered: '📦 Kohale jõudnud' };
const MAIL_RANK = { new: 0, shipped: 1, delivered: 2 };
const ordersByNo = (no) => (no ? state.orders.filter((o) => o.orderNo === no || (o.note || '').includes(no)) : []);

function parseItems(json) {
  try {
    const list = JSON.parse(json || '[]');
    return Array.isArray(list) ? list.filter((x) => x && x.name) : [];
  } catch { return []; }
}

function mailGroups() {
  const groups = new Map();
  for (const m of mailbox.list) {
    if (!MAIL_STATUS[m.status]) continue;
    const key = m.orderNo ? `${m.shop}|${m.orderNo}` : `${m.shop}|${m.subject}|${m.total}`; // edasi saadetud koopia on sama rida
    const g = groups.get(key) || { key, ids: [], mails: [] };
    g.ids.push(m.id);
    g.mails.push(m);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const mails = g.mails.sort((a, b) => (b.date || '').localeCompare(a.date || '')); // uusim ees
    const latest = mails.reduce((a, b) => (MAIL_RANK[b.status] > MAIL_RANK[a.status] ? b : a));
    const first = mails.findLast((m) => m.status === 'new') || mails[mails.length - 1]; // esimene tellimuse kiri
    return {
      ...g,
      orderNo: first.orderNo || '',
      shop: first.shop,
      subject: first.subject,
      date: mails[0].date,
      status: latest.status,
      statusDate: latest.date,
      total: (mails.find((m) => m.status === 'new' && m.total != null) || mails.find((m) => m.total != null) || {}).total ?? null,
      link: (mails.find((m) => m.link) || {}).link || '',
      text: first.text || '',
      items: parseItems(first.items),
    };
  });
}

/* Kui tellimus on juba nimekirjas, uuendatakse selle olekut ja kirjad eemaldatakse.
   Vana kujuga kirjad (ilma liigita) kustutatakse. */
function applyMailUpdates() {
  if (readOnly || !mailbox.hide) return;
  for (const m of mailbox.list) if (!MAIL_STATUS[m.status]) mailbox.hide(m.id);
  let changed = false;
  for (const g of mailGroups()) {
    const orders = ordersByNo(g.orderNo);
    if (!orders.length) continue;
    for (const o of orders) {
      if (g.status !== 'new' && (!o.track || MAIL_RANK[g.status] >= MAIL_RANK[o.track.status])) {
        o.track = { status: g.status, date: g.statusDate };
        changed = true;
      }
    }
    g.ids.forEach((id) => mailbox.hide(id));
  }
  if (changed) save();
}

$('inbox-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const m = mailGroups().find((g) => g.key === btn.closest('tr').dataset.key);
  if (!m) return;
  if (btn.dataset.act === 'hide') {
    if (confirm('Peida see tellimus? Seda ei lisata.')) m.ids.forEach((id) => mailbox.hide(id));
    return;
  }
  if (btn.dataset.act === 'body') {
    openMails.has(m.key) ? openMails.delete(m.key) : openMails.add(m.key);
    renderMailbox();
    return;
  }
  startMailOrder({ ...m, used: new Set(), added: false }, 0);
});

const openMails = new Set(); // meilide nimekirjas lahti tehtud kirjad

/* Vorm täidetakse kirja põhjal; mitme tootega kirjast lisatakse tooted ükshaaval */
function startMailOrder(g, index) {
  resetOrderForm();
  mailGroup = g;
  g.current = g.items.length ? index : -1;
  const item = g.items[index];
  $('order-name').value = item ? item.name : g.subject || '';
  if (item && item.qty > 1) $('order-qty').value = item.qty;
  setCombo('order-supplier', g.shop || '');
  if (item && item.price != null) {
    $('order-price').value = item.price;
  } else if (!g.added && g.total != null && g.items.length <= 1) {
    $('order-price').value = g.total;
    $('order-price-mode').value = 'total';
  }
  $('order-note').value = g.orderNo ? 'Tellimus ' + g.orderNo : '';
  $('order-link').value = g.link || '';
  $('order-status').value = 'ordered';
  updatePriceHint('order');
  $('order-form-title').textContent = 'Lisa tellimus meilist';
  $('order-cancel').hidden = false;
  renderMailForm();
  $('order-form').scrollIntoView({ behavior: 'smooth' });
  $('order-name').focus();
  $('order-name').select();
}

function renderMailForm() {
  const g = mailGroup;
  $('order-mail').hidden = !g;
  if (!g) return;
  $('order-mail-items').innerHTML = g.items.map((it, i) => `
    <button type="button" class="small${g.used.has(i) ? ' used' : ''}${g.current === i ? ' current' : ''}" data-i="${i}">
      ${g.used.has(i) ? '✓ ' : ''}${esc(it.name)}${it.qty > 1 ? ` · ${it.qty} tk` : ''}${it.price != null ? ' · ' + money(it.price) : ''}
    </button>`).join('');
  $('order-mail-hint').textContent = !g.items.length
    ? 'Kirjast ei leitud tootenimesid. Vaata kirja sisu ja kirjuta nimi ise.'
    : g.items.length > 1 ? `Kirjas on ${g.items.length} toodet. Vali toode, kontrolli nime ja vajuta „Lisa tellimus“. Pärast seda tuleb järgmine toode.`
    : '';
  $('order-mail-text').textContent = g.text;
}

$('order-mail-items').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-i]');
  if (!btn || !mailGroup) return;
  const i = Number(btn.dataset.i);
  const item = mailGroup.items[i];
  mailGroup.current = i;
  $('order-name').value = item.name;
  $('order-qty').value = item.qty || 1;
  $('order-price').value = item.price ?? '';
  $('order-price-mode').value = 'unit';
  updatePriceHint('order');
  renderMailForm();
  $('order-name').focus();
});

$('order-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const editing = state.orders.find((o) => o.id === $('order-id').value);
  const order = {
    id: editing ? editing.id : uid(),
    // kuupäev muutub, kui plaanitud asi märgitakse tellituks
    date: editing && statusOf(editing) === $('order-status').value ? editing.date : new Date().toISOString(),
    name: $('order-name').value.trim(),
    category: comboValue('order-category'),
    supplier: comboValue('order-supplier'),
    qty: readQty('order'),
    unit: $('order-unit').value,
    price: unitPrice('order'),
    note: $('order-note').value.trim(),
    link: $('order-link').value.trim(),
    status: $('order-status').value,
    kind: undefined, ptype: undefined, fil: undefined, // tavalisel tellimusel neid pole
  };
  if ($('order-kind').value === 'printer') {
    order.kind = 'printer';
    order.ptype = $('order-ptype').value;
    order.category = PRINTER_CATEGORY;
    if (order.ptype === 'filament') {
      order.fil = {
        material: $('order-fil-material').value.trim(),
        color: $('order-fil-color').value.trim(),
        hex: $('order-fil-hex').value,
        brand: $('order-fil-brand').value.trim(),
        weight: Math.max(0, Math.round(parseFloat($('order-fil-weight').value) || 0)),
      };
      order.name = filLabel(order.fil);
      order.unit = 'tk';
      order.qty = Math.round(order.qty);
    } else {
      order.name ||= PTYPES[order.ptype];
    }
  }
  if (!order.name) return;
  if (!(order.qty > 0)) {
    alert('Kogus peab olema suurem kui 0.');
    return;
  }
  if (Number.isNaN(order.price)) {
    alert('Koguse hinna jaoks peab kogus olema suurem kui 0.');
    return;
  }
  if (editing) {
    Object.assign(editing, order);
  } else {
    state.orders.push(order);
    addLog(order.status === 'planned' ? 'Plaanis osta' : 'Tellitud', null, order.qty, null, order.name);
    state.log[0].unit = order.unit;
  }
  const g = !editing && mailGroup;
  if (g) {
    // kirjad on lisatud: tellimus saab numbri (hilisemad saatmise kirjad uuendavad seda) ja kirjad eemaldatakse
    order.orderNo = g.orderNo || undefined;
    if (g.status !== 'new') order.track = { status: g.status, date: g.statusDate };
    if (!g.added && mailbox.hide) g.ids.forEach((id) => mailbox.hide(id));
    g.added = true;
    if (g.current >= 0) g.used.add(g.current);
  }
  resetOrderForm();
  save();
  const next = g ? g.items.findIndex((_, i) => !g.used.has(i)) : -1;
  if (next >= 0) startMailOrder(g, next); // sama kirja järgmine toode
});

$('order-cancel').addEventListener('click', resetOrderForm);

function resetOrderForm() {
  mailGroup = null;
  renderMailForm();
  $('order-form').reset();
  updateOrderKind();
  $('order-id').value = '';
  $('order-qty').value = 1;
  $('order-form-title').textContent = 'Lisa tellimus';
  $('order-submit').textContent = 'Lisa tellimus';
  $('order-cancel').hidden = true;
  setCombo('order-category', '');
  setCombo('order-supplier', '');
  updatePriceHint('order');
}

/* Olemasoleva detaili nime valimisel täida kategooria, tarnija ja link */
$('order-name').addEventListener('change', () => {
  const name = $('order-name').value.trim().toLowerCase();
  const p = state.parts.find((x) => x.name.toLowerCase() === name);
  if (!p) return;
  setCombo('order-category', p.category || '');
  setCombo('order-supplier', p.supplier || '');
  $('order-unit').value = unitOf(p);
  updatePriceHint('order');
  if (!$('order-link').value) $('order-link').value = p.link || '';
});

const statusOf = (o) => o.status || 'ordered';

/* 3D printeri asja valimisel avaneb lisaosa; filamendil on nimi materjal + värv */
function updateOrderKind() {
  const printer = $('order-kind').value === 'printer';
  const ptype = $('order-ptype').value;
  const fil = printer && ptype === 'filament';
  $('order-printer').hidden = !printer;
  $('order-fil').hidden = !fil;
  $('order-name-wrap').hidden = fil;
  $('order-category-wrap').hidden = printer;
  $('order-name').required = !printer;
  $('order-fil-material').required = fil;
  if (fil) $('order-unit').value = 'tk';
  $('order-unit').disabled = fil;
  $('order-printer-hint').textContent = !printer ? ''
    : fil ? 'Kogus = rullide arv. Kui vajutad „Kohal“, lähevad rullid 3D printeri lehel filamendi lattu.'
    : 'Kui vajutad „Kohal“, läheb see 3D printeri lehel „Printeri tarvikud laos“ alla.'
      + ($('order-name').value ? '' : ` Kui nime ei kirjuta, saab nimeks „${PTYPES[ptype]}“.`);
}
$('order-kind').addEventListener('change', updateOrderKind);
$('order-ptype').addEventListener('change', updateOrderKind);
$('order-name').addEventListener('input', () => { if ($('order-kind').value === 'printer') updateOrderKind(); });

function markOrdered(id) {
  const order = state.orders.find((o) => o.id === id);
  order.status = 'ordered';
  order.date = new Date().toISOString();
  addLog('Tellitud', null, order.qty, null, order.name);
  state.log[0].unit = unitOf(order);
  save();
}

/* Saabunud filament läheb filamendi lattu: sama rull juurde, uus eraldi reale */
function receiveFilament(order) {
  const f = order.fil;
  const same = state.filaments.find((x) => x.material === f.material && x.color === f.color
    && x.brand === f.brand && x.hex === f.hex && x.weight === f.weight);
  if (same) {
    same.count += order.qty;
    if (order.price != null) same.price = order.price;
    same.link ||= order.link;
  } else {
    state.filaments.push({ id: uid(), ...f, count: order.qty, price: order.price, note: '', link: order.link });
  }
  state.orders = state.orders.filter((o) => o.id !== order.id);
  filLog('Saabus lattu', f, order.qty);
  save();
}

function receiveOrder(id) {
  const order = state.orders.find((o) => o.id === id);
  if (order.ptype === 'filament' && order.fil) return receiveFilament(order);
  const existing = state.parts.find((p) => p.name.toLowerCase() === order.name.toLowerCase());
  let partId;
  if (existing) {
    existing.qty = roundQty(existing.qty + order.qty);
    existing.unit ||= order.unit;
    if (order.price != null) existing.price = order.price;
    existing.category ||= order.category;
    existing.supplier ||= order.supplier;
    existing.link ||= order.link;
    partId = existing.id;
  } else {
    const { id: _, date, ...fields } = order;
    const part = { id: uid(), ...fields };
    state.parts.push(part);
    partId = part.id;
  }
  state.orders = state.orders.filter((o) => o.id !== id);
  addLog('Saabus lattu', partId, order.qty, null);
  save();
}

function editOrder(id) {
  const o = state.orders.find((x) => x.id === id);
  $('order-id').value = o.id;
  $('order-name').value = o.name;
  setCombo('order-category', o.category || '');
  setCombo('order-supplier', o.supplier || '');
  $('order-qty').value = o.qty;
  $('order-unit').value = unitOf(o);
  $('order-price').value = o.price == null ? '' : Math.round(o.price * 100) / 100;
  $('order-price-mode').value = 'unit';
  $('order-note').value = o.note || '';
  $('order-link').value = o.link || '';
  $('order-status').value = statusOf(o);
  $('order-kind').value = o.kind === 'printer' ? 'printer' : '';
  $('order-ptype').value = o.ptype || 'filament';
  if (o.fil) {
    $('order-fil-material').value = o.fil.material;
    $('order-fil-color').value = o.fil.color || '';
    $('order-fil-hex').value = safeHex(o.fil.hex);
    $('order-fil-brand').value = o.fil.brand || '';
    $('order-fil-weight').value = o.fil.weight;
  }
  updateOrderKind();
  updatePriceHint('order');
  $('order-form-title').textContent = 'Muuda tellimust';
  $('order-submit').textContent = 'Salvesta';
  $('order-cancel').hidden = false;
  $('order-form').scrollIntoView({ behavior: 'smooth' });
  $('order-name').focus();
}

function deleteOrder(id) {
  const order = state.orders.find((o) => o.id === id);
  if (!confirm(`Kustutada tellimus "${order.name}"?`)) return;
  state.orders = state.orders.filter((o) => o.id !== id);
  addLog('Tellimus tühistatud', null, order.qty, null, order.name);
  state.log[0].unit = unitOf(order);
  save();
}

for (const list of ['order-list', 'planned-list']) {
  $(list).addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('tr').dataset.id;
    if (btn.dataset.act !== 'edit' && $('order-id').value === id) resetOrderForm(); // muudetav tellimus muutub nimekirjas
    if (btn.dataset.act === 'ordered') markOrdered(id);
    if (btn.dataset.act === 'arrived') receiveOrder(id);
    if (btn.dataset.act === 'edit') editOrder(id);
    if (btn.dataset.act === 'del') deleteOrder(id);
  });
}

/* ---------- Valmista toode osadest ---------- */
const emptyBuildRow = () => ({ partId: '', qty: 1 });
let buildRows = [emptyBuildRow()];

const findPart = (name) => state.parts.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());

/* Ühe toote jaoks vajalikud osad, sama osa mitu rida liidetakse kokku */
function buildNeeds() {
  const need = new Map();
  for (const r of buildRows) {
    if (r.partId && r.qty > 0 && partById(r.partId)) need.set(r.partId, roundQty((need.get(r.partId) || 0) + r.qty));
  }
  return need;
}

const buildCount = () => Math.max(1, Math.round(parseFloat($('build-count').value) || 1));

$('build-add').addEventListener('click', () => {
  buildRows.push(emptyBuildRow());
  renderBuild();
});

$('build-parts').addEventListener('change', (e) => {
  const row = e.target.closest('[data-i]');
  if (!row || e.target.name !== 'part') return;
  buildRows[row.dataset.i].partId = e.target.value;
  renderBuild();
});

$('build-parts').addEventListener('input', (e) => {
  const row = e.target.closest('[data-i]');
  if (!row || e.target.name !== 'qty') return;
  buildRows[row.dataset.i].qty = Math.max(0, parseFloat(e.target.value) || 0);
  renderBuildSummary();
});

$('build-parts').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act="remove"]');
  if (!btn) return;
  buildRows.splice(btn.closest('[data-i]').dataset.i, 1);
  if (!buildRows.length) buildRows.push(emptyBuildRow());
  renderBuild();
});

$('build-count').addEventListener('input', renderBuildSummary);

/* Kui toode on varem valmistatud, täida osad meelde jäetud retseptist */
$('build-name').addEventListener('change', () => {
  const name = $('build-name').value.trim();
  const product = findPart(name);
  if (product) setCombo('build-category', product.category || '');
  const recipe = state.recipes[name.toLowerCase()];
  if (recipe) {
    buildRows = recipe.filter((r) => partById(r.partId)).map((r) => ({ ...r }));
    if (!buildRows.length) buildRows.push(emptyBuildRow());
    renderBuild();
  }
});

$('build-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('build-name').value.trim();
  const count = buildCount();
  const need = buildNeeds();
  if (!name) return;
  if (!need.size) {
    alert('Lisa vähemalt üks osa.');
    return;
  }
  const product = findPart(name);
  if (product && need.has(product.id)) {
    alert('Toode ei saa olla iseenda osa.');
    return;
  }
  const short = [...need]
    .map(([id, q]) => [partById(id), roundQty(q * count)])
    .filter(([p, total]) => total > p.qty);
  if (short.length) {
    alert('Laos pole piisavalt osi:\n' + short.map(([p, total]) => `${p.name}: vaja ${fmtQty(total, unitOf(p))}, laos ${fmtQty(p.qty, unitOf(p))}`).join('\n'));
    return;
  }

  let cost = 0;
  for (const [id, q] of need) {
    const p = partById(id);
    const used = roundQty(q * count);
    p.qty = roundQty(p.qty - used);
    cost += (p.price || 0) * q;
    addLog(`Kasutatud: ${name}`, id, used, null);
  }

  let target = product;
  if (target) {
    target.qty = roundQty(target.qty + count);
    target.category ||= comboValue('build-category');
  } else {
    target = {
      id: uid(), name, category: comboValue('build-category'), supplier: '',
      qty: count, unit: 'tk', price: null, note: '', link: '', warn: true,
    };
    state.parts.push(target);
  }
  if (cost > 0) target.price = cost; // omahind = osade hind ühe toote kohta
  addLog('Valmistatud', target.id, count, null);
  state.recipes[name.toLowerCase()] = [...need].map(([partId, qty]) => ({ partId, qty }));

  $('build-form').reset();
  setCombo('build-category', '');
  buildRows = [emptyBuildRow()];
  save();
});

/* ---------- 3D printer ja filament ---------- */
const SLOT_LETTERS = 'ABCD';
const LOW_FILAMENT = 100; // g – AMS-i pesas olev rull muutub punaseks, kui alles on vähem
const safeHex = (h) => (/^#[0-9a-f]{6}$/i.test(h || '') ? h : '#cccccc');
const filLabel = (f) => [f.material, f.color].filter(Boolean).join(' ') + (f.brand ? ` (${f.brand})` : '');
const printerById = (id) => state.printers.find((p) => p.id === id);
const filById = (id) => state.filaments.find((f) => f.id === id);

function filLog(type, f, qty, where) {
  addLog(type, null, qty, null, filLabel(f));
  state.log[0].unit = 'rull';
  if (where) state.log[0].droneName = where;
}

/* Printeri pesade nimed: A1–A4 iga AMS-i kohta (A, B, C, D) ja väline rull */
function slotKeys(pr) {
  const keys = [];
  for (let u = 0; u < pr.ams; u++) for (let k = 1; k <= 4; k++) keys.push(SLOT_LETTERS[u] + k);
  return [...keys, 'ext'];
}
const slotName = (key) => (key === 'ext' ? 'Väline rull' : key);

// Printer
$('printer-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const fields = {
    name: $('printer-name').value.trim(),
    model: $('printer-model').value.trim(),
    nozzle: $('printer-nozzle').value,
    ams: parseInt($('printer-ams').value, 10) || 0,
    note: $('printer-note').value.trim(),
  };
  if (!fields.name) return;
  const pr = printerById($('printer-id').value);
  if (pr) {
    Object.assign(pr, fields);
    // pesad, mida enam pole (vähem AMS-e), tagastatakse lattu
    const keep = slotKeys(pr);
    for (const key of Object.keys(pr.slots)) {
      if (!keep.includes(key)) unloadSpool(pr, key);
    }
  } else {
    state.printers.push({ id: uid(), ...fields, slots: {} });
  }
  resetPrinterForm();
  $('printer-form-card').open = false;
  save();
});

$('printer-cancel').addEventListener('click', () => {
  resetPrinterForm();
  $('printer-form-card').open = false;
});

function resetPrinterForm() {
  $('printer-form').reset();
  $('printer-id').value = '';
  $('printer-form-title').textContent = 'Lisa printer';
  $('printer-submit').textContent = 'Lisa printer';
  $('printer-cancel').hidden = true;
}

function editPrinter(id) {
  const pr = printerById(id);
  $('printer-id').value = pr.id;
  $('printer-name').value = pr.name;
  $('printer-model').value = pr.model || '';
  $('printer-nozzle').value = pr.nozzle || '0.4';
  $('printer-ams').value = String(pr.ams);
  $('printer-note').value = pr.note || '';
  $('printer-form-title').textContent = 'Muuda printerit';
  $('printer-submit').textContent = 'Salvesta';
  $('printer-cancel').hidden = false;
  $('printer-form-card').open = true;
  $('printer-form-card').scrollIntoView({ behavior: 'smooth' });
}

function deletePrinter(id) {
  const pr = printerById(id);
  const loaded = Object.keys(pr.slots).length;
  if (!confirm(`Kustutada printer "${pr.name}"?${loaded ? ' Rullid pesadest tagastatakse lattu.' : ''}`)) return;
  for (const key of Object.keys(pr.slots)) unloadSpool(pr, key);
  state.printers = state.printers.filter((p) => p.id !== id);
  save();
}

// Rull laost pessa ja tagasi
function loadSpool(pr, key, filId) {
  const f = filById(filId);
  if (!f || f.count < 1 || pr.slots[key]) return;
  f.count -= 1;
  pr.slots[key] = {
    material: f.material, color: f.color, hex: f.hex, brand: f.brand,
    weight: f.weight, full: f.weight, price: f.price, link: f.link,
  };
  filLog('Pandud printerisse', f, 1, `${pr.name} · ${slotName(key)}`);
}

/* Täis rull läheb tagasi sama rea juurde, poolik rull eraldi reale "avatud rull" */
function unloadSpool(pr, key) {
  const s = pr.slots[key];
  if (!s) return;
  const same = state.filaments.find((f) => f.material === s.material && f.color === s.color
    && f.brand === s.brand && f.hex === s.hex && f.weight === s.weight);
  if (same) {
    same.count += 1;
  } else {
    state.filaments.push({
      id: uid(), material: s.material, color: s.color, hex: s.hex, brand: s.brand,
      count: 1, weight: s.weight, price: s.price, link: s.link || '',
      note: s.weight < s.full ? 'avatud rull' : '',
    });
  }
  delete pr.slots[key];
  filLog('Võetud printerist lattu', s, 1, `${pr.name} · ${slotName(key)}`);
}

function emptySpool(pr, key) {
  const s = pr.slots[key];
  if (!confirm(`Kas rull "${filLabel(s)}" on otsas? See eemaldatakse pesast.`)) return;
  delete pr.slots[key];
  filLog('Filament otsas', s, 1, `${pr.name} · ${slotName(key)}`);
  save();
}

$('printer-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const pr = printerById(btn.closest('[data-printer]').dataset.printer);
  const key = btn.closest('[data-slot]')?.dataset.slot;
  if (btn.dataset.act === 'edit-printer') editPrinter(pr.id);
  if (btn.dataset.act === 'del-printer') deletePrinter(pr.id);
  if (btn.dataset.act === 'unload') {
    unloadSpool(pr, key);
    save();
  }
  if (btn.dataset.act === 'empty') emptySpool(pr, key);
});

$('printer-list').addEventListener('change', (e) => {
  const pr = printerById(e.target.closest('[data-printer]')?.dataset.printer);
  const key = e.target.closest('[data-slot]')?.dataset.slot;
  if (!pr || !key) return;
  if (e.target.classList.contains('slot-load') && e.target.value) {
    loadSpool(pr, key, e.target.value);
    save();
  }
  if (e.target.classList.contains('slot-weight') && pr.slots[key]) {
    pr.slots[key].weight = Math.max(0, Math.round(parseFloat(e.target.value) || 0));
    save();
  }
});

// Filament laos
$('fil-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const fields = {
    material: $('fil-material').value.trim(),
    color: $('fil-color').value.trim(),
    hex: $('fil-hex').value,
    brand: $('fil-brand').value.trim(),
    count: Math.max(0, parseInt($('fil-count').value, 10) || 0),
    weight: Math.max(0, Math.round(parseFloat($('fil-weight').value) || 0)),
    price: $('fil-price').value === '' ? null : Math.max(0, parseFloat($('fil-price').value) || 0),
    note: $('fil-note').value.trim(),
    link: $('fil-link').value.trim(),
  };
  if (!fields.material) return;
  const f = filById($('fil-id').value);
  if (f) {
    Object.assign(f, fields);
  } else {
    const fil = { id: uid(), ...fields };
    state.filaments.push(fil);
    filLog('Filament lisatud', fil, fil.count);
  }
  resetFilForm();
  $('fil-form-card').open = false;
  save();
});

$('fil-cancel').addEventListener('click', () => {
  resetFilForm();
  $('fil-form-card').open = false;
});

function resetFilForm() {
  $('fil-form').reset();
  $('fil-id').value = '';
  $('fil-form-title').textContent = 'Lisa filament lattu';
  $('fil-submit').textContent = 'Lisa lattu';
  $('fil-cancel').hidden = true;
}

function editFil(id) {
  const f = filById(id);
  $('fil-id').value = f.id;
  $('fil-material').value = f.material;
  $('fil-color').value = f.color || '';
  $('fil-hex').value = safeHex(f.hex);
  $('fil-brand').value = f.brand || '';
  $('fil-count').value = f.count;
  $('fil-weight').value = f.weight;
  $('fil-price').value = f.price ?? '';
  $('fil-note').value = f.note || '';
  $('fil-link').value = f.link || '';
  $('fil-form-title').textContent = 'Muuda filamenti';
  $('fil-submit').textContent = 'Salvesta';
  $('fil-cancel').hidden = false;
  $('fil-form-card').open = true;
  $('fil-form-card').scrollIntoView({ behavior: 'smooth' });
}

$('fil-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const f = filById(btn.closest('tr').dataset.id);
  if (btn.dataset.act === 'plus' || btn.dataset.act === 'minus') {
    const delta = btn.dataset.act === 'plus' ? 1 : -1;
    if (f.count + delta < 0) return;
    f.count += delta;
    filLog(delta > 0 ? 'Filament lisatud' : 'Filament eemaldatud', f, 1);
    save();
  }
  if (btn.dataset.act === 'edit') editFil(f.id);
  if (btn.dataset.act === 'del' && confirm(`Kustutada "${filLabel(f)}" laost?`)) {
    state.filaments = state.filaments.filter((x) => x.id !== f.id);
    save();
  }
});

/* ---------- Mündid ---------- */
/* Kataloog (COIN_CATALOG) on failis mundid.js; kogu on state.coins: { mündi id: { qty, note, date } } */
const DENOM_ORDER = ['c1', 'c2', 'c5', 'c10', 'c20', 'c50', 'e1', 'e2'];
const DENOM_LABEL = { c1: '1 sent', c2: '2 senti', c5: '5 senti', c10: '10 senti', c20: '20 senti', c50: '50 senti', e1: '1 euro', e2: '2 eurot' };
const DENOM_SEARCH = { c1: '1c 0,01', c2: '2c 0,02', c5: '5c 0,05', c10: '10c 0,10', c20: '20c 0,20', c50: '50c 0,50', e1: '1€ 1 €', e2: '2€ 2 €' };
const COIN_PAGE = 120; // nii mitu münti näidatakse korraga, ülejäänud nupuga „Näita rohkem“
const countryName = Object.fromEntries(COIN_COUNTRIES.map((c) => [c.cc, c.name]));
const coinById = new Map(COIN_CATALOG.map((c) => [c.id, c]));
const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); // otsing ilma täpitähtedeta
let coinLimit = COIN_PAGE;

const coinImg = (c) => COIN_IMG_BASE + encodeURI(c.img);
const coinTitle = (c) => `${countryName[c.cc]} · ${DENOM_LABEL[c.d]}`;
const shorten = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

function coinSub(c) {
  if (c.y) return `${c.y} mälestusmünt` + (c.v ? ` · ${c.v}. variant` : '') + (c.j ? ' · ühisemissioon' : '');
  return c.s ? `${c.s}. seeria` + (c.sy ? ` (${c.sy})` : '') : 'Tavamünt';
}

const coinName = (c) => `${coinTitle(c)} (${coinSub(c)})`;
const coinOption = (c) => (c.y
  ? `${c.y} · ${shorten(c.f || 'mälestusmünt', 60)}${c.v ? ` (${c.v}. variant)` : ''}`
  : DENOM_LABEL[c.d] + (c.s ? ` · ${c.s}. seeria${c.sy ? ` (${c.sy})` : ''}` : ''));

// Riik, tavamündid nimiväärtuse ja seeria järgi, siis mälestusmündid aastate kaupa
const sortedCoins = [...COIN_CATALOG].sort((a, b) =>
  countryName[a.cc].localeCompare(countryName[b.cc], 'et')
  || (a.y || 0) - (b.y || 0)
  || DENOM_ORDER.indexOf(a.d) - DENOM_ORDER.indexOf(b.d)
  || (a.s || 0) - (b.s || 0));
for (const c of COIN_CATALOG) {
  const en = COIN_COUNTRIES.find((x) => x.cc === c.cc).en;
  c.hay = fold([countryName[c.cc], en, DENOM_LABEL[c.d], DENOM_SEARCH[c.d], coinSub(c), c.f, c.y ? 'mälestusmünt' : 'tavamünt'].join(' '));
}

function addCoin(c, qty, note) {
  const own = state.coins[c.id];
  if (!own) addLog('Münt kogusse', null, qty, null, coinName(c));
  else if (qty !== own.qty) addLog('Muudetud', null, qty - own.qty, null, coinName(c));
  state.coins[c.id] = { qty, note, date: own ? own.date : new Date().toISOString() };
  save();
}

/* Vormis valitud münt: pilt, kas on juba olemas, kogus ja märkus */
function showCoinPick(loadFields) {
  const c = coinById.get($('coin-select').value);
  const own = c && state.coins[c.id];
  $('coin-preview').hidden = !c;
  $('coin-preview-empty').hidden = !!c;
  if (c && $('coin-preview').dataset.id !== c.id) {
    $('coin-preview').src = coinImg(c);
    $('coin-preview').alt = coinTitle(c);
    $('coin-preview').dataset.id = c.id;
  }
  if (loadFields) {
    $('coin-qty').value = own ? own.qty : 1;
    $('coin-note').value = own ? own.note || '' : '';
  }
  $('coin-status').innerHTML = !c ? ''
    : `<strong>${esc(coinTitle(c))}</strong> · ${esc(coinSub(c))}${c.f ? `<br>${esc(c.f)}` : ''}<br>`
      + (own ? '<strong class="ok-text">✓ See münt on sul juba olemas</strong>' : 'Seda münti sul veel pole.');
  $('coin-submit').textContent = own ? 'Salvesta' : 'Lisa kogusse';
  $('coin-remove').hidden = !own;
}

function pickCoin(id) {
  const c = coinById.get(id);
  if (!c || readOnly) return;
  $('coin-country').value = c.cc;
  fillCoinSelect();
  $('coin-select').value = c.id;
  showCoinPick(true);
  $('coin-form').scrollIntoView({ behavior: 'smooth' });
}

$('coin-country').addEventListener('change', () => {
  fillCoinSelect();
  showCoinPick(true);
});
$('coin-select').addEventListener('change', () => showCoinPick(true));

$('coin-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const c = coinById.get($('coin-select').value);
  if (!c) return;
  addCoin(c, Math.max(1, Math.round(parseFloat($('coin-qty').value) || 1)), $('coin-note').value.trim());
});

$('coin-remove').addEventListener('click', () => {
  const c = coinById.get($('coin-select').value);
  const own = c && state.coins[c.id];
  if (!own || !confirm(`Eemaldada "${coinName(c)}" kogust?`)) return;
  addLog('Münt eemaldatud kogust', null, own.qty, null, coinName(c));
  delete state.coins[c.id];
  save();
  showCoinPick(true);
});

for (const list of ['coin-grid', 'coin-ai-list']) {
  $(list).addEventListener('click', (e) => {
    const tile = e.target.closest('[data-id]');
    if (!tile) return;
    const c = coinById.get(tile.dataset.id);
    if (e.target.closest('button[data-act="add"]')) addCoin(c, 1, '');
    else pickCoin(c.id);
  });
}

/* Foto: Claude ütleb riigi, nimiväärtuse, aasta ja kujunduse; kataloogist otsitakse sobivaimad mündid */
let coinAi = null; // { photo, result, candidates } või { photo, busy } / { photo, error }

$('coin-photo').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !window.coinIdentify) return;
  if (coinAi?.photo) URL.revokeObjectURL(coinAi.photo);
  coinAi = { photo: URL.createObjectURL(file), busy: true };
  renderCoinAi();
  try {
    const result = await window.coinIdentify(await photoBase64(file));
    if (result.viga) throw new Error(result.viga);
    coinAi = { photo: coinAi.photo, result, candidates: coinCandidates(result) };
  } catch (err) {
    coinAi = { photo: coinAi.photo, error: err.message || String(err) };
  }
  renderCoinAi();
});

/* Telefoni foto on mitu MB; Claude'ile piisab 1024 px pildist */
async function photoBase64(file) {
  const img = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

function coinCandidates(r) {
  if (!countryName[r.country]) return [];
  const words = [...new Set(fold(r.design).split(/[^a-z0-9]+/).filter((w) => w.length > 3))];
  const regular = (c) => !c.y && c.sy && /^\d+$/.test(c.sy);
  const score = (c) => {
    let s = 0;
    if (c.d === r.denomination) s += 40;
    if (!!c.y === r.commemorative) s += 30;
    if (c.y && r.year) s += c.y === r.year ? 40 : Math.abs(c.y - r.year) <= 1 ? 10 : 0;
    // tavamündi seeria: viimane seeria, mis on alanud mündi aastaks
    if (regular(c) && r.year && +c.sy <= r.year
      && !COIN_CATALOG.some((o) => o.cc === c.cc && o.d === c.d && regular(o) && +o.sy > +c.sy && +o.sy <= r.year)) s += 20;
    if (c.f) s += words.filter((w) => fold(c.f).includes(w)).length * 8;
    return s;
  };
  return sortedCoins.filter((c) => c.cc === r.country)
    .map((c) => [c, score(c)])
    .filter(([, s]) => s >= 30)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([c]) => c);
}

function renderCoinAi() {
  $('coin-ai').hidden = !coinAi;
  if (!coinAi) return;
  $('coin-ai-photo').src = coinAi.photo;
  const r = coinAi.result;
  const best = coinAi.candidates?.[0];
  let html;
  if (coinAi.busy) html = '<p class="muted">Tuvastan münti…</p>';
  else if (coinAi.error) html = `<p class="warn-text">${esc(coinAi.error)}</p>`;
  else if (!best) html = '<p><strong>Ei tundnud münti ära.</strong></p>';
  else {
    html = `<p class="muted">Tundub, et see on</p><p><strong>${esc(coinTitle(best))}</strong> · ${esc(coinSub(best))}</p>`
      + (state.coins[best.id]
        ? '<p class="coin-ai-verdict ok-text">✓ See münt on sul olemas</p>'
        : '<p class="coin-ai-verdict warn-text">✗ Seda münti sul veel pole</p>');
  }
  if (r?.note) html += `<p class="muted">${esc(r.note)}</p>`;
  if (best) html += `<p class="muted">${coinAi.candidates.length > 1 ? 'Kontrolli pilte: kui esimene ei ole õige, vali allpool teine.' : 'Kontrolli pilti.'} Vajuta mündil, et see vormis avada.</p>`;
  $('coin-ai-text').innerHTML = html;
  $('coin-ai-list').innerHTML = (coinAi.candidates || []).map(coinTile).join('');
}

for (const id of ['coin-search', 'coin-filter-country', 'coin-filter-type', 'coin-filter-have']) {
  $(id).addEventListener('input', () => {
    coinLimit = COIN_PAGE;
    renderCoinGrid();
  });
}

$('coin-more').addEventListener('click', () => {
  coinLimit += COIN_PAGE;
  renderCoinGrid();
});

/* ---------- Varukoopia ---------- */
$('export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kodu-ladu-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.parts) || !Array.isArray(data.drones)) throw new Error();
    if (!confirm('See asendab praegused andmed varukoopiaga. Jätkata?')) return;
    state = normalize(data);
    save();
  } catch {
    alert('Fail ei ole korrektne varukoopia.');
  } finally {
    e.target.value = '';
  }
});

/* ---------- Kuvamine ---------- */
function render() {
  renderCategories();
  renderParts();
  renderDrones();
  renderOrders();
  renderBuild();
  renderPrinters();
  renderCoins();
  renderLog();
}

function renderCategories() {
  const unique = (key) => [...new Set(state.parts.map((p) => p[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const cats = unique('category');
  for (const sec of SECTIONS) {
    if (!cats.some((c) => sec.match.test(c))) cats.push(sec.category);
  }
  fillCombo('part-category', cats);
  const suppliers = [...new Set([...unique('supplier'), ...state.orders.map((o) => o.supplier).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
  fillCombo('part-supplier', suppliers);
  fillCombo('order-category', cats);
  fillCombo('order-supplier', suppliers);
  fillCombo('build-category', cats);
  $('part-names').innerHTML = state.parts.map((p) => `<option value="${esc(p.name)}">`).join('');
  const sel = $('part-filter');
  const current = sel.value;
  sel.innerHTML = '<option value="">Kõik kategooriad</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  sel.value = cats.includes(current) ? current : '';
}

const moneyFmt = new Intl.NumberFormat('et-EE', { style: 'currency', currency: 'EUR' });
const money = (n) => (n == null ? '' : moneyFmt.format(n));

function linkHtml(url) {
  if (!url || !/^https?:\/\//i.test(url)) return '';
  let label = url;
  try { label = new URL(url).hostname.replace(/^www\./, ''); } catch { /* jääb terve link */ }
  return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
}

const priceLabel = (p) => (p.price == null ? '' : `${money(p.price)}/${unitOf(p)}`);

function renderParts() {
  const q = $('part-search').value.trim().toLowerCase();
  const cat = $('part-filter').value;
  // Otsas olevad detailid, millel laoseisu hoiatus on maas, peidetakse laost (droonides on need alles)
  const isHidden = (p) => p.warn === false && p.qty <= 0;
  const hiddenCount = state.parts.filter(isHidden).length;
  const showHidden = $('show-hidden').checked;
  $('show-hidden-wrap').hidden = hiddenCount === 0;
  $('hidden-count').textContent = hiddenCount;
  const rows = state.parts
    .filter((p) => showHidden || !isHidden(p))
    .filter((p) => (!cat || p.category === cat) && (!q || `${p.name} ${p.category} ${p.supplier || ''} ${p.note}`.toLowerCase().includes(q)))
    .sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name));
  const parts = rows.filter((p) => !isSeparate(p));
  const installed = {}; // mitu tükki igat detaili on droonides (üks läbikäik, mitte iga rea jaoks)
  for (const d of state.drones) for (const [id, q] of Object.entries(d.parts)) installed[id] = (installed[id] || 0) + q;

  const actions = `
      <td class="row-actions">
        <button class="small" data-act="minus" title="Vähenda">−</button>
        <button class="small" data-act="plus" title="Suurenda">+</button>
        <button class="small" data-act="edit">Muuda</button>
        <button class="small danger" data-act="del">Kustuta</button>
      </td>`;

  $('part-list').innerHTML = parts.map((p) => `
    <tr data-id="${p.id}" class="${p.warn !== false && p.qty <= LOW_STOCK ? 'low' : ''}">
      <td>${esc(p.name)}</td>
      <td>${esc(p.category)}</td>
      <td class="num">${fmtQty(p.qty, unitOf(p))}</td>
      <td class="num">${fmtQty(roundQty(installed[p.id] || 0), unitOf(p))}</td>
      <td class="num">${priceLabel(p)}</td>
      <td>${esc(p.supplier)}</td>
      <td class="muted">${esc(p.note)}</td>
      <td>${linkHtml(p.link)}</td>${actions}
    </tr>`).join('');
  $('part-empty').hidden = state.parts.some((p) => !isSeparate(p));

  for (const sec of SECTIONS) {
    const items = rows.filter((p) => sectionOf(p) === sec);
    $(sec.key + '-list').innerHTML = items.map((p) => `
    <tr data-id="${p.id}">
      <td>${esc(p.name)}</td>
      <td class="num">${fmtQty(p.qty, unitOf(p))}</td>
      <td class="num">${priceLabel(p)}</td>
      <td>${esc(p.supplier)}</td>
      <td class="muted">${esc(p.note)}</td>
      <td>${linkHtml(p.link)}</td>${actions}
    </tr>`).join('');
    $(sec.key + '-card').hidden = items.length === 0;
  }
}

function renderDrones() {
  const available = state.parts.filter((p) => p.qty > 0 && !isSeparate(p)).sort((a, b) => a.name.localeCompare(b.name));
  const options = available.map((p) => `<option value="${p.id}">${esc(p.name)} (laos ${fmtQty(p.qty, unitOf(p))})</option>`).join('');

  $('drone-list').innerHTML = state.drones.map((d) => {
    const entries = Object.entries(d.parts).map(([pid, qty]) => [partById(pid), qty, pid]).filter(([p]) => p);
    const total = entries.reduce((s, [p, q]) => s + (unitOf(p) === 'tk' ? q : 1), 0);
    const cost = entries.reduce((s, [p, q]) => s + (p.price || 0) * q, 0);
    return `
    <div class="card" data-drone="${d.id}">
      <div class="drone-head">
        <div>
          <h2>${esc(d.name)}</h2>
          <div class="muted">${esc(d.note)}${d.note ? ' · ' : ''}${total} detaili${cost ? ' · ' + money(cost) : ''}</div>
        </div>
        <button class="small danger" data-act="del-drone">Kustuta droon</button>
      </div>
      ${entries.length ? `
      <table>
        <thead><tr><th>Detail</th><th>Kategooria</th><th class="num">Kogus</th><th class="num">Hind</th><th></th></tr></thead>
        <tbody>
          ${entries.map(([p, qty, pid]) => `
          <tr>
            <td>${esc(p.name)}</td>
            <td>${esc(p.category)}</td>
            <td class="num">${fmtQty(qty, unitOf(p))}</td>
            <td class="num">${p.price == null ? '' : money(p.price * qty)}</td>
            <td class="row-actions">
              <button class="small" data-act="return" data-part="${pid}">Tagasi lattu</button>
              <button class="small danger" data-act="scrap" data-part="${pid}">Katki</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>` : '<p class="muted">Sellel droonil pole veel detaile.</p>'}
      <form class="install-form" data-drone="${d.id}">
        <select name="part" required ${available.length ? '' : 'disabled'}>
          ${available.length ? options : '<option>Laos pole midagi</option>'}
        </select>
        <input name="qty" type="number" min="0" step="any" value="1" required title="Kogus (tk või m)">
        <button type="submit" class="primary" ${available.length ? '' : 'disabled'}>Paigalda</button>
      </form>
    </div>`;
  }).join('');
  $('drone-empty').hidden = state.drones.length > 0;
}

function renderBuild() {
  const options = state.parts.filter((p) => !isSeparate(p)).sort((a, b) => a.name.localeCompare(b.name));
  $('build-parts').innerHTML = buildRows.map((r, i) => {
    const p = partById(r.partId);
    return `
    <div class="build-row" data-i="${i}">
      <select name="part">
        <option value="">— vali osa —</option>
        ${options.map((o) => `<option value="${o.id}" ${o.id === r.partId ? 'selected' : ''}>${esc(o.name)} (laos ${fmtQty(o.qty, unitOf(o))})</option>`).join('')}
      </select>
      <input name="qty" type="number" min="0" step="any" value="${r.qty}" title="Kogus ühe toote kohta">
      <span class="muted">${p ? unitOf(p) : ''}</span>
      <button type="button" class="small danger" data-act="remove" title="Eemalda">✕</button>
    </div>`;
  }).join('');
  renderBuildSummary();
}

function renderBuildSummary() {
  const need = buildNeeds();
  const count = buildCount();
  if (!need.size) {
    $('build-summary').textContent = '';
    return;
  }
  let cost = 0;
  const short = [];
  for (const [id, q] of need) {
    const p = partById(id);
    cost += (p.price || 0) * q;
    if (roundQty(q * count) > p.qty) short.push(p.name);
  }
  $('build-summary').innerHTML = (cost ? `Omahind ${money(cost)}/tk` + (count > 1 ? ` · kokku ${money(cost * count)}` : '') : '')
    + (short.length ? `<span class="warn-text">${cost ? ' · ' : ''}Laos pole piisavalt: ${short.map(esc).join(', ')}</span>` : '');
}

function renderPrinters() {
  const stock = state.filaments.filter((f) => f.count > 0)
    .sort((a, b) => filLabel(a).localeCompare(filLabel(b)));
  const stockOptions = stock.map((f) => `<option value="${f.id}">${esc(filLabel(f))} · ${f.weight} g (${f.count} rulli)</option>`).join('');

  const slotHtml = (pr, key) => {
    const s = pr.slots[key];
    if (!s) {
      return `
        <div class="slot empty-slot" data-slot="${key}">
          <div class="slot-label">${slotName(key)}</div>
          <div class="muted">Tühi</div>
          <select class="slot-load" ${stock.length ? '' : 'disabled'}>
            <option value="">${stock.length ? 'Pane rull…' : 'Laos pole filamenti'}</option>${stockOptions}
          </select>
        </div>`;
    }
    return `
      <div class="slot ${s.weight < LOW_FILAMENT ? 'slot-low' : ''}" data-slot="${key}">
        <div class="slot-label">${slotName(key)}</div>
        <div class="slot-fil"><span class="swatch" style="background:${safeHex(s.hex)}"></span><strong>${esc(s.material)}</strong></div>
        <div class="muted">${esc([s.color, s.brand].filter(Boolean).join(' · '))}</div>
        <label class="slot-g"><input class="slot-weight" type="number" min="0" step="1" value="${s.weight}" title="Alles grammides"> g alles</label>
        <div class="slot-actions">
          <button type="button" class="small" data-act="unload">Lattu</button>
          <button type="button" class="small danger" data-act="empty">Otsas</button>
        </div>
      </div>`;
  };

  $('printer-list').innerHTML = state.printers.map((pr) => {
    const units = [];
    for (let u = 0; u < pr.ams; u++) {
      const keys = [1, 2, 3, 4].map((k) => SLOT_LETTERS[u] + k);
      units.push(`<div class="ams"><h3>AMS ${u + 1}</h3><div class="slots">${keys.map((k) => slotHtml(pr, k)).join('')}</div></div>`);
    }
    units.push(`<div class="ams ams-ext"><h3>Väline rull</h3><div class="slots">${slotHtml(pr, 'ext')}</div></div>`);
    const info = [pr.model, pr.nozzle ? `düüs ${pr.nozzle} mm` : '', pr.note].filter(Boolean).map(esc).join(' · ');
    return `
    <div class="card" data-printer="${pr.id}">
      <div class="drone-head">
        <div>
          <h2>${esc(pr.name)}</h2>
          <div class="muted">${info}</div>
        </div>
        <div class="row-actions">
          <button class="small" data-act="edit-printer">Muuda</button>
          <button class="small danger" data-act="del-printer">Kustuta</button>
        </div>
      </div>
      ${units.join('')}
    </div>`;
  }).join('');

  const fils = [...state.filaments].sort((a, b) => filLabel(a).localeCompare(filLabel(b)));
  $('fil-list').innerHTML = fils.map((f) => `
    <tr data-id="${f.id}" class="${f.count < 1 ? 'low' : ''}">
      <td><span class="swatch" style="background:${safeHex(f.hex)}" title="${esc(f.color)}"></span> ${esc(f.color)}</td>
      <td>${esc(f.material)}</td>
      <td>${esc(f.brand)}</td>
      <td class="num">${f.count}</td>
      <td class="num">${f.weight} g</td>
      <td class="num">${money(f.price)}</td>
      <td class="muted">${esc(f.note)}</td>
      <td>${linkHtml(f.link)}</td>
      <td class="row-actions">
        <button class="small" data-act="minus" title="Vähenda">−</button>
        <button class="small" data-act="plus" title="Suurenda">+</button>
        <button class="small" data-act="edit">Muuda</button>
        <button class="small danger" data-act="del">Kustuta</button>
      </td>
    </tr>`).join('');
  const rolls = fils.reduce((s, f) => s + f.count, 0);
  const kg = fils.reduce((s, f) => s + f.count * f.weight, 0) / 1000;
  const value = fils.reduce((s, f) => s + f.count * (f.price || 0), 0);
  $('fil-total').textContent = fils.length ? `${rolls} rulli · ${qtyFmt.format(kg)} kg${value ? ' · ' + money(value) : ''}` : '';
  $('fil-empty').hidden = fils.length > 0;
  $('fil-brands').innerHTML = [...new Set(state.filaments.map((f) => f.brand).filter(Boolean))]
    .map((b) => `<option value="${esc(b)}">`).join('');
}

function renderOrders() {
  const fmt = new Intl.DateTimeFormat('et-EE', { dateStyle: 'short' });
  const row = (o, mainButton) => `
    <tr data-id="${o.id}">
      <td class="muted">${fmt.format(new Date(o.date))}</td>
      <td>${o.fil ? `<span class="swatch" style="background:${safeHex(o.fil.hex)}"></span> ` : ''}${esc(o.name)}${o.kind === 'printer' ? ` <span class="muted">· ${o.fil ? 'filament' : '3D printer'}</span>` : ''}</td>
      <td>${esc(o.supplier)}</td>
      <td class="num">${o.fil ? `${o.qty} rulli` : fmtQty(o.qty, unitOf(o))}</td>
      <td class="num">${o.price == null ? '' : money(o.price * o.qty)}${o.price != null && unitOf(o) === 'm' ? `<div class="muted">${priceLabel(o)}</div>` : ''}</td>
      <td class="muted">${o.track ? `<span class="track track-${o.track.status}">${MAIL_STATUS[o.track.status]} ${fmt.format(new Date(o.track.date))}</span> ` : ''}${esc(o.note)}</td>
      <td>${linkHtml(o.link)}</td>
      <td class="row-actions">
        ${mainButton}
        <button class="small" data-act="edit">Muuda</button>
        <button class="small danger" data-act="del">Kustuta</button>
      </td>
    </tr>`;
  const sum = (list) => list.reduce((s, o) => s + (o.price || 0) * o.qty, 0);

  const ordered = state.orders.filter((o) => statusOf(o) === 'ordered');
  $('order-list').innerHTML = ordered.map((o) => row(o, '<button class="small primary" data-act="arrived">Kohal</button>')).join('');
  const total = sum(ordered);
  $('order-total').textContent = ordered.length ? `${ordered.length} tellimust teel${total ? ' · ' + money(total) : ''}` : '';
  $('order-empty').hidden = ordered.length > 0;
  $('order-count').textContent = ordered.length || '';

  const planned = state.orders.filter((o) => statusOf(o) === 'planned');
  $('planned-list').innerHTML = planned.map((o) => row(o, '<button class="small primary" data-act="ordered">Tellisin</button>')).join('');
  const plannedTotal = sum(planned);
  $('planned-total').textContent = planned.length ? `${planned.length} asja${plannedTotal ? ' · ' + money(plannedTotal) : ''}` : '';
  $('planned-empty').hidden = planned.length > 0;
}

function renderMailbox() {
  const fmt = new Intl.DateTimeFormat('et-EE', { dateStyle: 'short' });
  const list = mailGroups().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  $('inbox-list').innerHTML = list.map((m) => `
    <tr data-key="${esc(m.key)}">
      <td class="muted">${m.date ? fmt.format(new Date(m.date)) : ''}</td>
      <td><span class="track track-${m.status}">${MAIL_STATUS[m.status]}</span></td>
      <td>${esc(m.shop)}</td>
      <td>${esc(m.subject)}${m.items.length ? ` <span class="muted">· ${m.items.length} toodet</span>` : ''}</td>
      <td class="muted">${esc(m.orderNo)}</td>
      <td class="num">${m.total == null ? '' : money(m.total)}</td>
      <td class="row-actions">
        <button class="small" data-act="body">${openMails.has(m.key) ? 'Peida kiri' : 'Kiri'}</button>
        <button class="small primary" data-act="add">Lisa</button>
        <button class="small danger" data-act="hide">Peida</button>
      </td>
    </tr>${openMails.has(m.key) ? `
    <tr class="mail-body-row" data-key="${esc(m.key)}"><td colspan="7"><div class="mail-body">${esc(m.text) || '<span class="muted">Kirja sisu puudub. Käivita skriptis „loeUuesti“.</span>'}</div></td></tr>` : ''}`).join('');
  $('inbox-card').hidden = list.length === 0;
}

function renderCoins() {
  // riikide valikus on näha, mitu selle riigi münti kogus on
  const total = {}, have = {};
  for (const c of COIN_CATALOG) {
    total[c.cc] = (total[c.cc] || 0) + 1;
    if (state.coins[c.id]) have[c.cc] = (have[c.cc] || 0) + 1;
  }
  const countries = [...COIN_COUNTRIES].sort((a, b) => a.name.localeCompare(b.name, 'et'));
  const options = countries.map((c) => `<option value="${c.cc}">${esc(c.name)} (${have[c.cc] || 0}/${total[c.cc] || 0})</option>`).join('');
  for (const [id, first] of [['coin-country', '— vali riik —'], ['coin-filter-country', 'Kõik riigid']]) {
    const sel = $(id);
    const current = sel.value;
    sel.innerHTML = `<option value="">${first}</option>` + options;
    sel.value = current;
  }
  fillCoinSelect();
  showCoinPick(false);
  renderCoinAi();

  const owned = COIN_CATALOG.filter((c) => state.coins[c.id]);
  const pcs = owned.reduce((s, c) => s + state.coins[c.id].qty, 0);
  const comm = owned.filter((c) => c.y).length;
  const commAll = COIN_CATALOG.filter((c) => c.y).length;
  $('coin-total').textContent = `Kogus ${owned.length} erinevat münti${pcs > owned.length ? ` (${pcs} tk)` : ''} kõigist ${COIN_CATALOG.length}-st`
    + ` · tavamünte ${owned.length - comm}/${COIN_CATALOG.length - commAll} · mälestusmünte ${comm}/${commAll}`;
  renderCoinGrid();
}

function fillCoinSelect() {
  const cc = $('coin-country').value;
  const sel = $('coin-select');
  const current = sel.value;
  const list = sortedCoins.filter((c) => c.cc === cc);
  const opt = (c) => `<option value="${esc(c.id)}">${state.coins[c.id] ? '✓ ' : ''}${esc(coinOption(c))}</option>`;
  sel.innerHTML = `<option value="">${cc ? '— vali münt —' : 'Vali enne riik'}</option>`
    + (cc ? `<optgroup label="Tavamündid">${list.filter((c) => !c.y).map(opt).join('')}</optgroup>`
      + `<optgroup label="2 € mälestusmündid">${list.filter((c) => c.y).map(opt).join('')}</optgroup>` : '');
  sel.value = list.some((c) => c.id === current) ? current : '';
  sel.disabled = !cc;
}

function coinTile(c) {
  const own = state.coins[c.id];
  return `
    <div class="coin${own ? ' have' : ''}" data-id="${esc(c.id)}" title="${esc(own?.note || 'Vaata või muuda')}">
      <img src="${esc(coinImg(c))}" alt="" loading="lazy">
      <div class="coin-title">${esc(coinTitle(c))}</div>
      <div class="coin-sub">${esc(coinSub(c))}</div>
      ${c.f ? `<div class="coin-feature">${esc(c.f)}</div>` : ''}
      <div class="coin-foot">${own
        ? `<span class="coin-badge">✓ Olemas${own.qty > 1 ? ` · ${own.qty} tk` : ''}</span>`
        : '<span class="coin-badge missing">Puudu</span><button type="button" class="small" data-act="add" title="Lisa kogusse">+ Lisa</button>'}</div>
    </div>`;
}

function renderCoinGrid() {
  const words = fold($('coin-search').value).split(/\s+/).filter(Boolean);
  const cc = $('coin-filter-country').value;
  const type = $('coin-filter-type').value;
  const have = $('coin-filter-have').value;
  const list = sortedCoins.filter((c) => {
    const own = state.coins[c.id];
    if (cc && c.cc !== cc) return false;
    if (type && (type === 'c') !== !!c.y) return false;
    if (have && (have === 'have') !== !!own) return false;
    const hay = own?.note ? c.hay + ' ' + fold(own.note) : c.hay;
    return words.every((w) => hay.includes(w));
  });
  $('coin-grid').innerHTML = list.slice(0, coinLimit).map(coinTile).join('');
  const filtered = words.length || cc || type || have;
  const found = list.filter((c) => state.coins[c.id]).length;
  $('coin-found').textContent = filtered && list.length ? `Leitud ${list.length} münti, neist sul olemas ${found}` : '';
  $('coin-empty').hidden = list.length > 0;
  $('coin-more').hidden = list.length <= coinLimit;
  $('coin-more').textContent = `Näita rohkem (veel ${list.length - coinLimit})`;
}

function renderLog() {
  const fmt = new Intl.DateTimeFormat('et-EE', { dateStyle: 'short', timeStyle: 'short' });
  $('log-list').innerHTML = state.log.slice(0, 300).map((l) => `
    <tr>
      <td class="muted">${fmt.format(new Date(l.date))}</td>
      <td>${esc(l.type)}</td>
      <td>${esc(l.partName)}</td>
      <td class="num">${l.qty > 0 && l.type === 'Muudetud' ? '+' : ''}${fmtQty(l.qty, l.unit || 'tk')}</td>
      <td>${esc(l.droneName)}</td>
    </tr>`).join('');
  $('log-empty').hidden = state.log.length > 0;
}

render();
$('printer-form-card').open = state.printers.length === 0;
