import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { FIREBASE_CONFIG } from './config.js';

/* Until config.js is filled in, the shop runs with sample data and orders go to WhatsApp only. */
export const configured = !!FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey.indexOf('PASTE') !== 0;
export const app = configured ? initializeApp(FIREBASE_CONFIG) : null;

/* Keep a copy of the products and settings on the visitor's device (IndexedDB), so the shop
   still opens when they are offline or on a weak connection. Falls back to the normal
   database if the browser does not allow it (for example in private mode). */
function openDb() {
  if (!app) return null;
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
  } catch (e) {
    return getFirestore(app);
  }
}
export const db = openDb();