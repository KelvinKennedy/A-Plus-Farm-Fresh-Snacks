/* ==========================================================================
   A Plus Snacks: storefront
   Products and settings come from Firestore (managed in /admin).

   Contents
    1. Imports and state
    2. Small helpers
    3. Storage (cart, favourites)
    4. Cart maths
    5. Product photos
    6. Product cards, settings, filters
    7. Favourites
    8. Product details window
    9. Cart drawer and checkout
   10. M-Pesa details and order confirmation
   11. Customer account: sign in, profile sync
   12. Account window: forms and hub
   13. Mobile menu and scroll effects
   14. Event listeners
   15. Start
   ========================================================================== */


/* 1. Imports and state
   -------------------------------------------------------------------------- */

import { DEFAULT_SETTINGS, DEFAULT_PRODUCTS } from './defaults.js';

/* Firebase is loaded later with import() inside start(). A normal import from the
   internet would stop this whole file from running when the visitor is offline. */
let db = null;
let configured = false;
let firestore = null; /* Firestore module */
let authLib = null; /* Auth module */
let auth = null; /* Auth instance */
let user = null; /* signed-in customer, or null */

/* Shop data */
let S = {}; /* settings */
let PRODUCTS = [];
let cart = {}; /* { productId: quantity } */
let favs = {}; /* { productId: 1 } */

/* Filters */
let cat = 'All';
let query = '';
let sort = 'featured';

/* Cart drawer */
let stage = 'cart'; /* 'cart' | 'checkout' | 'done' */
let doneHTML = '';

/* Product details window */
let pdId = null;
let pdQty = 1;

/* Account window */
let acctMode = 'register'; /* 'register' | 'login' | 'profile' */
let acctTab = 'dash';
let prevOn = null; /* menu link that was highlighted before the account window opened */

/* Toast */
let toastTimer = null;
let toastFn = null;

const MAX_QTY = 99;
const FAV = '__favs'; /* special "category" for the favourites filter */
import { lockLeft, recordFail, resetFails, runCountdown, resumeCountdown } from './Throttle.js';

const ADMIN_URL = 'admin/'; /* folder with the admin index.html, relative to this page */
const REVEAL =
  'IntersectionObserver' in window &&
  !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const nav = document.querySelector('#nav');
const menuBtn = document.querySelector('#menuBtn');

/* The account and product window styles live in css/extras.css.
   Load it here if index.html does not already. */
if (!document.querySelector('link[href*="extras.css"]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'css/extras.css';
  document.head.appendChild(link);
}


/* 2. Small helpers
   -------------------------------------------------------------------------- */

const $ = (selector) => document.querySelector(selector);

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

const kes = (n) => 'KES ' + Number(n).toLocaleString('en-KE');
const find = (id) => PRODUCTS.find((p) => String(p.id) === String(id));
const whatsappUrl = (text) =>
  S.whatsapp
    ? 'https://wa.me/' + encodeURIComponent(S.whatsapp) + (text ? '?text=' + encodeURIComponent(text) : '')
    : '#';

function setText(selector, text) {
  const el = $(selector);
  if (el) el.textContent = text;
}

function toast(message, actionLabel, actionFn) {
  let box = $('#toast');
  toastFn = actionFn || null;

  /* never let a missing message box break the page */
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast';
    box.setAttribute('role', 'status');
    document.body.appendChild(box);
  }

  const button = actionLabel ? `<button type="button" id="toastAct">${esc(actionLabel)}</button>` : '';
  box.innerHTML = `<span>${esc(message)}</span>${button}`;
  box.classList.add('on');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('on'), 3500);
}

function bumpCartCount() {
  const count = $('#count');
  count.classList.remove('bump');
  void count.offsetWidth; /* restart the animation */
  count.classList.add('bump');
}


/* 3. Storage (cart, favourites)
   -------------------------------------------------------------------------- */

function readJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* storage full or blocked: carry on without saving */
  }
}

const loadStorage = () => {
  cart = readJSON('mm_cart', {});
  favs = readJSON('aps_favs', {});
};
const saveCart = () => writeJSON('mm_cart', cart);
const saveFavs = () => writeJSON('aps_favs', favs);


/* 4. Cart maths
   -------------------------------------------------------------------------- */

function cartItems() {
  return Object.keys(cart)
    .map((id) => ({ p: find(id), n: Math.min(MAX_QTY, Math.floor(Number(cart[id]) || 0)) }))
    .filter((x) => x.p && x.n > 0);
}

const subtotal = () => cartItems().reduce((sum, x) => sum + x.p.price * x.n, 0);
const totalQty = () => cartItems().reduce((sum, x) => sum + x.n, 0);
const favCount = () => Object.keys(favs).filter((id) => find(id)).length;

function addToCart(id, n) {
  cart[id] = Math.min(MAX_QTY, (cart[id] || 0) + n);
  saveCart();
  updateCount();
  bumpCartCount();
}

function updateCount() {
  $('#count').textContent = totalQty();
}

/* Delivery fee: free over the threshold, otherwise by delivery area */
function shippingFee() {
  const area = $('#area');
  if (S.freeOver && subtotal() >= S.freeOver) return 0;
  return area && area.value === 'other' ? S.deliveryOther : S.deliveryNairobi;
}


/* 5. Product photos
   -------------------------------------------------------------------------- */

/* Each rule: [word to look for in the product name, picture]. First match wins.
   A photo uploaded in the admin page always wins over these.
   No match and no upload: the coloured letter. */
const BUILTIN_PHOTOS = [
  [/platter/i, 'images/slides/snack1.jpg'],
  [/fritter/i, 'images/slides/snack9.jpg'],
  [/ringo|corn ring/i, 'images/slides/snack13.jpg'],
  [/samosa/i, 'images/slides/snack8.jpg'],
  [/muffin|cupcake/i, 'images/slides/snack7.jpg'],
  [/mandazi|mahamri|doughnut|donut/i, 'images/slides/snack9.jpg'],
  [/popcorn/i, 'images/slides/snack3.jpg'],
  [/crisp/i, 'images/slides/snack5.jpg'],
  [/wing/i, 'images/slides/snack14.jpg'],
  [/chicken|drumstick/i, 'images/slides/snack15.jpg'],
  [/chip|fries/i, 'images/slides/snack6.jpg'],
  [/heart/i, 'images/slides/snack11.jpg'],
  [/lolli|sucker/i, 'images/slides/snack12.jpg'],
  [/choc/i, 'images/slides/snack10.jpg'],
  [/cheese|curl|puff|nik/i, 'images/slides/snack2.jpg'],
];

/* Photos are normally written as <img> tags inside <template id="photos"> in index.html
   (data-name = word(s) to look for in the product name). If the template is missing,
   the built-in list above is used. */
function readPhotoTemplate() {
  const template = document.getElementById('photos');
  const rules = [];

  if (template && template.content) {
    template.content.querySelectorAll('img[data-name]').forEach((img) => {
      rules.push([
        new RegExp(img.getAttribute('data-name'), 'i'),
        img.getAttribute('src'),
        img.getAttribute('alt') || '',
      ]);
    });
  }
  return rules.length ? rules : BUILTIN_PHOTOS;
}

const LOCAL_PHOTOS = readPhotoTemplate();

function localPhoto(p) {
  const rule = LOCAL_PHOTOS.find(([pattern]) => pattern.test(p.name || ''));
  return rule ? { src: rule[1], alt: rule[2] || '' } : null;
}

/* Photo (or coloured letter) for a product */
function art(p) {
  const local = /^data:/.test(p.image || '') ? null : localPhoto(p);
  const src = local ? local.src : p.image;

  if (!src) {
    return `<span class="ph" style="background:${esc(p.color)}">${esc(p.name.charAt(0))}</span>`;
  }
  const alt = (local && local.alt) || p.name;
  return `<img data-art="1" src="${esc(src)}" alt="${esc(alt)}" loading="lazy">`;
}

/* If a photo fails to load, try the other folder (images/ or images/slides/) once.
   The alt text shows if it still fails. */
document.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.dataset.art || img.dataset.retry) return;

    img.dataset.retry = '1';
    const src = img.getAttribute('src');
    img.src = /images\/slides\//.test(src)
      ? src.replace('images/slides/', 'images/')
      : src.replace('images/', 'images/slides/');
  },
  true
);


/* 6. Product cards, settings, filters
   -------------------------------------------------------------------------- */

/* Heart (favourite) buttons are switched off.
   To bring them back: return !/ringo|samosa|sausage/i.test(p.name || ''); */
function hasHeart(p) {
  return false;
}

function salePercent(p) {
  return p.oldPrice && p.oldPrice > p.price ? Math.round((1 - p.price / p.oldPrice) * 100) : 0;
}

/* Text badges ("Best seller", "Great for sharing"...) are switched off.
   To bring them back, add a line here that shows p.badge. */
function badgeHTML(p) {
  if (p.inStock === false) return '<span class="badge out">Sold out</span>';
  const percent = salePercent(p);
  return percent ? `<span class="badge sale">-${percent}%</span>` : '';
}

function priceHTML(p) {
  const old = salePercent(p) ? ` <s>${kes(p.oldPrice)}</s>` : '';
  return kes(p.price) + old;
}

function favButtonHTML(p) {
  const saved = !!favs[p.id];
  const label = (saved ? 'Remove ' : 'Save ') + p.name + (saved ? ' from favourites' : ' to favourites');
  return `<button class="fav" data-fav="${esc(p.id)}" aria-pressed="${saved}" aria-label="${esc(label)}">${
    saved ? '\u2665' : '\u2661'
  }</button>`;
}

function applySettings() {
  document.title = S.shopName + ' | Online shop';

  setText('#logo', S.shopName);
  setText('#flogo', S.shopName); /* footer parts are optional */
  setText('#ftag', S.tagline);
  setText('#footer', S.footer);
  setText('#eyebrow', S.eyebrow);
  setText('#heroTitle', S.heroTitle);
  setText('#heroText', S.heroText);

  const waLink = $('#waLink');
  if (waLink) waLink.href = whatsappUrl();
  const waFloat = $('#waFloat');
  if (waFloat) waFloat.href = whatsappUrl(`Hi ${S.shopName}! I would like to order some snacks.`);

  const banner = $('#ann');
  banner.textContent = S.announcement || '';
  banner.hidden = !S.announcement;
}

/* ----- category chips ----- */

function chipHTML(value, label) {
  return `<button class="chip" aria-pressed="${value === cat}" data-cat="${esc(value)}">${esc(label)}</button>`;
}

function renderChips() {
  const categories = ['All', ...new Set(PRODUCTS.map((p) => p.cat))];
  let html = categories.map((c) => chipHTML(c, c)).join('');

  const saved = favCount();
  if (saved || cat === FAV) html += chipHTML(FAV, `\u2665 Favourites (${saved})`);

  $('#chips').innerHTML = html;
}

/* ----- filtering and sorting ----- */

/* "Featured" order: best sellers first, sold-out items last */
function featuredRank(p) {
  if (p.inStock === false) return 2;
  return /best/i.test(p.badge || '') ? 0 : 1;
}

function visibleProducts() {
  const q = query.toLowerCase();

  const list = PRODUCTS.filter((p) => {
    const inCategory = cat === 'All' || (cat === FAV ? !!favs[p.id] : p.cat === cat);
    const searchText = `${p.name} ${p.cat} ${p.note || ''} ${p.desc || ''}`.toLowerCase();
    return inCategory && searchText.includes(q);
  });

  if (sort === 'low') list.sort((a, b) => a.price - b.price);
  else if (sort === 'high') list.sort((a, b) => b.price - a.price);
  else if (sort === 'az') list.sort((a, b) => a.name.localeCompare(b.name));
  else list.sort((a, b) => featuredRank(a) - featuredRank(b));

  return list;
}

/* ----- product grid ----- */

function cardHTML(p, index) {
  const out = p.inStock === false;
  const id = esc(p.id);

  return `
    <article class="card${REVEAL ? ' rv' : ''}" style="--d:${(index % 8) * 0.05}s">
      <div class="tile${out ? ' out' : ''}" data-open="${id}">
        ${art(p)}
        ${badgeHTML(p)}
        ${hasHeart(p) ? favButtonHTML(p) : ''}
      </div>
      <div class="info">
        <h3><button class="plink" data-open="${id}">${esc(p.name)}</button></h3>
        <small>${esc(p.note)}</small>
        <div class="price">${priceHTML(p)}</div>
        <button class="btn" data-add="${id}"${out ? ' disabled' : ''}>${out ? 'Sold out' : 'Add to cart'}</button>
      </div>
    </article>`;
}

function emptyGridHTML() {
  const message =
    cat === FAV
      ? 'You have not saved any favourites yet. Tap the heart on a product to save it.'
      : 'No products match. Try another word or choose All.';
  return `<div class="empty"><p>${message}</p><button class="btn ghost" data-reset="1">Show all products</button></div>`;
}

function renderGrid() {
  const list = visibleProducts();
  const grid = $('#grid');
  grid.removeAttribute('aria-busy');

  let summary = '';
  if (list.length) {
    summary = `Showing ${list.length} ${list.length === 1 ? 'product' : 'products'}`;
    if (query) summary += ` for \u201c${query}\u201d`;
  }
  $('#results').textContent = summary;

  grid.innerHTML = list.length ? list.map(cardHTML).join('') : emptyGridHTML();
  observeReveals();
}


/* 7. Favourites
   -------------------------------------------------------------------------- */

function toggleFav(id) {
  const p = find(id);
  if (!p) return;

  if (favs[id]) delete favs[id];
  else favs[id] = 1;
  saveFavs();
  const saved = !!favs[id];

  /* update every heart button for this product (card and details window) */
  document.querySelectorAll(`[data-fav="${id}"]`).forEach((button) => {
    button.setAttribute('aria-pressed', saved);

    if (button.classList.contains('fav')) {
      button.textContent = saved ? '\u2665' : '\u2661';
      button.setAttribute(
        'aria-label',
        (saved ? 'Remove ' : 'Save ') + p.name + (saved ? ' from favourites' : ' to favourites')
      );
    } else {
      button.textContent = saved ? '\u2665 Saved to favourites' : '\u2661 Save to favourites';
    }
  });

  if (cat === FAV && !favCount()) cat = 'All';
  renderChips();
  if (cat === FAV) renderGrid();

  toast(saved ? `Saved ${p.name} to favourites` : `Removed ${p.name} from favourites`);
}


/* 8. Product details window
   -------------------------------------------------------------------------- */

function ensureDetailsDialog() {
  if ($('#pd')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'pd';
  dialog.className = 'pd';
  dialog.setAttribute('aria-labelledby', 'pdTitle');
  document.body.appendChild(dialog);
}

function openDetails(id) {
  if (!find(id)) return;
  ensureDetailsDialog();
  pdId = id;
  pdQty = 1;
  renderDetails();

  const dialog = $('#pd');
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}

function closeDetails() {
  const dialog = $('#pd');
  if (dialog && dialog.open) dialog.close();
}

/* "You may also like": same category first, then the rest (max 5) */
function relatedProducts(p) {
  const others = PRODUCTS.filter((x) => x.id !== p.id);
  const sameCategory = others.filter((x) => x.cat === p.cat);
  const otherCategory = others.filter((x) => x.cat !== p.cat);
  return [...sameCategory, ...otherCategory].slice(0, 5);
}

function relatedHTML(p) {
  const related = relatedProducts(p);
  if (!related.length) return '';

  const buttons = related
    .map(
      (x) => `
        <button data-open="${esc(x.id)}">
          <div class="th">${art(x)}</div>
          <small><strong>${esc(x.name)}</strong><br>${kes(x.price)}</small>
        </button>`
    )
    .join('');

  return `<div class="pd-rel"><h4>You may also like</h4><div class="strip">${buttons}</div></div>`;
}

function buyControlsHTML(out) {
  if (out) return '<button class="btn" disabled>Sold out</button>';
  return `
    <div class="stepper">
      <button data-pddec="1" aria-label="Decrease quantity">-</button>
      <span id="pdQty" aria-live="polite">1</span>
      <button data-pdinc="1" aria-label="Increase quantity">+</button>
    </div>
    <button class="btn" data-pdadd="1">Add to cart</button>`;
}

function renderDetails() {
  const p = find(pdId);
  const out = p.inStock === false;
  const saved = !!favs[p.id];
  const percent = salePercent(p);
  const question = `Hi ${S.shopName}, I have a question about ${p.name} (${kes(p.price)}).`;

  const favLink = hasHeart(p)
    ? `<button data-fav="${esc(p.id)}" aria-pressed="${saved}">${
        saved ? '\u2665 Saved to favourites' : '\u2661 Save to favourites'
      }</button>`
    : '';

  $('#pd').innerHTML = `
    <button class="pd-x" data-close="1" aria-label="Close details">&times;</button>
    <div class="pd-grid">
      <div class="pd-img">${art(p)}${badgeHTML(p)}</div>
      <div class="pd-body">
        <span class="pd-cat">${esc(p.cat)}</span>
        <h2 id="pdTitle">${esc(p.name)}</h2>
        <div class="pd-price">${priceHTML(p)}${percent ? `<span class="save">Save ${percent}%</span>` : ''}</div>
        <p class="pd-desc">${esc(p.desc || p.note)}</p>
        <ul class="pd-facts">
          ${p.pack ? `<li><b>Pack</b>${esc(p.pack)}</li>` : ''}
          <li><b>Availability</b>${out ? 'Sold out right now' : 'In stock'}</li>
          <li><b>Delivery</b>Nairobi ${kes(S.deliveryNairobi)}, other towns ${kes(S.deliveryOther)}. Free over ${kes(S.freeOver)}.</li>
        </ul>
        <div class="pd-buy">${buyControlsHTML(out)}</div>
        <div class="pd-links">
          ${favLink}
          <a href="${whatsappUrl(question)}" target="_blank" rel="noopener">${
            out ? 'Ask when it is back' : 'Ask about this on WhatsApp'
          }</a>
        </div>
      </div>
    </div>
    ${relatedHTML(p)}`;
}


/* 9. Cart drawer and checkout
   -------------------------------------------------------------------------- */

function openDrawer() {
  const drawer = $('#drawer');
  stage = 'cart';
  renderDrawer();

  drawer.removeAttribute('inert');
  drawer.classList.add('on');
  drawer.setAttribute('aria-hidden', 'false');
  $('#scrim').classList.add('on');
  $('#closeCart').focus();
}

function closeDrawer() {
  const drawer = $('#drawer');
  const wasOpen = drawer.classList.contains('on');

  drawer.classList.remove('on');
  drawer.setAttribute('aria-hidden', 'true');
  drawer.setAttribute('inert', '');
  $('#scrim').classList.remove('on');

  if (wasOpen) $('#openCart').focus();
}

function updateSummary() {
  const box = $('#sum');
  if (!box) return;

  const delivery = shippingFee();
  const sub = subtotal();
  box.innerHTML = `
    <div><span>Subtotal</span><span>${kes(sub)}</span></div>
    <div><span>Delivery</span><span>${delivery ? kes(delivery) : 'Free'}</span></div>
    <div class="tot"><span>Total</span><span>${kes(sub + delivery)}</span></div>`;
}

/* "Add KES x more for free delivery" progress bar */
function freeDeliveryBar() {
  if (!S.freeOver) return '';

  const sub = subtotal();
  const left = S.freeOver - sub;
  if (left <= 0) return '<div class="freebar ok">You have unlocked <strong>free delivery</strong>.</div>';

  const percent = Math.min(100, Math.round((sub / S.freeOver) * 100));
  return `
    <div class="freebar">
      Add <strong>${kes(left)}</strong> more for free delivery
      <div class="track"><i style="width:${percent}%"></i></div>
    </div>`;
}

/* ----- drawer stages: cart, checkout, done ----- */

function cartStageHTML(items) {
  const lines = items
    .map((x) => {
      const id = esc(x.p.id);
      return `
        <div class="line">
          <div class="mini" aria-hidden="true">${art(x.p)}</div>
          <div>
            <strong>${esc(x.p.name)}</strong>
            <div class="qty">
              <button data-dec="${id}" aria-label="Decrease quantity">-</button>
              <span>${x.n}</span>
              <button data-inc="${id}" aria-label="Increase quantity">+</button>
            </div>
          </div>
          <div style="text-align:right">
            ${kes(x.p.price * x.n)}<br>
            <button class="link" data-rm="${id}">Remove</button>
          </div>
        </div>`;
    })
    .join('');

  return `
    ${lines}
    ${freeDeliveryBar()}
    <div class="sum">
      <div class="tot"><span>Subtotal</span><span>${kes(subtotal())}</span></div>
      <small style="color:var(--muted)">Delivery is calculated at checkout.</small>
    </div>
    <button class="btn" style="width:100%;justify-content:center" data-go="checkout">Continue to checkout</button>`;
}

function checkoutStageHTML() {
  const tip = user
    ? ''
    : '<p class="note">Tip: sign in before you place your order to see it, and its payment status, in your account.</p>';

  return `
    ${tip}
    <label for="fn">Full name</label>
    <input class="field" id="fn" autocomplete="name">

    <label for="ph">Phone number (M-Pesa)</label>
    <input class="field" id="ph" type="tel" placeholder="0712 345 678" autocomplete="tel">

    <label for="em">Email</label>
    <input class="field" id="em" type="email" placeholder="you@example.com" autocomplete="email">

    <label for="area">Delivery area</label>
    <select class="field" id="area">
      <option value="nairobi">Nairobi and surroundings</option>
      <option value="other">Other town in Kenya</option>
    </select>

    <label for="ad">Address or landmark</label>
    <textarea class="field" id="ad" rows="2"></textarea>

    <label>Payment method</label>
    <div class="pay">
      <label>
        <input type="radio" name="pm" value="mpesa" checked>
        <span><strong>M-Pesa</strong><br><small>${mpesaLine()}</small></span>
      </label>
      <label>
        <input type="radio" name="pm" value="card">
        <span><strong>Card (Visa or Mastercard)</strong><br><small>We send a secure payment link on WhatsApp.</small></span>
      </label>
      <label>
        <input type="radio" name="pm" value="cod">
        <span><strong>Cash on delivery</strong><br><small>Pay the rider when your order arrives.</small></span>
      </label>
    </div>

    <div class="sum" id="sum"></div>
    <div class="err" id="err" role="alert"></div>
    <button class="btn" id="placeBtn" style="width:100%;justify-content:center;margin-top:8px" data-go="place">Place order</button>
    <button class="link" style="margin-top:12px;color:var(--ink)" data-go="cart">Back to cart</button>`;
}

function renderDrawer() {
  const body = $('#db');
  const items = cartItems();

  if (stage === 'cart') {
    $('#dtitle').textContent = 'Your cart';
    body.innerHTML = items.length
      ? cartStageHTML(items)
      : '<p class="empty">Your cart is empty. Add something from the shop to get started.</p>';
  } else if (stage === 'checkout') {
    $('#dtitle').textContent = 'Checkout';
    body.innerHTML = checkoutStageHTML();
    prefillCheckout();
    updateSummary();
  } else {
    $('#dtitle').textContent = 'Order placed';
    body.innerHTML = doneHTML;
  }
}

/* ----- placing the order ----- */

function readCheckoutForm() {
  return {
    name: $('#fn').value.trim().slice(0, 80),
    phone: $('#ph').value.replace(/[^\d+\s()-]/g, '').trim().slice(0, 20),
    email: $('#em').value.trim().slice(0, 100),
    area: $('#area').value,
    address: $('#ad').value.trim().slice(0, 200),
  };
}

/* 10 random letters/numbers: no clashes between orders placed at the same moment */
function newOrderNo() {
  const bytes = new Uint8Array(6);
  (window.crypto || window.msCrypto).getRandomValues(bytes);
  const rand = Array.from(bytes, (b) => (b % 36).toString(36)).join('').toUpperCase();
  return 'AP' + rand;
}

function placeOrder() {
  const errorBox = $('#err');
  const button = $('#placeBtn');
  const customer = readCheckoutForm();
  const digits = customer.phone.replace(/\D/g, '');

  if (!customer.name || !customer.address || digits.length < 9) {
    errorBox.textContent = 'Enter your name, a valid phone number and your delivery address.';
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
    errorBox.textContent = 'Enter a valid email address.';
    return;
  }

  const items = cartItems();
  if (!items.length) {
    errorBox.textContent = 'Your cart is empty.';
    return;
  }

  const soldOut = items.filter((x) => x.p.inStock === false);
  if (soldOut.length) {
    errorBox.textContent = soldOut.map((x) => x.p.name).join(', ') + ' is sold out. Remove it from your cart to continue.';
    return;
  }

  const sub = subtotal();
  const delivery = shippingFee();
  const order = {
    id: newOrderNo(),
    customer,
    payment: document.querySelector('input[name="pm"]:checked').value,
    items: items.map((x) => ({ id: String(x.p.id), name: x.p.name, price: x.p.price, qty: x.n })),
    subtotal: sub,
    delivery,
    total: sub + delivery,
  };

  if (order.payment === 'mpesa' && !S.mpesaTill) {
    errorBox.textContent = 'M-Pesa is not available right now. Please choose another payment method.';
    return;
  }

  button.disabled = true;
  errorBox.textContent = '';

  /* No Firebase: the order only goes to WhatsApp */
  if (!configured) {
    showOrderDone(order, false);
    return;
  }

  firestore
    .addDoc(firestore.collection(db, 'orders'), {
      orderNo: order.id,
      customer: order.customer,
      items: order.items,
      subtotal: order.subtotal,
      delivery: order.delivery,
      total: order.total,
      payment: order.payment,
      status: 'new',
      uid: user ? user.uid : null,
      email: user ? user.email : null,
      createdAt: firestore.serverTimestamp(),
    })
    .then(() => showOrderDone(order, true))
    .catch((err) => {
      console.error('Order could not be saved to Firestore', err);
      showOrderDone(order, false);
    });
}


/* 10. M-Pesa details and order confirmation
   -------------------------------------------------------------------------- */

const PAYMENT_NAMES = { mpesa: 'M-Pesa', card: 'Card', cod: 'Cash on delivery' };

const isPaybill = () => /pay/i.test(S.mpesaType || '');
const customAccountNumber = () => String(S.mpesaAccount || '').trim();

/* Paybill account number: the one set in admin, otherwise the order number */
const mpesaAccount = (orderId) => customAccountNumber() || orderId || '';

/* Short line under the M-Pesa option at checkout */
function mpesaLine() {
  if (!isPaybill()) {
    return `Till number <strong>${esc(S.mpesaTill)}</strong>. Then confirm on WhatsApp.`;
  }
  const account = customAccountNumber();
  const accountText = account
    ? `<strong>${esc(account)}</strong>`
    : 'is your order number, shown after you place the order';
  return `Paybill <strong>${esc(S.mpesaTill)}</strong>, account number ${accountText}. Then confirm on WhatsApp.`;
}

/* Full instructions on the order confirmation */
function mpesaSteps(order) {
  const amount = `<strong>${kes(order.total)}</strong>`;
  const finish = 'Then send the M-Pesa confirmation message in the WhatsApp chat.';

  if (!isPaybill()) {
    return `Open M-Pesa, choose <strong>Lipa na M-Pesa</strong> then <strong>Buy Goods and Services</strong>.<br>
      Till number: <strong>${esc(S.mpesaTill)}</strong><br>
      Amount: ${amount}<br>${finish}`;
  }
  return `Open M-Pesa, choose <strong>Lipa na M-Pesa</strong> then <strong>Paybill</strong>.<br>
    Business number: <strong>${esc(S.mpesaTill)}</strong><br>
    Account number: <strong>${esc(mpesaAccount(order.id))}</strong><br>
    Amount: ${amount}<br>${finish}`;
}

/* The WhatsApp message the customer sends to place the order */
function orderMessage(order) {
  const lines = order.items.map((l) => `${l.qty} x ${l.name} - ${kes(l.price * l.qty)}`).join('\n');

  let payment = PAYMENT_NAMES[order.payment];
  if (order.payment === 'mpesa') {
    payment += isPaybill()
      ? ` (Paybill ${S.mpesaTill}, Acc ${mpesaAccount(order.id)})`
      : ` (Till ${S.mpesaTill})`;
  }

  return [
    `New order ${order.id} - ${S.shopName}`,
    '',
    lines,
    '',
    `Delivery: ${order.delivery ? kes(order.delivery) : 'Free'}`,
    `Total: ${kes(order.total)}`,
    `Payment: ${payment}`,
    '',
    `Name: ${order.customer.name}`,
    `Phone: ${order.customer.phone}`,
    `Email: ${order.customer.email}`,
    `Address: ${order.customer.address}`,
  ].join('\n');
}

function paymentInstructions(order) {
  if (order.payment === 'mpesa') return mpesaSteps(order);
  if (order.payment === 'card') {
    return `We will reply on WhatsApp with a secure card payment link for <strong>${kes(order.total)}</strong>.`;
  }
  return `Keep <strong>${kes(order.total)}</strong> ready. You pay the rider on delivery.`;
}

function showOrderDone(order, saved) {
  recordOrder(order);

  const firstName = esc(order.customer.name.split(' ')[0]);
  const statusText = saved
    ? 'is saved.'
    : 'could NOT be saved online. It only reaches us when you send it on WhatsApp below, so please do that now.';
  const waUrl = whatsappUrl(orderMessage(order));

  doneHTML = `
    <div class="done">
      <h3>Thank you, ${firstName}</h3>
      <p>Your order <strong>${esc(order.id)}</strong> ${statusText} Send it on WhatsApp so we can confirm and dispatch.</p>
      <a class="btn" style="justify-content:center;width:100%" href="${waUrl}" target="_blank" rel="noopener">Send order on WhatsApp</a>
      <button class="btn ghost" style="width:100%" data-copy="${esc(order.id)}">Copy order number</button>
      <div class="note">${paymentInstructions(order)}</div>
    </div>`;

  cart = {};
  saveCart();
  updateCount();
  stage = 'done';
  renderDrawer();
}


/* 11. Customer account: sign in, profile sync
   -------------------------------------------------------------------------- */

function updateAccountLink() {
  const link = document.querySelector('.nav [data-account], .nav a[href="#account"]');
  if (!link) return;

  link.textContent = 'Account'; /* label stays the same, signed in or not */
  if (user) link.title = 'Signed in as ' + (user.displayName || user.email || '');
  else link.removeAttribute('title');
}

/* The shop admin (an email listed in firestore.rules) goes to the admin
   dashboard, not the customer account. */
/* Which door the person chose on the sign-in screen ('customer' or 'admin') */
function getRole() {
  try { return sessionStorage.getItem('aps_role') || ''; } catch (e) { return ''; }
}
function setRole(role) {
  try { sessionStorage.setItem('aps_role', role); } catch (e) {}
}

/* The page never contains the admin emails. Instead we ask Firestore: only an admin is allowed to
   read the 'admin_check' probe (see firestore.rules), everyone else is refused. */
let adminUid = '';

async function refreshAdmin(u) {
  adminUid = '';
  if (!u || !firestore || !db) return;
  try {
    await firestore.getDoc(firestore.doc(db, 'admin_check', 'ping'));
    adminUid = u.uid;
  } catch (e) {
    /* permission denied: not an admin */
  }
}

function isAdmin(u) {
  return !!(u && adminUid && u.uid === adminUid);
}

function goAdmin() {
  toast('Opening the shop admin...');
  closeAcct();
  setTimeout(() => {
    location.href = ADMIN_URL;
  }, 400);
}

/* Keep a profile for every account in Firestore (users/{uid}) so the admin can see and
   manage them. The customer's saved addresses, orders and preferences are stored there
   too, so they follow the customer to any device. */
let syncWarned = false;

function warnSync(e) {
  if (syncWarned) return;
  syncWarned = true;
  console.error(
    `[Shop] Could not read/write the profile in Firestore (${(e && (e.code || e.message)) || e}). ` +
      'Check your Firestore rules: paste firestore.rules into Firebase console > Firestore > Rules.'
  );
}

/* Returns false if the account is blocked (and signs the customer out) */
async function syncUser(u, nameHint) {
  if (!u || !firestore || !db) return true;

  await refreshAdmin(u);
  const ref = firestore.doc(db, 'users', u.uid);
  let data = null;
  try {
    const snap = await firestore.getDoc(ref);
    data = snap.exists() ? snap.data() : null;
  } catch (e) {
    warnSync(e);
  }

  /* the admin blocked this account */
  if (data && data.blocked && !isAdmin(u)) {
    try {
      await authLib.signOut(auth);
    } catch (e) {}
    user = null;
    updateAccountLink();
    closeAcct();
    toast('This account has been blocked. Please contact the shop.');
    return false;
  }

  /* repair a missing username */
  const name = u.displayName || nameHint || (data && data.name) || '';
  if (name && !u.displayName) {
    try {
      await authLib.updateProfile(u, { displayName: name });
    } catch (e) {}
  }

  /* one profile write per visit, not one per page change */
  const seenKey = 'aps_seen_' + u.uid;
  let firstThisVisit = true;
  try {
    firstThisVisit = !sessionStorage.getItem(seenKey);
    sessionStorage.setItem(seenKey, '1');
  } catch (e) {}

  if (firstThisVisit || !data) {
    const profile = { email: u.email || '', lastLogin: firestore.serverTimestamp() };
    if (name) profile.name = name;
    if (!data) {
      const created = u.metadata && u.metadata.creationTime;
      profile.createdAt = (created ? new Date(created) : new Date()).toISOString();
    }
    try {
      await firestore.setDoc(ref, profile, { merge: true });
    } catch (e) {
      warnSync(e);
    }
  }

  pullAcc(data);
  return true;
}

/* Merge the account data saved in the cloud with this device's copy
   (orders are joined by order number). */
function pullAcc(data) {
  if (!user) return;

  const local = getAcc();
  const remote = data && data.acct;

  if (!remote) {
    const hasLocalData =
      local.orders.length || local.addresses.length || Object.keys(local.prefs).length || local.phone;
    if (hasLocalData) saveCloud();
    return;
  }

  const seen = {};
  const orders = [...(remote.orders || []), ...local.orders]
    .filter((o) => {
      if (!o || seen[o.id]) return false;
      seen[o.id] = 1;
      return true;
    })
    .sort((x, y) => String(y.date).localeCompare(String(x.date)))
    .slice(0, 30);

  const merged = {
    ...local,
    ...remote,
    orders,
    addresses: remote.addresses && remote.addresses.length ? remote.addresses : local.addresses,
    prefs: { ...local.prefs, ...(remote.prefs || {}) },
  };
  writeJSON(accKey(), merged);

  /* refresh the open profile screen, unless the customer is typing in a form */
  const dialog = $('#acct');
  if (dialog && dialog.open && acctMode === 'profile' && !document.activeElement.closest('form')) {
    renderAcct();
  }
}

let cloudTimer = null;

function saveCloud() {
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    if (!user || !firestore || !db) return;

    let data;
    try {
      data = JSON.parse(JSON.stringify(getAcc())); /* drops undefined values */
    } catch (e) {
      return;
    }
    firestore
      .setDoc(firestore.doc(db, 'users', user.uid), { acct: data }, { merge: true })
      .catch(warnSync);
  }, 600);
}

function authError(e) {
  const messages = {
    'auth/email-already-in-use': 'That email is already registered. Try signing in instead.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/weak-password': 'Choose a stronger password (at least 10 characters, with letters and numbers).',
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/user-not-found': 'Wrong email or password.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    'auth/network-request-failed': 'No internet connection. Please try again when you are online.',
    'auth/operation-not-allowed':
      'Sign-in is not switched on yet. In Firebase console > Authentication > Sign-in method, enable Email/Password.',
    'auth/user-disabled': 'This account has been disabled. Please contact the shop.',
  };
  if (e) console.error('[Shop] Sign-in error:', e.code || e);
  return messages[e && e.code] || `Something went wrong (${(e && e.code) || 'unknown'}). Please try again.`;
}

/* Register or sign in, depending on acctMode */
async function submitAcct() {
  const errorBox = $('#aerr');
  const button = $('#abtn');
  const email = $('#ae').value.trim();
  const password = $('#ap').value;
  const registering = acctMode === 'register';
  const roleInput = document.querySelector('input[name="arole"]:checked');
  const asAdmin = !registering && !!roleInput && roleInput.value === 'admin';
  let name = '';

  errorBox.textContent = '';

  if (registering) {
    name = $('#au').value.trim();
    if (name.length < 2) {
      errorBox.textContent = 'Enter a username (at least 2 characters).';
      return;
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errorBox.textContent = 'Enter a valid email address.';
    return;
  }
  if (registering && (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password))) {
    errorBox.textContent = 'Use at least 10 characters, with letters and numbers.';
    return;
  }
  if (!password) {
    errorBox.textContent = 'Enter your password.';
    return;
  }
  if (registering && $('#ap2') && $('#ap2').value !== password) {
    errorBox.textContent = 'The two passwords do not match. Please check them.';
    return;
  }

  if (lockLeft('shop') > 0) {
    runCountdown('shop', '#aerr', '#abtn');
    return;
  }

  button.disabled = true;
  try {
    if (registering) {
      const credential = await authLib.createUserWithEmailAndPassword(auth, email, password);
      try {
        /* the account exists even if this fails; the name is repaired on next sign-in */
        await authLib.updateProfile(credential.user, { displayName: name });
      } catch (e) {}
    } else {
      await authLib.signInWithEmailAndPassword(auth, email, password);
    }
    resetFails('shop');

    user = auth.currentUser;
    updateAccountLink();

    if ((await syncUser(user, name)) === false) {
      button.disabled = false;
      return;
    }
    if (asAdmin) {
      if (!isAdmin(user)) {
        /* a customer picked "Admin": sign them out again and explain */
        try {
          await authLib.signOut(auth);
        } catch (e) {}
        user = null;
        updateAccountLink();
        errorBox.textContent = 'These details do not belong to an admin account. Choose Customer to sign in as a customer.';
        button.disabled = false;
        return;
      }
      setRole('admin');
      goAdmin();
      return;
    }
    setRole('customer');

    acctMode = 'profile';
    acctTab = 'dash';
    renderAcct(name ? `Welcome, ${name}! Your account is ready.` : 'You are signed in.');
  } catch (e) {
    if (/credential|password|user-not-found/.test((e && e.code) || '')) recordFail('shop');
    errorBox.textContent = authError(e);
    button.disabled = false;
    if (lockLeft('shop') > 0) runCountdown('shop', '#aerr', '#abtn');
  }
}


/* 12. Account window: forms and hub
   -------------------------------------------------------------------------- */

const ACCT_TABS = [
  ['dash', 'Dashboard'],
  ['orders', 'Orders'],
  ['profile', 'Profile'],
  ['addr', 'Addresses'],
  ['pay', 'Payment'],
  ['wish', 'Wishlist'],
  ['prefs', 'Preferences'],
];
const ACCT_PAYMENT_NAMES = { mpesa: 'M-Pesa', card: 'Card (secure link)', cod: 'Cash on delivery' };
const AREA_NAMES = { nairobi: 'Nairobi and surroundings', other: 'Other town in Kenya' };

/* Eye icons for the password fields (inline SVG, so they work offline) */
const ICON_ATTRS =
  'viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const EYE = `<svg ${ICON_ATTRS}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF = `<svg ${ICON_ATTRS}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

/* ----- open and close ----- */

function ensureAcctDialog() {
  if ($('#acct')) return;

  const dialog = document.createElement('dialog');
  dialog.className = 'acct';
  dialog.id = 'acct';
  dialog.setAttribute('aria-labelledby', 'acctTitle');

  /* put the menu highlight back where it was */
  dialog.addEventListener('close', () => {
    const link = document.querySelector('.nav a[href="#account"]');
    if (link) link.classList.remove('on');
    if (prevOn && prevOn !== link) prevOn.classList.add('on');
    prevOn = null;
  });
  document.body.appendChild(dialog);
}

function openAcct() {
  ensureAcctDialog();

  const link = document.querySelector('.nav a[href="#account"]');
  if (link) {
    prevOn = document.querySelector('.nav a.on');
    if (prevOn) prevOn.classList.remove('on');
    link.classList.add('on');
  }

  acctMode = user ? 'profile' : 'register';
  acctTab = 'dash';
  renderAcct();

  const dialog = $('#acct');
  if (!dialog.open) dialog.showModal();
}

function closeAcct() {
  const dialog = $('#acct');
  if (dialog && dialog.open) dialog.close();
}

/* ----- sign in / register screens ----- */

function passwordField(id, autocomplete) {
  return `
    <span class="pw">
      <input class="field" id="${id}" type="password" autocomplete="${autocomplete}">
      <button type="button" class="pw-eye" data-eye="${id}" aria-label="Show password" aria-pressed="false">${EYE}</button>
    </span>`;
}

function loginHTML() {
  return `
    <h2 id="acctTitle">Sign in</h2>
    <form id="acctForm" novalidate>
      <div class="role" role="radiogroup" aria-label="Sign in as">
        <label><input type="radio" name="arole" value="customer" checked><span>Customer</span></label>
        <label><input type="radio" name="arole" value="admin"><span>Admin</span></label>
      </div>
      <label for="ae">Email</label>
      <input class="field" id="ae" type="email" autocomplete="username">
      <label for="ap">Password</label>
      ${passwordField('ap', 'current-password')}
      <div class="err" id="aerr" role="alert"></div>
      <button class="btn" type="submit" id="abtn" style="width:100%;margin-top:12px">Sign in</button>
    </form>
    <p class="acct-sw">New here? <button type="button" data-amode="register">Create an account</button></p>`;
}

function registerHTML() {
  return `
    <h2 id="acctTitle">Create your account</h2>
    <p class="acct-sub">Register to keep your details with us.</p>
    <form id="acctForm" novalidate>
      <label for="au">Username</label>
      <input class="field" id="au" autocomplete="username" maxlength="30">
      <label for="ae">Email</label>
      <input class="field" id="ae" type="email" autocomplete="email">
      <label for="ap">Password</label>
      ${passwordField('ap', 'new-password')}
      <small class="acct-sub">At least 10 characters, with letters and numbers.</small>
      <label for="ap2">Confirm password</label>
      ${passwordField('ap2', 'new-password')}
      <small class="pw-match" id="pwm" aria-live="polite"></small>
      <div class="err" id="aerr" role="alert"></div>
      <button class="btn" type="submit" id="abtn" style="width:100%;margin-top:12px">Create account</button>
    </form>
    <p class="acct-sw">Already have an account? <button type="button" data-amode="login">Sign in</button></p>`;
}

function authScreenHTML() {
  if (!auth) {
    return `<h2 id="acctTitle">Account</h2>
      <p class="acct-sub">Accounts need an internet connection. Please connect and reload the page.</p>`;
  }
  return acctMode === 'login' ? loginHTML() : registerHTML();
}

/* ----- signed-in hub ----- */

function hubHTML(message) {
  const tabs = ACCT_TABS.map(
    ([key, label]) =>
      `<button type="button" data-a="tab" data-v="${key}"${key === acctTab ? ' aria-current="true"' : ''}>${label}</button>`
  ).join('');
  const notice = message ? `<div class="acct-ok" role="status">${esc(message)}</div>` : '';

  return `
    <h2 id="acctTitle" class="acct-title">My account</h2>
    <div class="acct-hub">
      <nav class="acct-nav" aria-label="Account sections">
        ${tabs}
        ${isAdmin(user) ? `<a class="acct-out" href="${ADMIN_URL}">Open admin page</a>` : ''}
        <button type="button" class="acct-out" data-alogout="1">Sign out</button>
      </nav>
      <div class="acct-pane">${notice}${paneHTML()}</div>
    </div>`;
}

function renderAcct(message) {
  const showHub = !!(auth && acctMode === 'profile' && user);
  const closeButton =
    '<button class="acct-x" type="button" data-aclose="1" aria-label="Close">&times;</button>';
  const dialog = $('#acct');

  dialog.innerHTML = showHub
    ? closeButton + hubHTML(message)
    : closeButton + `<div class="acct-card">${authScreenHTML()}</div>`; /* full screen, form centred */

  dialog.classList.toggle('wide', showHub);
  dialog.classList.toggle('full', !showHub);

  /* sign in / register form: carry on any wait that is still running (e.g. after a page refresh) */
  if (!showHub && auth) resumeCountdown('shop', '#aerr', '#abtn');
}

/* ----- account data (kept on this device, and synced to Firestore when signed in) -----
   Orders, addresses, payment choice and preferences are stored per signed-in user.
   Card numbers are never collected or stored. */

const accKey = () => 'aps_acct_' + (user ? user.uid : 'x');

function getAcc() {
  const a = readJSON(accKey(), {});
  a.addresses = a.addresses || [];
  a.orders = a.orders || [];
  a.prefs = a.prefs || {};
  return a;
}

function putAcc(a) {
  writeJSON(accKey(), a);
  saveCloud();
}

function dateStr(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) {
    return '';
  }
}

function recordOrder(order) {
  if (!user) return;
  const a = getAcc();
  a.orders.unshift({
    id: order.id,
    date: new Date().toISOString(),
    items: order.items,
    total: order.total,
    payment: order.payment,
  });
  a.orders = a.orders.slice(0, 30);
  putAcc(a);
}

/* Fill the checkout form from the customer's saved details */
function prefillCheckout() {
  if (!user) return;

  const a = getAcc();
  const address = a.addresses.find((x) => x.id === a.defaultAddr) || a.addresses[0] || {};
  const fill = (selector, value) => {
    const el = $(selector);
    if (el && value) el.value = value;
  };

  fill('#fn', user.displayName);
  fill('#ph', a.mpesaPhone || a.phone);
  fill('#em', user.email);
  fill('#area', address.area);
  fill('#ad', address.address);

  const payment = a.payPref && document.querySelector(`input[name="pm"][value="${a.payPref}"]`);
  if (payment) payment.checked = true;
}

/* ----- order history: the customer's own orders from Firestore (live status) ----- */

let myOrders = [];
let ordersUnsub = null;

function stopOrders() {
  if (ordersUnsub) {
    try {
      ordersUnsub();
    } catch (e) {}
  }
  ordersUnsub = null;
  myOrders = [];
}

function watchOrders() {
  stopOrders();
  if (!user || !firestore || !db) return;

  const uid = user.uid;
  try {
    const q = firestore.query(firestore.collection(db, 'orders'), firestore.where('uid', '==', uid));

    ordersUnsub = firestore.onSnapshot(
      q,
      (snap) => {
        if (!user || user.uid !== uid) return;

        myOrders = snap.docs.map((d) => {
          const x = d.data({ serverTimestamps: 'estimate' });
          const date = x.createdAt && x.createdAt.toDate ? x.createdAt.toDate() : new Date();
          return {
            id: x.orderNo || d.id,
            date: date.toISOString(),
            items: x.items || [],
            total: x.total,
            payment: x.payment,
            status: x.status || 'new',
          };
        });

        /* status changes show up live */
        const dialog = $('#acct');
        const onOrderScreen = acctTab === 'orders' || acctTab === 'dash';
        if (dialog && dialog.open && acctMode === 'profile' && onOrderScreen) renderAcct();
      },
      warnSync
    );
  } catch (e) {
    warnSync(e);
  }
}

/* Orders from Firestore (with payment status) plus any saved on this device,
   newest first, no duplicates. */
function allOrders(a) {
  const seen = {};
  const list = [];

  [...myOrders, ...((a && a.orders) || [])].forEach((o) => {
    if (!o || seen[o.id]) return;
    seen[o.id] = 1;
    list.push(o);
  });
  return list.sort((x, y) => String(y.date).localeCompare(String(x.date)));
}

function statusChip(o) {
  if (!o.status) return '';
  const labels = {
    new: o.payment === 'cod' ? 'Order received' : 'Awaiting payment',
    paid: 'Paid',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  };
  return `<span class="ao-st ${esc(o.status)}">${esc(labels[o.status] || o.status)}</span> `;
}

/* ----- hub panes: one function per tab ----- */

function dashPane(a, orders) {
  const last = orders[0];
  const lastOrderText = last
    ? `Your last order was <strong>#${esc(last.id)}</strong> on ${esc(dateStr(last.date))}.`
    : 'You have not placed an order yet.';

  return `
    <h3>Welcome, ${esc(user.displayName || 'there')}</h3>
    <p class="acct-sub">${lastOrderText}</p>
    <div class="acct-stats">
      <div><b>${orders.length}</b><span>Orders</span></div>
      <div><b>${favCount()}</b><span>Saved items</span></div>
      <div><b>${totalQty()}</b><span>In cart</span></div>
    </div>
    <div class="acct-quick">
      <button class="btn" type="button" data-aclose="1">Continue shopping</button>
      <button class="btn ghost" type="button" data-a="tab" data-v="orders">View orders</button>
      <button class="btn ghost" type="button" data-a="tab" data-v="profile">Update profile</button>
    </div>`;
}

function orderCardHTML(o) {
  const items = o.items
    .map(
      (l) => `
        <li>
          <span class="ao-q">${esc(l.qty)}&times;</span>
          <span class="ao-n">${esc(l.name)}</span>
          <span class="ao-p">${kes(l.price * l.qty)}</span>
        </li>`
    )
    .join('');

  return `
    <div class="ao">
      <div class="ao-h">
        <strong>#${esc(o.id)}</strong>
        <span class="ao-pay">${statusChip(o)}${esc(ACCT_PAYMENT_NAMES[o.payment] || '')}</span>
      </div>
      <div class="ao-d">${esc(dateStr(o.date))}</div>
      <ul class="ao-i">${items}</ul>
      <div class="ao-f">
        <span class="ao-t"><small>Total</small> ${kes(o.total)}</span>
        <button class="btn ghost" type="button" data-a="reorder" data-v="${esc(o.id)}">Order again</button>
      </div>
    </div>`;
}

function ordersPane(a, orders) {
  const cards = orders.map(orderCardHTML).join('');
  return `
    <h3>Orders</h3>
    ${cards || '<p class="acct-sub">No orders yet. Your next order will show up here.</p>'}
    <p class="acct-note">Order history is saved to your account.</p>`;
}

function profilePane(a) {
  return `
    <h3>Profile</h3>
    <form id="acctProfile" novalidate>
      <label for="pu">Username</label>
      <input class="field" id="pu" maxlength="30" value="${esc(user.displayName || '')}">
      <label for="pe">Email</label>
      <input class="field" id="pe" value="${esc(user.email)}" disabled>
      <label for="pph">Phone number</label>
      <input class="field" id="pph" type="tel" placeholder="0712 345 678" value="${esc(a.phone || '')}">
      <div class="err" id="aerr" role="alert"></div>
      <button class="btn" type="submit" style="margin-top:12px">Save changes</button>
    </form>
    <h3 style="margin-top:24px">Password</h3>
    <p class="acct-sub">We will email you a link to choose a new password.</p>
    <button class="btn ghost" type="button" data-a="reset" style="margin-top:8px">Send reset email</button>`;
}

function addressRowHTML(address, a) {
  const isDefault = address.id === a.defaultAddr || (!a.defaultAddr && address === a.addresses[0]);
  const id = esc(address.id);
  const makeDefault = isDefault
    ? ''
    : `<button class="linkb" type="button" data-a="adefault" data-v="${id}">Make default</button>`;

  return `
    <div class="aa">
      <div>
        <strong>${esc(address.label)}</strong>${isDefault ? ' <span class="tagd">Default</span>' : ''}<br>
        <small>${esc(AREA_NAMES[address.area] || '')} &middot; ${esc(address.address)}</small>
      </div>
      <div class="aa-b">
        ${makeDefault}
        <button class="link" type="button" data-a="adel" data-v="${id}">Remove</button>
      </div>
    </div>`;
}

function addressesPane(a) {
  const rows = a.addresses.map((address) => addressRowHTML(address, a)).join('');
  return `
    <h3>Addresses</h3>
    ${rows || '<p class="acct-sub">No saved addresses yet.</p>'}
    <h3 style="margin-top:20px">Add an address</h3>
    <form id="acctAddr" novalidate>
      <label for="al">Name (Home, Work...)</label>
      <input class="field" id="al" maxlength="30">
      <label for="aar">Delivery area</label>
      <select class="field" id="aar">
        <option value="nairobi">Nairobi and surroundings</option>
        <option value="other">Other town in Kenya</option>
      </select>
      <label for="aad">Address or landmark</label>
      <textarea class="field" id="aad" rows="2" maxlength="200"></textarea>
      <div class="err" id="aerr" role="alert"></div>
      <button class="btn" type="submit" style="margin-top:12px">Save address</button>
    </form>
    <p class="acct-note">Your default address fills in at checkout. Saved on this device.</p>`;
}

function paymentPane(a) {
  const preferred = a.payPref || 'mpesa';
  const options = ['mpesa', 'card', 'cod']
    .map(
      (key) => `
        <label>
          <input type="radio" name="pp" value="${key}"${preferred === key ? ' checked' : ''}>
          <span><strong>${ACCT_PAYMENT_NAMES[key]}</strong></span>
        </label>`
    )
    .join('');

  return `
    <h3>Payment</h3>
    <p class="acct-sub">Choose how you usually pay. It is selected for you at checkout.</p>
    <form id="acctPay" novalidate>
      <div class="pay">${options}</div>
      <label for="pmp">M-Pesa phone number</label>
      <input class="field" id="pmp" type="tel" placeholder="0712 345 678" value="${esc(a.mpesaPhone || '')}">
      <div class="err" id="aerr" role="alert"></div>
      <button class="btn" type="submit" style="margin-top:12px">Save</button>
    </form>
    <p class="acct-note">We never collect or store card numbers. Card payments use a secure link we send on WhatsApp.</p>`;
}

function wishlistRowHTML(p) {
  const id = esc(p.id);
  const addButton =
    p.inStock === false ? '' : `<button class="btn" type="button" data-a="wadd" data-v="${id}">Add</button>`;

  return `
    <div class="aw">
      <div class="mini" aria-hidden="true">${art(p)}</div>
      <div><strong>${esc(p.name)}</strong><br><small>${kes(p.price)}</small></div>
      <div class="aa-b">
        <button class="btn ghost" type="button" data-a="wopen" data-v="${id}">View</button>
        ${addButton}
        <button class="link" type="button" data-a="wrm" data-v="${id}">Remove</button>
      </div>
    </div>`;
}

function wishlistPane() {
  const saved = Object.keys(favs).map(find).filter(Boolean);
  return `
    <h3>Wishlist</h3>
    ${
      saved.length
        ? saved.map(wishlistRowHTML).join('')
        : '<p class="acct-sub">Nothing saved yet. Tap the heart on a product to save it here.</p>'
    }`;
}

function prefsPane(a) {
  return `
    <h3>Preferences</h3>
    <form id="acctPrefs" novalidate>
      <label class="acct-chk"><input type="checkbox" id="pn"${a.prefs.news ? ' checked' : ''}> Email me new snacks and offers</label>
      <label class="acct-chk"><input type="checkbox" id="pw2"${a.prefs.wa ? ' checked' : ''}> Send me offers on WhatsApp or SMS</label>
      <button class="btn" type="submit" style="margin-top:12px">Save preferences</button>
    </form>
    <p class="acct-note">Saved on this device.</p>`;
}

const PANES = {
  orders: ordersPane,
  profile: profilePane,
  addr: addressesPane,
  pay: paymentPane,
  wish: wishlistPane,
  prefs: prefsPane,
};

function paneHTML() {
  const a = getAcc();
  const render = PANES[acctTab] || dashPane;
  return render(a, allOrders(a));
}

/* ----- saving from the account forms ----- */

async function saveProfile() {
  const errorBox = $('#aerr');
  const name = $('#pu').value.trim();
  const phone = $('#pph').value.trim();

  if (name.length < 2) {
    errorBox.textContent = 'Enter a username (at least 2 characters).';
    return;
  }
  if (phone && phone.replace(/\D/g, '').length < 9) {
    errorBox.textContent = 'Enter a valid phone number.';
    return;
  }

  try {
    await authLib.updateProfile(user, { displayName: name });
  } catch (e) {
    errorBox.textContent = authError(e);
    return;
  }

  user = auth.currentUser;
  updateAccountLink();

  const a = getAcc();
  a.phone = phone;
  putAcc(a);
  renderAcct('Profile saved.');
}

function saveAddress() {
  const errorBox = $('#aerr');
  const a = getAcc();
  const address = $('#aad').value.trim();

  if (address.length < 5) {
    errorBox.textContent = 'Enter the address or a landmark.';
    return;
  }
  if (a.addresses.length >= 5) {
    errorBox.textContent = 'You can save up to 5 addresses. Remove one first.';
    return;
  }

  const entry = {
    id: String(Date.now()),
    label: $('#al').value.trim() || 'Address ' + (a.addresses.length + 1),
    area: $('#aar').value,
    address,
  };
  a.addresses.push(entry);
  if (!a.defaultAddr) a.defaultAddr = entry.id;

  putAcc(a);
  renderAcct('Address saved.');
}

function savePayment() {
  const a = getAcc();
  const chosen = document.querySelector('input[name="pp"]:checked');
  a.payPref = chosen ? chosen.value : 'mpesa';
  a.mpesaPhone = $('#pmp').value.trim().slice(0, 20);
  putAcc(a);
  renderAcct('Payment choice saved.');
}

function savePrefs() {
  const a = getAcc();
  a.prefs = { news: $('#pn').checked, wa: $('#pw2').checked };
  putAcc(a);
  renderAcct('Preferences saved.');
}

/* Buttons inside the hub (data-a="...", data-v="...") */
function acctAction(action, value) {
  const a = getAcc();

  switch (action) {
    case 'tab':
      acctTab = value;
      renderAcct();
      break;

    case 'reorder': {
      const order = allOrders(a).find((x) => x.id === value);
      if (!order) return;

      let added = 0;
      order.items.forEach((line) => {
        if (find(line.id)) {
          addToCart(line.id, line.qty);
          added++;
        }
      });

      closeAcct();
      if (added) {
        toast('Added your items to the cart', 'View cart', openDrawer);
        openDrawer();
      } else {
        toast('Those products are no longer available');
      }
      break;
    }

    case 'reset':
      authLib.sendPasswordResetEmail(auth, user.email).then(
        () => renderAcct('Reset email sent to ' + user.email + '.'),
        (e) => renderAcct(authError(e))
      );
      break;

    case 'adefault':
      a.defaultAddr = value;
      putAcc(a);
      renderAcct('Default address updated.');
      break;

    case 'adel':
      a.addresses = a.addresses.filter((x) => x.id !== value);
      if (a.defaultAddr === value) a.defaultAddr = '';
      putAcc(a);
      renderAcct('Address removed.');
      break;

    case 'wopen':
      closeAcct();
      openDetails(value);
      break;

    case 'wadd':
      addToCart(value, 1);
      renderAcct('Added to your cart.');
      break;

    case 'wrm':
      toggleFav(value);
      renderAcct();
      break;
  }
}

/* Live "passwords match" message on the register form */
function checkPasswordMatch() {
  const password = $('#ap');
  const confirm = $('#ap2');
  const message = $('#pwm');
  if (!password || !confirm || !message) return;

  if (!confirm.value) {
    message.textContent = '';
    message.className = 'pw-match';
    return;
  }
  const match = password.value === confirm.value;
  message.textContent = match ? '\u2713 Passwords match' : 'Passwords do not match yet';
  message.className = 'pw-match ' + (match ? 'ok' : 'no');
}

/* Show / hide password */
function togglePasswordVisibility(button) {
  const input = document.getElementById(button.dataset.eye);
  if (!input) return;

  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  button.innerHTML = show ? EYE_OFF : EYE;
  button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  button.setAttribute('aria-pressed', show ? 'true' : 'false');
  input.focus();
}


/* 13. Mobile menu and scroll effects
   -------------------------------------------------------------------------- */

function closeMenu() {
  nav.classList.remove('open');
  menuBtn.setAttribute('aria-expanded', 'false');
}

/* Fade-in when scrolled into view */
const revealObserver = REVEAL
  ? new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('in');
          revealObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.12 }
    )
  : null;

function observeReveals() {
  if (!revealObserver) return;
  document.querySelectorAll('.rv:not(.in)').forEach((el) => revealObserver.observe(el));
}

/* Highlight the menu link of the section being viewed: [section, link it highlights] */
const SPY_SECTIONS = [
  ['.hero', '#top'],
  ['#shop', '#shop'],
  ['#how', '#shop'],
  ['#about', '#about'],
  ['#faq', '#faq'],
  ['#contact', '#contact'],
];

function scrollEffects() {
  if (REVEAL) {
    document
      .querySelectorAll('.steps li, .about .cols > div, .sec, .faq details')
      .forEach((el) => el.classList.add('rv'));
  }
  observeReveals();

  if (!('IntersectionObserver' in window)) return;

  const spy = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        document.querySelectorAll('.nav a').forEach((link) => {
          link.classList.toggle('on', link.getAttribute('href') === entry.target.dataset.spy);
        });
      });
    },
    { rootMargin: '-45% 0px -50% 0px' }
  );

  SPY_SECTIONS.forEach(([selector, link]) => {
    const section = $(selector);
    if (section) {
      section.dataset.spy = link;
      spy.observe(section);
    }
  });
}


/* 14. Event listeners
   -------------------------------------------------------------------------- */

/* ----- logo and "Home": close anything that is open and go back to the top -----
   (A plain #top link does not scroll back up, because the header sticks to the top.) */
document.addEventListener('click', (e) => {
  if (!e.target.closest('#logo, .nav a[href="#top"]')) return;
  e.preventDefault();

  closeMenu();
  closeDrawer();
  closeDetails();
  closeAcct();

  const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' });
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch (err) {}
});

/* ----- shop: categories, products, cart, details window ----- */

function addFromCard(button, id) {
  const p = find(id);
  addToCart(id, 1);

  const label = button.textContent;
  button.textContent = 'Added';
  setTimeout(() => {
    button.textContent = label;
  }, 900);

  toast(`Added ${p.name} to your cart`, 'View cart', openDrawer);
}

function addFromDetails() {
  const p = find(pdId);
  addToCart(pdId, pdQty);
  closeDetails();
  toast(`Added ${pdQty} x ${p.name} to your cart`, 'View cart', openDrawer);
}

function changeCartQty(id, change) {
  cart[id] = Math.max(0, Math.min(MAX_QTY, cart[id] + change));
  saveCart();
  updateCount();
  renderDrawer();
}

function copyOrderNumber(orderNo) {
  if (!navigator.clipboard) return;
  navigator.clipboard.writeText(orderNo).then(
    () => toast(`Order number ${orderNo} copied`),
    () => {}
  );
}

function resetFilters() {
  cat = 'All';
  query = '';
  $('#q').value = '';
  renderChips();
  renderGrid();
}

document.addEventListener('click', (e) => {
  /* toast action button (e.g. "View cart") */
  if (e.target.id === 'toastAct') {
    const action = toastFn;
    $('#toast').classList.remove('on');
    if (action) action();
    return;
  }

  /* click outside the open mobile menu */
  if (nav.classList.contains('open') && !e.target.closest('header')) closeMenu();

  /* click on the dark backdrop of the details window */
  if (e.target === $('#pd')) {
    closeDetails();
    return;
  }

  const target = e.target.closest(
    '[data-cat],[data-add],[data-inc],[data-dec],[data-rm],[data-go],[data-open],[data-fav],' +
      '[data-close],[data-pdinc],[data-pddec],[data-pdadd],[data-copy],[data-reset]'
  );
  if (!target) return;
  const d = target.dataset;

  if (d.cat) {
    cat = d.cat;
    renderChips();
    renderGrid();
  } else if (d.reset) resetFilters();
  else if (d.open) openDetails(d.open);
  else if (d.fav) toggleFav(d.fav);
  else if (d.close) closeDetails();
  else if (d.pdinc) {
    pdQty = Math.min(MAX_QTY, pdQty + 1);
    $('#pdQty').textContent = pdQty;
  } else if (d.pddec) {
    pdQty = Math.max(1, pdQty - 1);
    $('#pdQty').textContent = pdQty;
  } else if (d.pdadd) addFromDetails();
  else if (d.add) addFromCard(target, d.add);
  else if (d.inc) changeCartQty(d.inc, +1);
  else if (d.dec) changeCartQty(d.dec, -1);
  else if (d.rm) {
    delete cart[d.rm];
    saveCart();
    updateCount();
    renderDrawer();
  } else if (d.copy) copyOrderNumber(d.copy);
  else if (d.go === 'checkout') {
    stage = 'checkout';
    renderDrawer();
  } else if (d.go === 'cart') {
    stage = 'cart';
    renderDrawer();
  } else if (d.go === 'place') placeOrder();
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'area') updateSummary();
});

$('#q').addEventListener('input', (e) => {
  query = e.target.value;
  renderGrid();
});
$('#sort').addEventListener('change', (e) => {
  sort = e.target.value;
  renderGrid();
});

/* ----- cart drawer ----- */
$('#openCart').addEventListener('click', openDrawer);
$('#closeCart').addEventListener('click', closeDrawer);
$('#scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDrawer();
    closeMenu();
  }
});

/* ----- mobile menu ----- */
menuBtn.addEventListener('click', () => {
  menuBtn.setAttribute('aria-expanded', nav.classList.toggle('open'));
});
nav.addEventListener('click', (e) => {
  if (e.target.closest('a')) closeMenu();
});

/* ----- account window ----- */
document.addEventListener('click', (e) => {
  /* click on the dark backdrop */
  if (e.target === $('#acct')) {
    closeAcct();
    return;
  }

  const eye = e.target.closest('[data-eye]');
  if (eye) {
    togglePasswordVisibility(eye);
    return;
  }

  const t = e.target.closest(
    '[data-account],a[href="#account"],[data-aclose],[data-amode],[data-alogout],[data-a]'
  );
  if (!t) return;

  if (t.matches('[data-account],a[href="#account"]')) {
    e.preventDefault();
    closeMenu();
    if (isAdmin(user) && getRole() === 'admin') goAdmin();
    else openAcct();
  } else if (t.dataset.aclose) {
    closeAcct();
  } else if (t.dataset.amode) {
    acctMode = t.dataset.amode;
    renderAcct();
  } else if (t.dataset.a) {
    acctAction(t.dataset.a, t.dataset.v);
  } else if (t.dataset.alogout) {
    authLib.signOut(auth).then(() => {
      user = null;
      updateAccountLink();
      closeAcct();
      toast('You have signed out');
    });
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'ap' || e.target.id === 'ap2') checkPasswordMatch();
});

/* form id -> function that handles its submit */
const FORM_HANDLERS = {
  acctForm: submitAcct,
  acctProfile: saveProfile,
  acctAddr: saveAddress,
  acctPay: savePayment,
  acctPrefs: savePrefs,
};
document.addEventListener('submit', (e) => {
  const handler = FORM_HANDLERS[e.target.id];
  if (!handler) return;
  e.preventDefault();
  handler();
});


/* 15. Start
   -------------------------------------------------------------------------- */

const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';

/* Fill the shop with settings and products */
function boot(settings, products) {
  S = { ...DEFAULT_SETTINGS, ...settings };
  PRODUCTS = products.filter((p) => p.active !== false);

  /* forget cart and favourite items that no longer exist */
  Object.keys(cart).forEach((id) => {
    if (!find(id)) delete cart[id];
  });
  Object.keys(favs).forEach((id) => {
    if (!find(id)) delete favs[id];
  });

  applySettings();
  renderChips();
  renderGrid();
  updateCount();
}

/* Show the shop name and headline straight away (saved from the last visit, or the
   defaults), so the placeholder text in index.html never flashes while the shop loads. */
function showCachedSettings() {
  const cached = readJSON('aps_settings', null);
  S = { ...DEFAULT_SETTINGS, ...(cached || {}) };
  if (!cached) S.announcement = '';
  applySettings();
}

/* Load Firebase (Firestore + Auth). If anything fails, the shop runs offline. */
let firebaseFailed = false;

async function connectFirebase() {
  if (firestore) return; /* already connected (this runs again on "Try again") */
  firebaseFailed = false;
  try {
    const firebase = await import('./firebase.js');
    db = firebase.db;
    configured = firebase.configured;
    if (!configured) return;

    firestore = await import(FIREBASE_SDK + 'firebase-firestore.js');

    try {
      authLib = await import(FIREBASE_SDK + 'firebase-auth.js');
      auth = authLib.getAuth(firebase.app);
      authLib.onAuthStateChanged(auth, (u) => {
        user = u;
        updateAccountLink();
        if (u) {
          syncUser(u);
          watchOrders();
        } else {
          stopOrders();
        }
      });
    } catch (e) {
      auth = null;
    }
  } catch (e) {
    configured = false;
    firebaseFailed = true;
  }
}

/* Online: load the shop from Firebase. Offline (or if anything fails): use the built-in product list. */
function showLoadFail() {
  const grid = $('#grid');
  grid.setAttribute('aria-busy', 'false');
  grid.innerHTML =
    '<div class="loadfail"><p>We could not load our products. Please check your connection.</p>' +
    '<button type="button" class="btn" id="retryLoad">Try again</button></div>';
  const retry = $('#retryLoad');
  if (retry) retry.addEventListener('click', () => {
    grid.setAttribute('aria-busy', 'true');
    start();
  });
}

async function start() {
  await connectFirebase();
  if (firebaseFailed) {
    showLoadFail(); /* offline or Firebase blocked: never show sample products with sample prices */
    return;
  }
  if (!configured) {
    boot({}, DEFAULT_PRODUCTS); /* Firebase not set up in config.js: sample shop */
    return;
  }

  try {
    const [settingsDoc, productDocs] = await Promise.all([
      firestore.getDoc(firestore.doc(db, 'settings', 'store')),
      firestore.getDocs(firestore.collection(db, 'products')),
    ]);

    const products = productDocs.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const settings = settingsDoc.exists() ? settingsDoc.data() : {};

    writeJSON('aps_settings', settings);
    boot(settings, products);

    if (!products.length) {
      $('#grid').innerHTML = '<p class="empty">Products are coming soon. Please check back shortly.</p>';
    }
  } catch (e) {
    /* Never show sample products with sample prices to real customers. Offer a retry instead.
       (boot() is skipped on purpose so the visitor's saved cart is not cleared.) */
    console.error('Could not load products', e);
    showLoadFail();
  }
}

loadStorage();
showCachedSettings();
scrollEffects();
start();