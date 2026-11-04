/* Default settings and sample products.
   The shop uses these until you save your own in the admin (admin settings always win). */
export const DEFAULT_SETTINGS = {
  shopName: 'A Plus Snacks',
  eyebrow: 'Fresh snacks',
  heroTitle: 'Snack time, delivered across Kenya.',
  heroText: 'Crisps, muffins, samosas, popcorn and sweet treats at fair prices. Pay with M-Pesa, card, or on delivery.',
  announcement: 'Free delivery on orders over KES 5,000',
  tagline: 'Tasty snacks and everyday treats, delivered to your door.',
  footer: '\u00a9 2026 A Plus Fresh Farm & Snacks. All prices in Kenyan shillings (KES).',
  whatsapp: '',   /* set your real number in Admin > Settings */
  mpesaTill: '',  /* set your real till/paybill in Admin > Settings */
  mpesaType: 'Till number',
  deliveryNairobi: 200,
  deliveryOther: 450,
  freeOver: 5000
};

/* Sample products (placeholders: edit names, prices and packs in the admin).
   Photos live in images/slides/. */
const P = (id, name, cat, price, note, color, extra) => Object.assign(
  { id, name, cat, price, note, color, image: '', active: true, inStock: true, desc: '', badge: '', oldPrice: 0, pack: '' },
  extra
);
const IMG = n => 'images/slides/snack' + n + '.webp';

export const DEFAULT_PRODUCTS = [
  P('p1', 'Salted crisps', 'Savoury', 80, 'Thin, golden and crunchy', '#e9a23b', {
    image: IMG(5), badge: 'Best seller', pack: 'Single pack',
    desc: 'Thin, golden potato crisps with a satisfying crunch. Perfect with a cold drink, on movie night or on the go.' }),
  P('p2', 'Vanilla muffins', 'Bakery', 250, 'Soft, golden and buttery', '#d9a066', {
    image: IMG(7), badge: 'New', pack: 'Pack of 4',
    desc: 'Soft golden muffins with a light, buttery crumb. A sweet treat for tea time or the lunch box.' }),
  P('p3', 'Samosas', 'Hot snacks', 200, 'Crispy outside, savoury inside', '#c98a2b', {
    image: IMG(8), badge: 'Best seller', pack: 'Pack of 4',
    desc: 'Crispy golden samosas, a Kenyan favourite. Great as a snack, a starter or a quick bite between meetings.' }),
  P('p4', 'Popcorn bucket', 'Savoury', 150, 'Light, fluffy and fresh', '#d94f3d', {
    image: IMG(3), pack: 'Large bucket',
    desc: 'A big bucket of light, fluffy popcorn. Made for sharing, movie nights and game days.' }),
  P('p5', 'Crunchy puffs', 'Savoury', 100, 'Curly and moreish', '#b8741f', {
    image: IMG(2), pack: 'Single pack',
    desc: 'Curly, crunchy puffs that are hard to stop eating. A fun snack for kids and grown-ups.' }),
  P('p6', 'Snack platter', 'Hot snacks', 800, 'A mix for sharing', '#8a3ffc', {
    image: IMG(1), badge: 'Great for sharing', pack: 'Serves 3 to 4',
    desc: 'A generous mixed platter with chips, chicken, samosas and more. Ideal for family time and small gatherings.' }),
  P('p7', 'Golden fritters', 'Hot snacks', 150, 'Soft inside, crisp outside', '#e0a030', {
    image: IMG(9), pack: 'Pack of 6',
    desc: 'Golden fried fritters that are soft on the inside and crisp on the outside. Best enjoyed warm.' }),
  P('p8', 'Lollipops', 'Sweets', 120, 'A rainbow of flavours', '#f06292', {
    image: IMG(12), pack: 'Pack of 10',
    desc: 'Colourful lollipops in assorted flavours. Perfect for party bags, treats and rewards.' }),
  P('p9', 'Chocolate minis', 'Sweets', 300, 'Assorted mini bars', '#6d4c41', {
    image: IMG(10), pack: 'Assorted pack',
    desc: 'Mini chocolate bars in assorted flavours, ideal for gifting or a little indulgence.' }),
  P('p10', 'Corn rings', 'Savoury', 70, 'Light and crunchy', '#e53935', {
    image: IMG(13), pack: 'Single pack',
    desc: 'Light, crunchy corn rings in tasty flavours. A snack the whole family will reach for.' }),
  P('p11', 'Heart lollipops', 'Sweets', 150, 'A sweet little gift', '#d32f2f', {
    image: IMG(11), badge: 'Gift idea', pack: 'Set of 3',
    desc: 'Three glossy heart-shaped lollipops. A sweet, simple gift for birthdays, Valentine\u2019s and thank-yous.' })
];