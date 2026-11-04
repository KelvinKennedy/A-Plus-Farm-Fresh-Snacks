/* Slows down repeated wrong-password guesses from one browser.
   After 5 failures the sign-in is paused: 30 s, then 1 min, 2 min, 4 min... up to 15 min.
   This is only a speed bump (an attacker can skip the website and call Firebase directly),
   so the real protection is in the Firebase console: see the checklist in the README / chat. */
const LIMIT = 5;
const BASE_MS = 30 * 1000;
const MAX_MS = 15 * 60 * 1000;
const FORGET_MS = 15 * 60 * 1000; /* old mistakes are forgotten after this long without a new one */

function read(scope) {
  let s;
  try {
    s = JSON.parse(localStorage.getItem('aps_fail_' + scope));
  } catch (e) {}
  s = s || { n: 0, until: 0, last: 0 };

  /* not locked, and the last wrong password was a long time ago: start counting from zero */
  const now = Date.now();
  if (s.n > 0 && s.until <= now && now - (s.last || s.until || 0) > FORGET_MS) {
    s = { n: 0, until: 0, last: 0 };
    write(scope, s);
  }
  return s;
}

function write(scope, value) {
  try {
    localStorage.setItem('aps_fail_' + scope, JSON.stringify(value));
  } catch (e) {}
}

/* Milliseconds left before another attempt is allowed (0 = go ahead) */
export function lockLeft(scope) {
  return Math.max(0, read(scope).until - Date.now());
}

export function recordFail(scope) {
  const s = read(scope);
  s.n += 1;
  s.last = Date.now();
  if (s.n >= LIMIT) s.until = Date.now() + Math.min(MAX_MS, BASE_MS * Math.pow(2, s.n - LIMIT));
  write(scope, s);
}

export function resetFails(scope) {
  write(scope, { n: 0, until: 0, last: 0 });
}

export function waitText(ms) {
  const sec = Math.ceil(ms / 1000);
  if (sec < 60) return sec + (sec === 1 ? ' second' : ' seconds');
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') + ' minutes';
}

/* Shows a live countdown in the error box and keeps the sign-in button off until the wait is over.
   boxSel / buttonSel are CSS selectors, looked up every second so it still works if the form is redrawn. */
let timer = null;

export function runCountdown(scope, boxSel, buttonSel) {
  clearInterval(timer);

  function tick() {
    const box = document.querySelector(boxSel);
    const button = document.querySelector(buttonSel);
    const left = lockLeft(scope);

    if (left <= 0) {
      clearInterval(timer);
      timer = null;
      if (box) box.textContent = '';
      if (button) button.disabled = false;
      return;
    }
    if (!box) {
      clearInterval(timer);
      timer = null;
      return;
    }
    box.textContent = 'Too many wrong attempts. Try again in ' + waitText(left) + '.';
    if (button) button.disabled = true;
  }

  tick();
  timer = setInterval(tick, 1000);
}

/* Call when a sign-in form appears (or the page loads): if a wait is still running,
   the countdown carries on from the time that is really left. */
export function resumeCountdown(scope, boxSel, buttonSel) {
  if (lockLeft(scope) > 0) runCountdown(scope, boxSel, buttonSel);
}