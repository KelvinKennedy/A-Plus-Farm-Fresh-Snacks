# Mtaa Market (HTML, CSS, JavaScript + Firebase)

A clothing and general retail shop plus a password-protected admin site.
No server to run: it is plain HTML, CSS and JS, so it hosts free on GitHub Pages.
Firebase (free "Spark" plan) stores products, settings and orders, and provides the admin login.

- Shop: `index.html`
- Admin: `admin/index.html`

## Try the shop right away

Until you connect Firebase, the shop shows sample products and orders go to WhatsApp only.
Browsers block the JavaScript modules when you double-click the file, so run a tiny local server:

- VS Code: install the "Live Server" extension, right-click `index.html`, Open with Live Server
- or in this folder: `python3 -m http.server 8000`, then open http://localhost:8000

## Connect Firebase (about 10 minutes)

1. Go to https://console.firebase.google.com and create a project (you can turn Analytics off).
2. Project overview > **Add app** > Web (`</>`). Copy the config values into `js/config.js`.
3. **Build > Authentication** > Get started > enable **Email/Password**. Open the **Users** tab > **Add user** and create your admin email and password.
   Put the same email in `ADMIN_EMAIL` in `js/config.js`.
4. **Build > Firestore Database** > Create database (production mode, pick the closest region).
   Open the **Rules** tab, paste the contents of `firestore.rules`, change `you@example.com` to your admin email, and **Publish**.
5. Open `admin/index.html` (through your local server), sign in, and on the Dashboard click **Load sample products**, or add your own under Products. Then fill in **Settings** (WhatsApp number, M-Pesa till, delivery fees).

## Put it online with GitHub Pages

1. Upload this folder to a GitHub repository (keep the folder structure).
2. Repository **Settings > Pages**: deploy from the main branch, root folder.
3. In Firebase: **Authentication > Settings > Authorized domains** > add `YOUR-USERNAME.github.io`.
4. Shop: `https://YOUR-USERNAME.github.io/REPO/`  Admin: `https://YOUR-USERNAME.github.io/REPO/admin/`

## What the admin controls

| Tab | You can |
|---|---|
| Dashboard | Counts, revenue, sold-out items, latest orders, load sample products |
| Products | Add, edit, delete, hide; photos; price; in-stock toggle |
| Orders | Live list of orders, change status, download CSV |
| Settings | Shop name, homepage text, announcement, footer, WhatsApp, M-Pesa, delivery fees |

Everything updates live. New orders appear in the admin without refreshing.

## Files

```
index.html           Shop page
css/style.css        Colours and layout (edit the variables at the top)
js/app.js            Shop logic: cart, checkout, orders
js/config.js         Your Firebase settings and admin email
js/defaults.js       Sample products and default settings
js/firebase.js       Connects to Firebase
admin/               Admin site (index.html, admin.css, admin.js)
firestore.rules      Security rules to paste into Firebase
```

## How payments work

M-Pesa: the customer pays your till, sends the confirmation on WhatsApp, and you mark the order "paid".
Card: you reply with a payment link. Cash on delivery needs nothing extra.
Automatic M-Pesa (STK push) and card checkout need a server-side component (for example Firebase Cloud Functions with Daraja or Paystack). That is a later upgrade.

## Honest limits

- **Prices are set in the visitor's browser.** The security rules check the order's shape and that total = subtotal + delivery, but cannot check prices against your catalogue. The admin flags orders whose prices differ from your catalogue. Always confirm the total with the customer on WhatsApp before dispatch.
- **Stock is a manual toggle** (in stock or sold out). Automatic stock counting would need Cloud Functions.
- Anyone can place an order (needed for a shop), so spam orders are possible. Delete them in the admin. Firebase App Check can reduce this later.
- The Firebase `apiKey` in `config.js` is not a secret. Your **rules** and your **admin login** protect the data, which is why the rules name your admin email.
- Free plan limits: about 50,000 reads and 20,000 writes per day. That is plenty for a small shop.
- Photos are resized to about 700 px and stored inside Firestore, so no paid Storage plan is needed.
