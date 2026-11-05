/* ==========================================================================
   Snack slideshow (homepage hero) - sliding style
   Each snack stays for 3 seconds, then slides in from the right.
   Visitors can also swipe or drag left/right, or use the arrow keys.
   To add, remove or reorder snacks, edit the SLIDES list below.
   ========================================================================== */
(function () {
  'use strict';

  /* ---- Settings ---------------------------------------------------------- */
  var FOLDER = 'slides/';   // where the photos live
  var DELAY  = 3000;               // time each snack stays on screen (ms)
  var SLIDE_TIME = 600;            // how long the slide movement takes (ms)

  var SLIDES = [
    // file           caption shown on the photo      description for screen readers
    { file: 'snack5.jpg',  name: 'Crisps',           alt: 'A pile of golden potato crisps' },
    { file: 'snack7.jpg',  name: 'Muffins',          alt: 'Freshly baked golden muffins' },
    { file: 'snack8.jpg',  name: 'Samosas',          alt: 'A row of crispy samosas' },
    { file: 'snack3.jpg',  name: 'Popcorn',          alt: 'A striped bucket overflowing with popcorn' },
    { file: 'snack2.jpg',  name: 'Crunchy puffs',    alt: 'Crunchy curled cheese puffs' },
    { file: 'snack1.jpg',  name: 'Snack platter',    alt: 'A platter with fries, chicken, samosas and more' },
    { file: 'snack9.jpg',  name: 'Golden fritters',  alt: 'A glass dish of golden fried fritters with tongs' },
    { file: 'snack12.jpg', name: 'Lollipops',        alt: 'Colourful lollipops on a pink background' },
    { file: 'snack10.jpg', name: 'Chocolates',       alt: 'Assorted chocolate bars on a wooden board' },
    { file: 'snack13.jpg', name: 'Corn rings',       alt: 'Two bags of crunchy corn rings' },
    { file: 'snack11.jpg', name: 'Heart lollipops',  alt: 'Three heart-shaped lollipops in a red envelope', pos: '50% 70%' },
    { file: 'snack4.jpg',  name: 'Fresh popcorn',    alt: 'Close-up of fluffy popcorn' },
    { file: 'snack6.jpg',  name: 'Hot chips',        alt: 'Chips frying in golden oil' },
    { file: 'snack14.jpg', name: 'Chicken wings',    alt: 'A plate of grilled chicken wings with a creamy dip' },
    { file: 'snack15.jpg', name: 'Fried chicken',    alt: 'Golden crispy fried chicken pieces on a rack' }
  ];

  /* ---- Build the slideshow ---------------------------------------------- */
  var root = document.getElementById('slideshow');
  if (!root || !SLIDES.length) return;

  // Visitors who prefer less motion get an instant switch instead of a slide.
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    SLIDE_TIME = 0;
  }

  function make(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  root.textContent = '';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-roledescription', 'carousel');
  root.setAttribute('aria-label', 'Our snacks. Use the left and right arrow keys to change snack.');
  root.tabIndex = 0;

  var slides = [];
  var stage = make('div', 'ss-stage');

  SLIDES.forEach(function (s, n) {
    var fig = make('figure', 'ss-slide');
    var img = new Image();
    img.src = FOLDER + s.file;
    img.alt = s.alt;
    img.decoding = 'async';
    img.draggable = false;
    if (n > 0) img.loading = 'lazy';
    if (s.pos) img.style.objectPosition = s.pos;
    var cap = make('figcaption');
    cap.textContent = s.name;
    fig.appendChild(img);
    fig.appendChild(cap);
    fig.style.transitionDuration = SLIDE_TIME + 'ms';
    fig.setAttribute('aria-hidden', n === 0 ? 'false' : 'true');
    stage.appendChild(fig);
    slides.push(fig);
  });

  root.appendChild(stage);

  /* ---- Behaviour --------------------------------------------------------- */
  var current = 0, timer = null, busy = false;
  slides[0].classList.add('on');
  slides[0].style.transform = 'translateX(0)';

  // dir = 1: new snack arrives from the right. dir = -1: from the left.
  function go(n, dir) {
    n = (n + slides.length) % slides.length;
    if (busy || n === current) return;
    busy = true;

    var from = slides[current], to = slides[n];

    // Park the new slide just outside the frame, with no animation...
    to.style.transition = 'none';
    to.style.transform = 'translateX(' + (dir * 100) + '%)';
    to.classList.add('on');
    void to.offsetWidth;                       // make the browser apply that position
    to.style.transition = '';
    to.style.transitionDuration = SLIDE_TIME + 'ms';

    // ...then slide the old one out and the new one in.
    from.style.transform = 'translateX(' + (-dir * 100) + '%)';
    to.style.transform = 'translateX(0)';
    to.setAttribute('aria-hidden', 'false');
    from.setAttribute('aria-hidden', 'true');
    current = n;

    setTimeout(function () {
      from.classList.remove('on');
      busy = false;
    }, SLIDE_TIME + 30);
  }

  function next() { go(current + 1, 1); }
  function prev() { go(current - 1, -1); }

  function stop()  { clearInterval(timer); timer = null; }
  function start() { stop(); timer = setInterval(next, DELAY); }

  /* ---- Swipe / drag ------------------------------------------------------ */
  var startX = null;
  root.addEventListener('pointerdown', function (e) { startX = e.clientX; stop(); });
  root.addEventListener('pointerup', function (e) {
    if (startX !== null) {
      var dx = e.clientX - startX;
      if (Math.abs(dx) > 40) { if (dx < 0) next(); else prev(); }
    }
    startX = null;
    start();
  });
  root.addEventListener('pointercancel', function () { startX = null; start(); });

  /* ---- Keyboard, hover pause, background tab ----------------------------- */
  root.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { next(); start(); }
    else if (e.key === 'ArrowLeft') { prev(); start(); }
  });
  root.addEventListener('mouseenter', stop);   // pause while the mouse is over it
  root.addEventListener('mouseleave', start);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else start();
  });

  start();
})();
