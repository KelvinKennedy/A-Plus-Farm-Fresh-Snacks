/* ==========================================================================
   A Plus Snacks: admin dashboard
   Uses Firebase Auth to sign in and Firestore to store everything.

   Contents
    1. Imports, constants and state
    2. Small helpers
    3. Sign in
    4. Live data and rendering
    5. Dashboard
    6. Products
    7. Orders
    8. Accounts (income and expenses)
    9. Users
   10. Settings
   11. Events
   12. Start
   ========================================================================== */


/* 1. Imports, constants and state
   -------------------------------------------------------------------------- */

import { app, db, configured } from '../js/firebase.js';
import { DEFAULT_SETTINGS, DEFAULT_PRODUCTS } from '../js/defaults.js';
import { lockLeft, recordFail, resetFails, runCountdown, resumeCountdown } from '../js/Throttle.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updateProfile,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  deleteDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const STATUSES = ['new', 'paid', 'shipped', 'delivered', 'cancelled'];
const INCOME_STATUSES = ['paid', 'shipped', 'delivered']; /* orders that count as income */
const PAYMENT_NAMES = { mpesa: 'M-Pesa', card: 'Card', cod: 'Cash on delivery' };

/* Live data from Firestore */
let products = [];
let orders = [];
let users = [];
let expenses = [];
let settings = { ...DEFAULT_SETTINGS };
let unsubscribers = []; /* functions that stop the live listeners */

/* Screen state */
let tab = 'dash';
let editing = null; /* the product being edited (a copy), or null */
let adding = false; /* is the "new expense" form open? */
let ordFilter = 'all'; /* orders tab: status filter */
let acctRange = 'month'; /* accounts tab: period */


/* 2. Small helpers
   -------------------------------------------------------------------------- */

const $ = (selector) => document.querySelector(selector);

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

const kes = (n) => 'KES ' + Number(n || 0).toLocaleString('en-KE');
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; /* 2026-03-07 */
const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* Firestore timestamp (or date string) -> Date, or null */
const toDate = (v) => (v && v.toDate ? v.toDate() : v ? new Date(v) : null);
const orderDate = (o) => (o.createdAt && o.createdAt.toDate ? o.createdAt.toDate() : new Date());

function shortDate(v) {
  const d = toDate(v);
  const valid = d && !isNaN(d);
  return valid ? d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
}

/* Sample photos live in the shop's images folder, one level up from /admin */
const imageSrc = (s) => (/^(data:|https?:|\/)/.test(s) ? s : '../' + s);

/* Kenyan phone number -> international format for wa.me links */
function whatsappPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('0')) return '254' + digits.slice(1);
  return digits.length === 9 ? '254' + digits : digits;
}

function toast(message) {
  const box = $('#toast');
  box.textContent = message;
  box.classList.add('on');
  setTimeout(() => box.classList.remove('on'), 2500);
}

function fail(e) {
  if (e && e.code === 'permission-denied') {
    toast('Permission denied. Check your Firestore rules and admin email.');
  } else {
    toast((e && e.message) || 'Something went wrong');
  }
}

/* Each doc in a snapshot -> { id, ...fields } */
const docsToList = (snapshot) => snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

/* One damaged or old order must never break the whole admin: fill in anything missing. */
function safeOrder(o) {
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const cust = o.customer && typeof o.customer === 'object' ? o.customer : {};
  return {
    ...o,
    orderNo: String(o.orderNo || o.id || ''),
    customer: { name: '', phone: '', email: '', address: '', area: '', ...cust },
    items: Array.isArray(o.items) ? o.items.filter((l) => l && typeof l === 'object').map((l) => ({ name: '', price: 0, qty: 0, ...l })) : [],
    subtotal: num(o.subtotal),
    delivery: num(o.delivery),
    total: num(o.total),
    payment: o.payment || 'cod',
    status: STATUSES.includes(o.status) ? o.status : 'new',
  };
}

/* ----- CSV downloads ----- */

const csvCell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';

function downloadCsv(filename, rows) {
  const link = document.createElement('a');
  const text = rows.map((row) => row.map(csvCell).join(',')).join('\n');
  link.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  link.download = filename;
  link.click();
}


/* 3. Sign in
   -------------------------------------------------------------------------- */

const auth = configured ? getAuth(app) : null;

function login() {
  $('#lerr').textContent = '';

  if (lockLeft('admin') > 0) {
    runCountdown('admin', '#lerr', '#lbtn');
    return;
  }

  signInWithEmailAndPassword(auth, $('#em').value.trim(), $('#pw').value)
    .then(() => {
      resetFails('admin');
      $('#pw').value = '';
    })
    .catch((e) => {
      const wrongDetails = /credential|password|user-not-found/.test(e.code);
      if (wrongDetails) recordFail('admin');
      $('#lerr').textContent = wrongDetails
        ? 'Wrong email or password.'
        : e.code === 'auth/too-many-requests'
          ? 'Too many attempts. Please wait a few minutes and try again.'
          : `Could not sign in (${e.code}).`;
      if (lockLeft('admin') > 0) runCountdown('admin', '#lerr', '#lbtn');
    });
}

/* Only an admin may read this probe document (see firestore.rules), so no admin emails are
   needed in this page. */
async function isAdminAccount() {
  try {
    await getDoc(doc(db, 'admin_check', 'ping'));
    return true;
  } catch (e) {
    return false;
  }
}

/* Mark this account as admin in its profile (the Users tab uses it) and ask once for the
   first name shown there. */
async function ensureAdminName(user) {
  let name = (user.displayName || '').trim();
  if (!name) {
    name = (window.prompt('Welcome! Enter your first name (shown in the Users list):') || '').trim().slice(0, 80);
    if (name) {
      try {
        await updateProfile(user, { displayName: name });
      } catch (e) {}
    }
  }
  const data = { isAdmin: true, email: user.email };
  if (name) data.name = name;
  try {
    await setDoc(doc(db, 'users', user.uid), data, { merge: true });
  } catch (e) {}
}

function watchSignIn() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      stopListening();
      $('#app').hidden = true;
      $('#login').hidden = false;
      return;
    }

    /* only the shop admin may use this page */
    if (!(await isAdminAccount())) {
      $('#lerr').textContent = 'This account is not the shop admin.';
      signOut(auth);
      return;
    }

    $('#login').hidden = true;
    $('#app').hidden = false;
    startListening();
    ensureAdminName(user);
  });
}


/* 4. Live data and rendering
   -------------------------------------------------------------------------- */

function startListening() {
  stopListening();
  const listen = (source, onData) => unsubscribers.push(onSnapshot(source, onData, fail));

  listen(collection(db, 'products'), (snap) => {
    products = docsToList(snap).sort((a, b) => a.name.localeCompare(b.name));
    refresh();
  });
  listen(query(collection(db, 'orders'), orderBy('createdAt', 'desc')), (snap) => {
    orders = docsToList(snap).map(safeOrder);
    refresh();
  });
  listen(collection(db, 'users'), (snap) => {
    users = docsToList(snap);
    refresh();
  });
  listen(query(collection(db, 'expenses'), orderBy('date', 'desc')), (snap) => {
    expenses = docsToList(snap);
    refresh();
  });
  listen(doc(db, 'settings', 'store'), (snap) => {
    settings = { ...DEFAULT_SETTINGS, ...(snap.exists() ? snap.data() : {}) };
    refresh();
  });

  render();
}

function stopListening() {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [];
}

/* Redraw after data changes, except while the admin is typing in a form
   (a redraw would wipe what they have typed). */
function refresh() {
  const productFormOpen = tab === 'products' && editing;
  const expenseFormOpen = tab === 'account' && adding;
  if (productFormOpen || expenseFormOpen || tab === 'settings') return;
  render();
}

const VIEWS = {
  dash: dashView,
  products: productsView,
  orders: ordersView,
  users: usersView,
  account: accountsView,
  settings: settingsView,
};

/* Each tab has its own address (admin/#products, admin/#orders ...), so the Back button works,
   a refresh stays on the same tab, and a tab can be opened in a new browser tab. */
function tabFromHash() {
  const name = location.hash.slice(1);
  return VIEWS[name] ? name : 'dash';
}
tab = tabFromHash();

function render() {
  document.querySelectorAll('#tabs a').forEach((link) => {
    link.classList.toggle('on', link.dataset.tab === tab);
  });
  VIEWS[tab]();
}


/* 5. Dashboard
   -------------------------------------------------------------------------- */

/* Income for each of the last 7 days (orders marked paid, shipped or delivered) */
function last7Days() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push({ key: ymd(d), label: d.toLocaleDateString('en-KE', { weekday: 'short' }), total: 0 });
  }

  orders
    .filter((o) => INCOME_STATUSES.includes(o.status))
    .forEach((o) => {
      const day = days.find((x) => x.key === ymd(orderDate(o)));
      if (day) day.total += o.total;
    });
  return days;
}

/* Top 5 products by units sold: [[name, units], ...] */
function bestSellers(liveOrders) {
  const sold = {};
  liveOrders.forEach((o) => {
    (o.items || []).forEach((line) => {
      sold[line.name] = (sold[line.name] || 0) + line.qty;
    });
  });
  return Object.entries(sold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
}

function statsHTML(liveOrders) {
  const revenue = liveOrders.reduce((sum, o) => sum + o.total, 0);
  const newOrders = orders.filter((o) => o.status === 'new').length;

  return `
    <div class="stats">
      <div class="stat"><b>${products.length}</b><span>Products</span></div>
      <div class="stat"><b>${orders.length}</b><span>Orders</span></div>
      <div class="stat"><b>${newOrders}</b><span>New orders</span></div>
      <div class="stat"><b>${kes(revenue)}</b><span>Revenue (not cancelled)</span></div>
    </div>`;
}

function emptyShopHTML() {
  return `
    <div class="panel">
      <h3>Your shop is empty</h3>
      <p class="mut">Add your first product, or load sample products to see how the shop looks.</p>
      <button class="b" data-act="seed">Load sample products</button>
    </div>`;
}

function weekChartHTML() {
  const days = last7Days();
  const max = Math.max(1, ...days.map((d) => d.total));

  const bars = days
    .map((d) => {
      const height = Math.max(2, Math.round((d.total / max) * 100));
      const amount = d.total ? Number(d.total).toLocaleString('en-KE') : '';
      return `
        <div class="bar-col" title="${esc(d.label)}: ${kes(d.total)}">
          <small>${amount}</small>
          <i style="height:${height}px"></i>
          <small>${esc(d.label)}</small>
        </div>`;
    })
    .join('');

  return `
    <div class="panel">
      <h3>Last 7 days</h3>
      <p class="mut" style="margin-top:-6px">Income from orders marked paid, shipped or delivered.</p>
      <div class="bars">${bars}</div>
    </div>`;
}

function bestSellersHTML(liveOrders) {
  const top = bestSellers(liveOrders);
  const rows = top
    .map(([name, units], i) => `<div>${i + 1}. ${esc(name)} <span class="tag">${units} sold</span></div>`)
    .join('');

  return `
    <div class="panel">
      <h3>Best sellers</h3>
      ${rows || '<span class="mut">Best sellers appear once you have orders.</span>'}
    </div>`;
}

function soldOutHTML() {
  const rows = products
    .filter((p) => p.inStock === false)
    .map((p) => `<div>${esc(p.name)}</div>`)
    .join('');

  return `
    <div class="panel">
      <h3>Marked sold out</h3>
      ${rows || '<span class="mut">Everything is in stock.</span>'}
    </div>`;
}

function latestOrdersHTML() {
  const rows = orders
    .slice(0, 5)
    .map(
      (o) => `
        <div>${esc(o.orderNo)} - ${esc(o.customer.name)} - ${kes(o.total)}
          <span class="tag">${esc(o.status)}</span>
        </div>`
    )
    .join('');

  return `
    <div class="panel">
      <h3>Latest orders</h3>
      ${rows || '<span class="mut">No orders yet.</span>'}
    </div>`;
}

function sampleDataHTML() {
  return `
    <details class="panel">
      <summary>Sample data</summary>
      <p class="mut">Start fresh with the sample snack products (photos, descriptions and badges included). Your orders, expenses and settings are not touched.</p>
      <button class="b danger sm" data-act="reseed">Replace all products with the sample snacks</button>
    </details>`;
}

function dashView() {
  const liveOrders = orders.filter((o) => o.status !== 'cancelled');

  $('#view').innerHTML =
    statsHTML(liveOrders) +
    (products.length ? '' : emptyShopHTML()) +
    weekChartHTML() +
    bestSellersHTML(liveOrders) +
    soldOutHTML() +
    latestOrdersHTML() +
    (products.length ? sampleDataHTML() : '');
}

/* ----- sample products ----- */

/* Add every sample product to a Firestore batch */
function addSamplesToBatch(batch) {
  DEFAULT_PRODUCTS.forEach(({ id, ...data }) => batch.set(doc(db, 'products', id), data));
}

function seedProducts() {
  const batch = writeBatch(db);
  addSamplesToBatch(batch);
  batch.commit().then(() => toast('Sample products added')).catch(fail);
}

function reseedProducts() {
  const ok = confirm(
    `This DELETES all ${products.length} current products and replaces them with the sample snacks. ` +
      'Orders, expenses and settings are not affected. Continue?'
  );
  if (!ok) return;

  const batch = writeBatch(db);
  const sampleIds = new Set(DEFAULT_PRODUCTS.map((p) => p.id));

  products.forEach((p) => {
    if (!sampleIds.has(p.id)) batch.delete(doc(db, 'products', p.id));
  });
  addSamplesToBatch(batch);
  batch.commit().then(() => toast('Sample snacks loaded')).catch(fail);
}


/* 6. Products
   -------------------------------------------------------------------------- */

const BADGE_SUGGESTIONS = ['New', 'Best seller', 'Spicy', 'Gift idea', 'Limited'];

const NEW_PRODUCT = {
  name: '',
  cat: '',
  price: 0,
  color: '#14213d',
  note: '',
  desc: '',
  pack: '',
  badge: '',
  oldPrice: 0,
  image: '',
  active: true,
  inStock: true,
};

const datalistOptions = (values) => values.map((v) => `<option value="${esc(v)}">`).join('');

function productFormHTML(p) {
  const categories = [...new Set(products.map((x) => x.cat))];
  const removePhoto = p.image
    ? '<p class="mut">A photo is set. Choose a new file to replace it, or <button class="b ghost sm" data-act="rmimg">remove photo</button></p>'
    : '';

  return `
    <div class="panel">
      <h3>${p.id ? 'Edit product' : 'New product'}</h3>

      <div class="row">
        <div>
          <label for="pn">Name</label>
          <input class="f" id="pn" value="${esc(p.name)}">
        </div>
        <div>
          <label for="pc">Category</label>
          <input class="f" id="pc" value="${esc(p.cat)}" list="cats">
          <datalist id="cats">${datalistOptions(categories)}</datalist>
        </div>
        <div>
          <label for="pp">Price (KES)</label>
          <input class="f" id="pp" type="number" min="0" value="${p.price}">
        </div>
        <div>
          <label for="pcol">Tile colour (when no photo)</label>
          <input class="f" id="pcol" type="color" value="${esc(p.color)}">
        </div>
        <div>
          <label for="pf">Photo (PNG, JPG or WebP)</label>
          <input class="f" id="pf" type="file" accept="image/png,image/jpeg,image/webp">
        </div>
      </div>

      <label for="pd">Short description (shown on the product card)</label>
      <input class="f" id="pd" value="${esc(p.note)}">

      <label for="pdesc">Full description (shown in the product details window)</label>
      <textarea class="f" id="pdesc" rows="3">${esc(p.desc)}</textarea>

      <div class="row">
        <div>
          <label for="pk">Pack size (e.g. Pack of 4)</label>
          <input class="f" id="pk" value="${esc(p.pack)}">
        </div>
        <div>
          <label for="pb">Badge (e.g. New, Best seller)</label>
          <input class="f" id="pb" list="badges" value="${esc(p.badge)}">
          <datalist id="badges">${datalistOptions(BADGE_SUGGESTIONS)}</datalist>
        </div>
        <div>
          <label for="po">Old price, optional (shows a sale)</label>
          <input class="f" id="po" type="number" min="0" value="${p.oldPrice || ''}">
        </div>
      </div>

      <label><input type="checkbox" id="pa"${p.active !== false ? ' checked' : ''}> Visible in the shop</label>
      <label><input type="checkbox" id="pi"${p.inStock !== false ? ' checked' : ''}> In stock (untick to show "Sold out")</label>
      ${removePhoto}

      <div class="acts" style="margin-top:14px">
        <button class="b" id="psave" data-act="save">Save product</button>
        <button class="b ghost" data-act="cancel">Cancel</button>
      </div>
    </div>`;
}

function productRowHTML(p) {
  const thumb = p.image
    ? `<img src="${esc(imageSrc(p.image))}" alt="">`
    : esc(p.name.charAt(0));
  const hidden = p.active === false ? '<span class="tag off">hidden</span> ' : '';
  const stock =
    p.inStock === false ? '<span class="tag off">sold out</span>' : '<span class="tag">in stock</span>';

  return `
    <tr>
      <td><div class="th" style="background:${esc(p.color)}">${thumb}</div></td>
      <td>${esc(p.name)}</td>
      <td>${esc(p.cat)}</td>
      <td>${kes(p.price)}</td>
      <td>${hidden}${stock}</td>
      <td class="acts">
        <button class="b ghost sm" data-edit="${esc(p.id)}">Edit</button>
        <button class="b danger sm" data-del="${esc(p.id)}">Delete</button>
      </td>
    </tr>`;
}

function productsView() {
  $('#view').innerHTML = `
    <div class="top"><h2>Products</h2><button class="b" data-act="new">Add product</button></div>
    ${editing ? productFormHTML(editing) : ''}
    <div class="tw">
      <table>
        <thead><tr><th></th><th>Name</th><th>Category</th><th>Price</th><th>Status</th><th></th></tr></thead>
        <tbody>${products.map(productRowHTML).join('')}</tbody>
      </table>
    </div>`;
}

/* Resize photos to max 640px so they stay small
   (they are stored inside Firestore, so no paid plan is needed). */
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      const scale = Math.min(1, 640 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);

      /* WebP is smaller than JPEG; older Safari cannot make it, so fall back */
      const webp = canvas.toDataURL('image/webp', 0.78);
      resolve(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = url;
  });
}

/* Read the product form into a Firestore document (text is trimmed and length-limited) */
function readProductForm(current) {
  const text = (selector, max) => $(selector).value.trim().slice(0, max);
  const wholeNumber = (selector) => Math.max(0, Math.round(Number($(selector).value) || 0));

  return {
    name: text('#pn', 80),
    cat: text('#pc', 40) || 'General',
    price: wholeNumber('#pp'),
    note: text('#pd', 160),
    desc: text('#pdesc', 600),
    pack: text('#pk', 60),
    badge: text('#pb', 30),
    oldPrice: wholeNumber('#po'),
    color: $('#pcol').value,
    image: current.image || '',
    active: $('#pa').checked,
    inStock: $('#pi').checked,
    updatedAt: serverTimestamp(),
  };
}

async function saveProduct() {
  const current = editing;
  const file = $('#pf').files[0];
  const button = $('#psave');
  const data = readProductForm(current);

  if (!data.name) return toast('Enter a product name');
  button.disabled = true;

  try {
    if (file) {
      data.image = await shrinkImage(file);
      if (data.image.length > 700000) throw new Error('Image is too detailed. Try a smaller photo.');
    }

    if (current.id) await setDoc(doc(db, 'products', current.id), data);
    else await addDoc(collection(db, 'products'), data);

    editing = null;
    render();
    toast('Product saved');
  } catch (e) {
    fail(e);
    button.disabled = false;
  }
}


/* 7. Orders
   -------------------------------------------------------------------------- */

/* True if an order's prices no longer match the catalogue (worth a second look) */
function pricesDiffer(o) {
  const itemsChanged = o.items.some((line) => {
    const p = products.find((x) => x.id === line.id);
    return !p || p.price !== line.price;
  });
  const itemsTotal = o.items.reduce((sum, line) => sum + line.price * line.qty, 0);
  return itemsChanged || o.subtotal !== itemsTotal;
}

/* Link that opens a WhatsApp chat with the customer, with a first message filled in */
function customerWhatsappUrl(o) {
  const firstName = String(o.customer.name || '').split(' ')[0];
  const message = `Hi ${firstName}, this is ${settings.shopName} about your order ${o.orderNo} (${kes(o.total)}).`;
  return `https://wa.me/${whatsappPhone(o.customer.phone)}?text=${encodeURIComponent(message)}`;
}

function orderCardHTML(o) {
  /* the email the customer typed at checkout; older orders only have the account email */
  const customerEmail = o.customer.email || o.email;
  const statusOptions = STATUSES.map((s) => `<option${s === o.status ? ' selected' : ''}>${s}</option>`).join('');
  const items = o.items
    .map(
      (line) => `
        <li>
          <span class="oc-q">${esc(line.qty)}&times;</span>
          <span class="oc-n">${esc(line.name)}</span>
          <span class="oc-p">${kes(line.price * line.qty)}</span>
        </li>`
    )
    .join('');

  return `
    <article class="oc">
      <div class="oc-head">
        <div>
          <strong class="oc-no">${esc(o.orderNo)}</strong>
          <small class="mut">${orderDate(o).toLocaleString('en-KE')}</small>
        </div>
        <select class="f oc-st" data-st="${esc(o.id)}" aria-label="Order status">${statusOptions}</select>
      </div>

      <div class="oc-cust">
        <strong>${esc(o.customer.name)}</strong>
        <span class="mut">${customerEmail ? esc(customerEmail) : 'No email given'}</span>
        <span>
          <a href="tel:${esc(o.customer.phone)}">${esc(o.customer.phone)}</a> &middot;
          <a href="${esc(customerWhatsappUrl(o))}" target="_blank" rel="noopener">WhatsApp</a>
        </span>
        <span class="mut">${esc(o.customer.address)}${o.customer.area ? ` (${esc(o.customer.area)})` : ''}</span>
      </div>

      <ul class="oc-items">${items}</ul>

      <div class="oc-foot">
        <span class="tag">${PAYMENT_NAMES[o.payment] || esc(o.payment || '')}</span>
        ${Number(o.delivery) ? `<span class="mut">Delivery ${kes(o.delivery)}</span>` : ''}
        <span class="sp"></span>
        <span class="oc-total">${kes(o.total)}</span>
      </div>

      ${pricesDiffer(o) ? '<div class="tag off">Prices differ from catalogue, verify</div>' : ''}
      <div class="oc-act"><button class="b danger sm" data-delo="${esc(o.id)}">Delete</button></div>
    </article>`;
}

function ordersView() {
  const counts = { all: orders.length };
  STATUSES.forEach((s) => {
    counts[s] = orders.filter((o) => o.status === s).length;
  });

  const shown = ordFilter === 'all' ? orders : orders.filter((o) => o.status === ordFilter);

  const filterButtons = ['all', ...STATUSES]
    .map((s) => {
      const style = s === ordFilter ? '' : ' ghost';
      return `<button class="b sm${style}" data-of="${s}">${capitalise(s)} (${counts[s]})</button>`;
    })
    .join('');

  const list = shown.length
    ? `<div class="ocs">${shown.map(orderCardHTML).join('')}</div>`
    : '<div class="panel mut">No orders in this view yet. New orders appear here the moment a customer checks out.</div>';

  $('#view').innerHTML = `
    <div class="top"><h2>Orders</h2><button class="b ghost" data-act="csv">Download CSV</button></div>
    <div class="acts fl">${filterButtons}</div>
    ${list}`;
}

function ordersCsv() {
  downloadCsv('orders.csv', [
    ['Order', 'Date', 'Name', 'Phone', 'Address', 'Items', 'Subtotal', 'Delivery', 'Total', 'Payment', 'Status'],
    ...orders.map((o) => [
      o.orderNo,
      orderDate(o).toISOString(),
      o.customer.name,
      o.customer.phone,
      o.customer.address,
      o.items.map((line) => `${line.qty} x ${line.name}`).join('; '),
      o.subtotal,
      o.delivery,
      o.total,
      o.payment,
      o.status,
    ]),
  ]);
}


/* 8. Accounts (income and expenses)
   -------------------------------------------------------------------------- */

const RANGES = { month: 'This month', last: 'Last month', year: 'This year', all: 'All time' };
const EXPENSE_CATEGORIES = [
  'Stock purchase',
  'Delivery and transport',
  'Packaging',
  'Rent',
  'Marketing',
  'Salaries',
  'Airtime and internet',
  'Other',
];

/* Is a date string (2026-03-07) inside the selected period? */
function inRange(dateString) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  if (acctRange === 'all') return true;
  if (acctRange === 'year') return dateString.startsWith(year + '-');

  const first = acctRange === 'last' ? new Date(year, month - 1, 1) : new Date(year, month, 1);
  return dateString.startsWith(`${first.getFullYear()}-${pad(first.getMonth() + 1)}`);
}

/* Income, expenses and profit for the selected period */
function accountData() {
  const paidOrders = orders.filter((o) => INCOME_STATUSES.includes(o.status) && inRange(ymd(orderDate(o))));
  const pendingOrders = orders.filter((o) => o.status === 'new' && inRange(ymd(orderDate(o))));
  const periodExpenses = expenses.filter((x) => inRange(x.date));

  const income = paidOrders.reduce((sum, o) => sum + o.total, 0);
  const spent = periodExpenses.reduce((sum, x) => sum + x.amount, 0);

  return {
    paidOrders,
    pendingOrders,
    periodExpenses,
    income,
    spent,
    profit: income - spent,
    pending: pendingOrders.reduce((sum, o) => sum + o.total, 0),
  };
}

function expenseFormHTML() {
  const categories = [...new Set([...EXPENSE_CATEGORIES, ...expenses.map((x) => x.cat)])];

  return `
    <div class="panel">
      <h3>New expense</h3>
      <div class="row">
        <div>
          <label for="xd">Date</label>
          <input class="f" id="xd" type="date" value="${ymd(new Date())}">
        </div>
        <div>
          <label for="xc">Category</label>
          <input class="f" id="xc" list="xcats" placeholder="e.g. Stock purchase">
          <datalist id="xcats">${datalistOptions(categories)}</datalist>
        </div>
        <div>
          <label for="xa">Amount (KES)</label>
          <input class="f" id="xa" type="number" min="0">
        </div>
        <div>
          <label for="xn">Note (optional)</label>
          <input class="f" id="xn">
        </div>
      </div>
      <div class="acts" style="margin-top:14px">
        <button class="b" data-act="savex">Save expense</button>
        <button class="b ghost" data-act="cancelx">Cancel</button>
      </div>
    </div>`;
}

function accountStatsHTML(a) {
  return `
    <div class="stats">
      <div class="stat"><b>${kes(a.income)}</b><span>Income (${a.paidOrders.length} orders paid, shipped or delivered)</span></div>
      <div class="stat"><b>${kes(a.spent)}</b><span>Expenses (${a.periodExpenses.length})</span></div>
      <div class="stat">
        <b class="${a.profit >= 0 ? 'pos' : 'neg'}">${kes(a.profit)}</b>
        <span>${a.profit >= 0 ? 'Profit' : 'Loss'}</span>
      </div>
      <div class="stat"><b>${kes(a.pending)}</b><span>Pending (${a.pendingOrders.length} new orders, not counted)</span></div>
    </div>`;
}

function spendingByCategoryHTML(a) {
  const totals = {};
  a.periodExpenses.forEach((x) => {
    totals[x.cat] = (totals[x.cat] || 0) + x.amount;
  });

  const rows = Object.entries(totals)
    .sort((x, y) => y[1] - x[1])
    .map(([category, amount]) => `<div>${esc(category)}: <strong>${kes(amount)}</strong></div>`)
    .join('');

  return `
    <div class="panel">
      <h3>Spending by category</h3>
      ${rows || '<span class="mut">No expenses in this period.</span>'}
    </div>`;
}

function expensesTableHTML(a) {
  if (!a.periodExpenses.length) {
    return '<div class="panel mut">No expenses recorded for this period.</div>';
  }

  const rows = a.periodExpenses
    .map(
      (x) => `
        <tr>
          <td>${esc(x.date)}</td>
          <td>${esc(x.cat)}</td>
          <td>${esc(x.note)}</td>
          <td class="tr">${kes(x.amount)}</td>
          <td><button class="b danger sm" data-delx="${esc(x.id)}">Delete</button></td>
        </tr>`
    )
    .join('');

  return `
    <div class="tw">
      <table>
        <thead><tr><th>Date</th><th>Category</th><th>Note</th><th class="tr">Amount</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function accountsView() {
  const a = accountData();
  const rangeOptions = Object.entries(RANGES)
    .map(([key, label]) => `<option value="${key}"${key === acctRange ? ' selected' : ''}>${label}</option>`)
    .join('');

  $('#view').innerHTML = `
    <div class="top">
      <h2>Accounts</h2>
      <div class="acts">
        <select class="f" id="acr" aria-label="Period" style="width:auto">${rangeOptions}</select>
        <button class="b ghost" data-act="acsv">Download CSV</button>
        <button class="b" data-act="newx">Add expense</button>
      </div>
    </div>
    ${adding ? expenseFormHTML() : ''}
    ${accountStatsHTML(a)}
    ${spendingByCategoryHTML(a)}
    <h3>Expenses</h3>
    ${expensesTableHTML(a)}
    <p class="mut">Income counts orders marked paid, shipped or delivered, using the order total (including delivery). Set order statuses on the Orders tab.</p>`;
}

function saveExpense() {
  const date = $('#xd').value;
  const amount = Math.round(Number($('#xa').value) || 0);

  if (!date) return toast('Pick a date');
  if (amount <= 0) return toast('Enter an amount');

  addDoc(collection(db, 'expenses'), {
    date,
    cat: $('#xc').value.trim().slice(0, 40) || 'Other',
    note: $('#xn').value.trim().slice(0, 160),
    amount,
    createdAt: serverTimestamp(),
  })
    .then(() => {
      adding = false;
      render();
      toast('Expense added');
    })
    .catch(fail);
}

function accountsCsv() {
  const a = accountData();

  downloadCsv(`accounts-${acctRange}.csv`, [
    ['Date', 'Type', 'Category', 'Description', 'Amount'],
    ...a.paidOrders.map((o) => [ymd(orderDate(o)), 'Income', 'Sales', `${o.orderNo} - ${o.customer.name}`, o.total]),
    ...a.periodExpenses.map((x) => [x.date, 'Expense', x.cat, x.note || '', -x.amount]),
    ['', 'Profit', '', RANGES[acctRange], a.profit],
  ]);
}


/* 9. Users
   -------------------------------------------------------------------------- */

const DAY_MS = 864e5;

/* Orders and total spent by one user (cancelled orders do not count) */
function userOrderStats(u) {
  const mine = orders.filter((o) => o.uid === u.id && o.status !== 'cancelled');
  return { count: mine.length, spent: mine.reduce((sum, o) => sum + (o.total || 0), 0) };
}

const isAdminUser = (u) => u.isAdmin === true;

/* Accounts kept out of the Users tab for everyone, including themselves.
   Lowercase emails. This is cosmetic: the profile still exists in Firestore. */
const HIDDEN_FROM_USERS = ['ototokelvin180@gmail.com'];

function visibleUsers() {
  return users.filter((u) => !HIDDEN_FROM_USERS.includes(String(u.email || '').toLowerCase()));
}

function userStatusTag(u) {
  if (isAdminUser(u)) return '<span class="tag">Admin</span>';
  return u.blocked ? '<span class="tag off">Blocked</span>' : '<span class="tag">Active</span>';
}

function userActionsHTML(u) {
  if (isAdminUser(u)) return '';
  return `
    <div class="acts">
      <button class="b ghost sm" data-ublock="${esc(u.id)}">${u.blocked ? 'Unblock' : 'Block'}</button>
      <button class="b danger sm" data-udel="${esc(u.id)}">Remove</button>
    </div>`;
}

function userRowHTML(u) {
  const stats = userOrderStats(u);
  const searchText = esc((u.name + ' ' + u.email).toLowerCase());

  return `
    <tr data-q="${searchText}">
      <td><strong>${esc(isAdminUser(u) ? String(u.name || '').trim().split(' ')[0] || 'Admin' : u.name || 'No name')}</strong><br><small class="mut">${esc(u.email)}</small></td>
      <td>${shortDate(u.createdAt)}</td>
      <td>${shortDate(u.lastLogin)}</td>
      <td class="tr">${stats.count}</td>
      <td class="tr">${kes(stats.spent)}</td>
      <td>${userStatusTag(u)}</td>
      <td>${userActionsHTML(u)}</td>
    </tr>`;
}

function usersTableHTML(list, emptyText) {
  if (!list.length) return `<div class="panel mut">${emptyText}</div>`;
  return `
    <div class="tw">
      <table>
        <thead>
          <tr><th>User</th><th>Joined</th><th>Last seen</th><th class="tr">Orders</th><th class="tr">Spent</th><th>Status</th><th></th></tr>
        </thead>
        <tbody class="ubody">${list.map(userRowHTML).join('')}</tbody>
      </table>
    </div>`;
}

function usersView() {
  /* most recently seen first */
  const all = visibleUsers().sort((x, y) => (toDate(y.lastLogin) || 0) - (toDate(x.lastLogin) || 0));
  const admins = all.filter(isAdminUser);
  const list = all.filter((u) => !isAdminUser(u)); /* customers only */
  const monthAgo = Date.now() - 30 * DAY_MS;
  const active = list.filter((u) => {
    const seen = toDate(u.lastLogin);
    return seen && seen.getTime() > monthAgo;
  }).length;
  const blocked = list.filter((u) => u.blocked).length;

  $('#view').innerHTML = `
    <div class="top"><h2>Users</h2><button class="b ghost" data-act="ucsv">Download CSV</button></div>
    <div class="stats">
      <div class="stat"><b>${list.length}</b><span>Registered customers</span></div>
      <div class="stat"><b>${active}</b><span>Active in last 30 days</span></div>
      <div class="stat"><b>${blocked}</b><span>Blocked</span></div>
      <div class="stat"><b>${admins.length}</b><span>Admins</span></div>
    </div>
    <input class="f" id="usearch" type="search" placeholder="Search by name or email" aria-label="Search users" style="margin-bottom:12px">

    <h3 class="usec" id="uadmins-h">Admins <span class="mut">(${admins.length})</span></h3>
    <div id="uadmins">${usersTableHTML(admins, 'No admin profiles yet. An admin appears here after signing in to this page.')}</div>

    <h3 class="usec" style="margin-top:28px">Customers <span class="mut">(${list.length})</span></h3>
    <div id="ucust">${usersTableHTML(list, 'No customers yet. They appear here when they create an account or next sign in.')}</div>
    <p class="mut">Block stops a customer from signing in to the shop. Remove deletes their profile here only; to erase the login completely, delete it in Firebase console &gt; Authentication. Customers appear here after their next sign-in. Admins cannot be blocked or removed here.</p>`;
}

function usersCsv() {
  downloadCsv('users.csv', [
    ['Role', 'Name', 'Email', 'Joined', 'Last seen', 'Orders', 'Status'],
    ...visibleUsers().map((u) => [
      isAdminUser(u) ? 'admin' : 'customer',
      u.name,
      u.email,
      shortDate(u.createdAt),
      shortDate(u.lastLogin),
      orders.filter((o) => o.uid === u.id).length,
      u.blocked ? 'blocked' : 'active',
    ]),
  ]);
}

function toggleBlockUser(id) {
  const u = users.find((x) => x.id === id);
  if (!u) return;

  if (!u.blocked) {
    const ok = confirm(
      `Block ${u.email || 'this user'}? They will be signed out of the shop and cannot sign in again until you unblock them.`
    );
    if (!ok) return;
  }
  updateDoc(doc(db, 'users', u.id), { blocked: !u.blocked })
    .then(() => toast(u.blocked ? 'User unblocked' : 'User blocked'))
    .catch(fail);
}

/* Hide the rows that do not match what is typed in the search box */
function filterUserRows(text) {
  const q = text.trim().toLowerCase();
  document.querySelectorAll('.ubody tr').forEach((row) => {
    row.hidden = q && !row.dataset.q.includes(q);
  });
}


/* 10. Settings
   -------------------------------------------------------------------------- */

/* [setting name, label shown above the box] */
const SETTING_FIELDS = [
  ['shopName', 'Shop name'],
  ['heroTitle', 'Homepage headline'],
  ['heroText', 'Homepage text'],
  ['eyebrow', 'Small line above the headline (e.g. Fresh snacks)'],
  ['tagline', 'Footer description'],
  ['announcement', 'Announcement bar (blank to hide)'],
  ['footer', 'Footer text'],
  ['whatsapp', 'WhatsApp number (country code first, e.g. 2547...)'],
  ['mpesaType', 'M-Pesa type (Till number or Paybill number)'],
  ['mpesaTill', 'M-Pesa till or paybill number'],
  ['mpesaAccount', 'M-Pesa account number (Paybill only; blank = customer uses their order number)'],
  ['deliveryNairobi', 'Delivery fee: Nairobi (KES)'],
  ['deliveryOther', 'Delivery fee: other towns (KES)'],
  ['freeOver', 'Free delivery over (KES)'],
];
const NUMBER_SETTINGS = ['deliveryNairobi', 'deliveryOther', 'freeOver'];

function settingsView() {
  const fields = SETTING_FIELDS.map(
    ([key, label]) => `
      <div>
        <label for="s_${key}">${label}</label>
        <input class="f" id="s_${key}" value="${esc(settings[key])}">
      </div>`
  ).join('');

  $('#view').innerHTML = `
    <div class="top"><h2>Settings</h2></div>
    <div class="panel">
      <div class="row">${fields}</div>
      <div style="margin-top:16px"><button class="b" data-act="saveset">Save settings</button></div>
    </div>`;
}

function saveSettings() {
  const data = {};

  SETTING_FIELDS.forEach(([key]) => {
    const value = $('#s_' + key).value.trim();
    data[key] = NUMBER_SETTINGS.includes(key) ? Math.max(0, Math.round(Number(value) || 0)) : value.slice(0, 300);
  });
  data.whatsapp = data.whatsapp.replace(/\D/g, '');

  setDoc(doc(db, 'settings', 'store'), data, { merge: true })
    .then(() => toast('Settings saved'))
    .catch(fail);
}


/* 11. Events
   -------------------------------------------------------------------------- */

function switchTab(name) {
  tab = name;
  editing = null;
  adding = false;
  render();
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => {
  const name = tabFromHash();
  if (name !== tab) switchTab(name);
});

function newProduct() {
  editing = { ...NEW_PRODUCT };
  productsView();
}

function editProduct(id) {
  editing = { ...products.find((p) => p.id === id) };
  productsView();
  window.scrollTo(0, 0);
}

/* Ask first, then delete one document */
function confirmDelete(question, collectionName, id, doneMessage) {
  if (!confirm(question)) return;
  deleteDoc(doc(db, collectionName, id))
    .then(() => toast(doneMessage))
    .catch(fail);
}

/* Buttons with data-act="..." */
const ACTIONS = {
  new: newProduct,
  save: saveProduct,
  cancel: () => {
    editing = null;
    render();
  },
  rmimg: () => {
    editing.image = '';
    productsView();
  },
  seed: seedProducts,
  reseed: reseedProducts,
  csv: ordersCsv,
  ucsv: usersCsv,
  newx: () => {
    adding = true;
    accountsView();
  },
  cancelx: () => {
    adding = false;
    render();
  },
  savex: saveExpense,
  acsv: accountsCsv,
  saveset: saveSettings,
};

const CLICKABLE = [
  'data-tab',
  'data-act',
  'data-edit',
  'data-del',
  'data-delo',
  'data-ublock',
  'data-udel',
  'data-delx',
  'data-of',
]
  .map((attribute) => `button[${attribute}]`)
  .join(',');

document.addEventListener('click', (e) => {
  const button = e.target.closest(CLICKABLE);
  if (!button) return;
  const d = button.dataset;

  if (d.tab) switchTab(d.tab);
  else if (d.act) {
    const run = ACTIONS[d.act];
    if (run) run();
  } else if (d.of) {
    ordFilter = d.of;
    render();
  } else if (d.edit) editProduct(d.edit);
  else if (d.ublock) toggleBlockUser(d.ublock);
  else if (d.del) {
    confirmDelete(
      'Delete this product? This cannot be undone. To keep it but hide it, edit it and untick "Visible in the shop".',
      'products',
      d.del,
      'Product deleted'
    );
  } else if (d.udel) {
    confirmDelete(
      'Remove this user profile from the list? Their login still exists until deleted in Firebase console.',
      'users',
      d.udel,
      'User removed'
    );
  } else if (d.delx) confirmDelete('Delete this expense?', 'expenses', d.delx, 'Expense deleted');
  else if (d.delo) confirmDelete('Delete this order?', 'orders', d.delo, 'Order deleted');
});

document.addEventListener('change', (e) => {
  /* accounts: period picker */
  if (e.target.id === 'acr') {
    acctRange = e.target.value;
    render();
    return;
  }
  /* orders: status picker on an order card */
  if (e.target.dataset.st) {
    updateDoc(doc(db, 'orders', e.target.dataset.st), { status: e.target.value })
      .then(() => toast('Order marked ' + e.target.value))
      .catch(fail);
  }
});

/* users: search box */
document.addEventListener('input', (e) => {
  if (e.target.id === 'usearch') filterUserRows(e.target.value);
});

$('#lbtn').addEventListener('click', login);
resumeCountdown('admin', '#lerr', '#lbtn'); /* carry on a wait that was running before a refresh */
$('#pw').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});
$('#logout').addEventListener('click', () => signOut(auth));


/* 12. Start
   -------------------------------------------------------------------------- */

if (configured) {
  watchSignIn();
} else {
  /* Firebase is not set up yet: show the setup message instead of the login form */
  $('#login').hidden = false;
  $('#setup').hidden = false;
  $('#lform').hidden = true;
}
