/* ==========================================================================
   Welcome page (index.html) and About page (about.html): small script, no product loading.
   - shop name, headline and announcement come from the admin Settings
   - the cart button shows the item count and opens the cart on shop.html
   ========================================================================== */
import { DEFAULT_SETTINGS } from './defaults.js';

const $ = (selector) => document.querySelector(selector);

function readJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch (e) {
    return fallback;
  }
}

function setText(selector, text) {
  const el = $(selector);
  if (el) el.textContent = text;
}

/* Settings saved on the last visit, or the defaults */
const cached = readJSON('aps_settings', null);
let S = { ...DEFAULT_SETTINGS, ...(cached || {}) };
if (!cached) S.announcement = '';

function applySettings() {
  if (document.body.classList.contains('home')) {
    document.title = S.shopName + ' | Order snacks online in Kenya';
  }
  setText('#logo', S.shopName);
  setText('#eyebrow', S.eyebrow);
  setText('#heroTitle', S.heroTitle);
  setText('#heroText', S.heroText);
  setText('#footer', S.footer);
  setText('#ftag', S.tagline);

  const wa = $('#waLink');
  if (wa) wa.href = S.whatsapp ? 'https://wa.me/' + encodeURIComponent(S.whatsapp) : '#';
  setText('#aboutName', S.shopName);

  const banner = $('#ann');
  if (banner) {
    banner.textContent = S.announcement || '';
    banner.hidden = !S.announcement;
  }
}

/* Cart badge: number of items saved in this browser */
function updateCount() {
  const cart = readJSON('mm_cart', {});
  const total = Object.keys(cart).reduce((sum, id) => sum + (Number(cart[id]) > 0 ? Number(cart[id]) : 0), 0);
  setText('#count', String(total));
}

applySettings();
updateCount();

/* Get the latest settings from Firebase (one small document) */
(async function refreshSettings() {
  try {
    const firebase = await import('./firebase.js');
    if (!firebase.configured) return;
    const firestore = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const snap = await firestore.getDoc(firestore.doc(firebase.db, 'settings', 'store'));
    const data = snap.exists() ? snap.data() : {};
    try {
      localStorage.setItem('aps_settings', JSON.stringify(data));
    } catch (e) {}
    S = { ...DEFAULT_SETTINGS, ...data };
    applySettings();
  } catch (e) {
    /* offline: keep what is already on the page */
  }
})();

/* Cart button: the cart lives on the shop page */
$('#openCart').addEventListener('click', () => {
  location.href = 'shop.html#cart';
});

/* Mobile menu */
const nav = $('#nav');
const menuBtn = $('#menuBtn');
menuBtn.addEventListener('click', () => {
  menuBtn.setAttribute('aria-expanded', nav.classList.toggle('open'));
});
document.addEventListener('click', (e) => {
  if (nav.classList.contains('open') && !e.target.closest('header')) {
    nav.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    nav.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
  }
});

/* Show the cart count again when the visitor comes back with the Back button */
window.addEventListener('pageshow', updateCount);
