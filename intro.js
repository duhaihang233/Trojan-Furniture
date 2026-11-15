/* TroShare opening animation + USC Google login.
   Plays the TS → TroShare animation, then the red page shrinks into the login header.
   Sign-in uses Google; the TroShare server only accepts verified @usc.edu accounts (see auth.js).
   Signed-in students see the animation once per visit and go straight into the app. */
(() => {
  'use strict';
  const el = document.getElementById('intro');
  if (!el) return;
  const AUTH = window.TS_AUTH;
  const CFG = window.TS_CONFIG;
  const $ = (id) => document.getElementById(id);
  const behind = [document.getElementById('app'), document.getElementById('tabbar')];
  let timers = [];

  const clear = () => { timers.forEach(clearTimeout); timers = []; };
  const lockApp = (on) => behind.forEach((n) => { if (n) n.inert = on; });
  const showWait = (on) => { $('intro-idle').hidden = on; $('intro-wait').hidden = !on; };
  const showError = (msg) => { const e = $('intro-error'); e.textContent = msg || ''; e.hidden = !msg; };

  function play() {
    clear();
    el.hidden = false;
    lockApp(true);
    showWait(false);
    el.classList.remove('play', 'to-login', 'leaving');
    void el.offsetWidth; // restart the CSS animations
    el.classList.add('play');
    timers.push(setTimeout(() => {
      if (AUTH.signedIn()) close();
      else { el.classList.add('to-login'); renderGoogleButton(); }
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

  async function onCredential(response) {
    showError('');
    showWait(true);
    try {
      await AUTH.signInWithGoogle(response.credential);
      close();
    } catch (err) {
      showWait(false);
      showError(err.message);
    }
  }

  // Google's sign-in script (accounts.google.com/gsi/client). Loaded here rather than with a <script> tag
  // so we can tell "blocked" (error event: blocker extension, or a network that blocks Google) from
  // "slow", and retry without reloading the page.
  const GSI = 'https://accounts.google.com/gsi/client';
  let gsiLoad = null;
  function loadGsi() {
    if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
    if (gsiLoad) return gsiLoad;
    gsiLoad = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GSI; s.async = true;
      const timer = setTimeout(() => fail('slow'), 20000);
      const fail = (why) => { clearTimeout(timer); s.remove(); gsiLoad = null; reject(new Error(why)); };
      s.onload = () => {
        clearTimeout(timer);
        if (window.google && window.google.accounts && window.google.accounts.id) resolve();
        else fail('blocked'); // some blockers answer with an empty stub script
      };
      s.onerror = () => fail('blocked');
      document.head.appendChild(s);
    });
    return gsiLoad;
  }
  const LOAD_ERRORS = {
    blocked: "Google sign-in was blocked, so the button can't appear. Turn off ad or tracker blocking for this site (or try another browser), and if your network blocks Google, connect to a VPN. Then tap Try again.",
    slow: "Google sign-in is taking too long to load. Check your connection, then tap Try again."
  };
  $('intro-retry').addEventListener('click', () => { $('intro-retry').hidden = true; showError(''); renderGoogleButton(); });

  let initialized = false;
  async function renderGoogleButton() {
    const box = $('g-signin');
    if (!AUTH.configured()) { showError("Sign-in isn't set up yet: add the Google client ID in config.js."); return; }
    try { await loadGsi(); }
    catch (err) { showError(LOAD_ERRORS[err.message] || LOAD_ERRORS.slow); $('intro-retry').hidden = false; return; }
    const gid = window.google.accounts.id;
    if (!initialized) {
      // hd narrows Google's account chooser to usc.edu accounts; the server enforces it either way.
      gid.initialize({ client_id: CFG.googleClientId, callback: onCredential, hd: 'usc.edu', auto_select: false, context: 'signin', ux_mode: 'popup', itp_support: true });
      initialized = true;
    }
    box.innerHTML = '';
    gid.renderButton(box, { type: 'standard', theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', logo_alignment: 'left', locale: 'en', width: Math.min(320, box.clientWidth || 320) });
  }

  window.TS_INTRO = {
    logout() { location.hash = '#/home'; AUTH.signOut(); } // signOut fires ts-signed-out, which shows the login screen
  };
  // Session expired or was rejected by the server: back to the login screen.
  window.addEventListener('ts-signed-out', () => { if (el.hidden) play(); });

  let seen = false;
  try { seen = sessionStorage.getItem('ts-intro') === '1'; sessionStorage.setItem('ts-intro', '1'); } catch (e) { /* ignore */ }
  if (!(seen && AUTH.signedIn())) play();
  if (!AUTH.signedIn() && AUTH.configured()) loadGsi().catch(() => { /* reported when the button is drawn */ });
})();
