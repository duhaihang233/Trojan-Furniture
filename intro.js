/* TroShare opening animation + Google login.
   Plays the TS → TroShare animation, then the red page shrinks into the login header.
   Logged-in students see the animation once per visit and go straight into the app. */
(() => {
  'use strict';
  const el = document.getElementById('intro');
  if (!el) return;
  const KEY = 'troshare-auth';
  const $ = (id) => document.getElementById(id);
  const behind = [document.getElementById('app'), document.getElementById('tabbar')];
  let timers = [];

  const clear = () => { timers.forEach(clearTimeout); timers = []; };
  const authed = () => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
  const setAuth = (on) => { try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch (e) { /* storage unavailable */ } };
  const lockApp = (on) => behind.forEach((n) => { if (n) n.inert = on; });
  const showWait = (on) => { $('intro-idle').hidden = on; $('intro-wait').hidden = !on; };

  function play() {
    clear();
    el.hidden = false;
    lockApp(true);
    showWait(false);
    el.classList.remove('play', 'to-login', 'leaving');
    void el.offsetWidth; // restart the CSS animations
    el.classList.add('play');
    timers.push(setTimeout(() => {
      if (authed()) close();
      else el.classList.add('to-login');
    }, 4200));
  }

  function close() {
    clear();
    el.classList.add('leaving');
    timers.push(setTimeout(() => {
      el.hidden = true;
      el.classList.remove('play', 'to-login', 'leaving');
      lockApp(false);
    }, 500));
  }

  $('intro-google').addEventListener('click', () => showWait(true));
  $('intro-cancel').addEventListener('click', () => showWait(false));
  $('intro-enter').addEventListener('click', () => { setAuth(true); close(); });

  window.TS_INTRO = {
    logout() { setAuth(false); location.hash = '#/home'; play(); }
  };

  let seen = false;
  try { seen = sessionStorage.getItem('ts-intro') === '1'; sessionStorage.setItem('ts-intro', '1'); } catch (e) { /* ignore */ }
  if (!(seen && authed())) play();
})();
