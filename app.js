const STORAGE_KEY = 'drooni-ladu-v1';
const LOW_STOCK = 1; // tõsta esile read, kus laoseis on sellest väiksem või võrdne (kui detailil on hoiatus sees)
// Nende kategooriate asjad näidatakse laos eraldi nimekirjas ja neid ei paigaldata droonile
const SECTIONS = [
  { key: 'tool', category: 'Tööriistad', match: /^tööriist/i },
  { key: 'charger', category: 'Laadijad', match: /^laadija/i },
];

let state = load();

function normalize(data) {
  return { parts: [], drones: [], orders: [], recipes: {}, log: [], ...data };
}

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data && Array.isArray(data.parts)) return normalize(data);
  } catch (e) { /* tühi või vigane */ }
  return normalize({});
}

let readOnly = false; // teise inimese lao vaatamine

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
$('order-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const editing = state.orders.find((o) => o.id === $('order-id').value);
  const order = {
    id: editing ? editing.id : uid(),
    date: editing ? editing.date : new Date().toISOString(),
    name: $('order-name').value.trim(),
    category: comboValue('order-category'),
    supplier: comboValue('order-supplier'),
    qty: readQty('order'),
    unit: $('order-unit').value,
    price: unitPrice('order'),
    note: $('order-note').value.trim(),
    link: $('order-link').value.trim(),
  };
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
    addLog('Tellitud', null, order.qty, null, order.name);
    state.log[0].unit = order.unit;
  }
  resetOrderForm();
  save();
});

$('order-cancel').addEventListener('click', resetOrderForm);

function resetOrderForm() {
  $('order-form').reset();
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

function receiveOrder(id) {
  const order = state.orders.find((o) => o.id === id);
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

$('order-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('tr').dataset.id;
  if (btn.dataset.act !== 'edit' && $('order-id').value === id) resetOrderForm(); // muudetav tellimus kaob nimekirjast
  if (btn.dataset.act === 'arrived') receiveOrder(id);
  if (btn.dataset.act === 'edit') editOrder(id);
  if (btn.dataset.act === 'del') deleteOrder(id);
});

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

/* ---------- Varukoopia ---------- */
$('export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `drooni-ladu-${new Date().toISOString().slice(0, 10)}.json`;
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
    state = { parts: data.parts, drones: data.drones, orders: data.orders || [], recipes: data.recipes || {}, log: data.log || [] };
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
      <td class="num">${fmtQty(installedCount(p.id), unitOf(p))}</td>
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

function renderOrders() {
  const fmt = new Intl.DateTimeFormat('et-EE', { dateStyle: 'short' });
  $('order-list').innerHTML = state.orders.map((o) => `
    <tr data-id="${o.id}">
      <td class="muted">${fmt.format(new Date(o.date))}</td>
      <td>${esc(o.name)}</td>
      <td>${esc(o.supplier)}</td>
      <td class="num">${fmtQty(o.qty, unitOf(o))}</td>
      <td class="num">${o.price == null ? '' : money(o.price * o.qty)}${o.price != null && unitOf(o) === 'm' ? `<div class="muted">${priceLabel(o)}</div>` : ''}</td>
      <td class="muted">${esc(o.note)}</td>
      <td>${linkHtml(o.link)}</td>
      <td class="row-actions">
        <button class="small primary" data-act="arrived">Kohal</button>
        <button class="small" data-act="edit">Muuda</button>
        <button class="small danger" data-act="del">Kustuta</button>
      </td>
    </tr>`).join('');
  const total = state.orders.reduce((s, o) => s + (o.price || 0) * o.qty, 0);
  $('order-total').textContent = state.orders.length ? `${state.orders.length} tellimust teel${total ? ' · ' + money(total) : ''}` : '';
  $('order-empty').hidden = state.orders.length > 0;
  $('order-count').textContent = state.orders.length || '';
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
