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
    blocked: "Google's sign-in button was blocked. Tap Continue with Google above to sign in on Google's page instead, or turn off ad or tracker blocking for this site and tap Try again.",
    slow: "Google's sign-in button is taking too long to load. Tap Continue with Google above to sign in on Google's page instead, or tap Try again."
  };
  $('intro-retry').addEventListener('click', () => { $('intro-retry').hidden = true; showError(''); renderGoogleButton(); });

  /* ---- Sign-in on Google's own page (OpenID Connect, response_type=id_token) ----
     Google's button (gsi/client) doesn't work in an iPhone Home Screen web app: the script stalls or its
     popup can't report back. There we send the student to Google's sign-in page instead, and Google sends
     them back to this page with an ID token in the URL fragment. It's the same kind of token the button
     gives, so the TroShare server checks it the same way. The return address must be listed under
     "Authorized redirect URIs" for this client ID in Google Cloud Console. */
  const REDIRECT_URI = new URL('./', location.href).href;
  const standalone = () => !!(navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));
  const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  function startRedirect() {
    const nonce = randomId(), state = randomId();
    try { localStorage.setItem('ts-oauth', JSON.stringify({ nonce, state, at: Date.now() })); } catch (e) { /* private mode: the check below fails safely */ }
    const q = new URLSearchParams({
      client_id: CFG.googleClientId, redirect_uri: REDIRECT_URI, response_type: 'id_token', scope: 'openid email profile',
      nonce, state, hd: 'usc.edu', prompt: 'select_account'
    });
    location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + q);
  }
  // Coming back from Google: #id_token=…&state=… (or #error=…). Returns true if this load is a sign-in return.
  function finishRedirect() {
    const h = location.hash;
    if (!/^#(.*&)?(id_token|error)=/.test(h)) return false;
    const q = new URLSearchParams(h.slice(1));
    history.replaceState(null, '', location.pathname + location.search + '#/home');
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('ts-oauth') || 'null'); localStorage.removeItem('ts-oauth'); } catch (e) { /* ignore */ }
    const token = q.get('id_token');
    let nonce = null;
    try { nonce = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).nonce; } catch (e) { /* not a token */ }
    showLogin();
    if (q.get('error')) { showError(q.get('error') === 'access_denied' ? 'Sign-in was canceled. Tap Continue with Google to try again.' : "Google couldn't sign you in (" + q.get('error') + '). Try again.'); return true; }
    if (!saved || q.get('state') !== saved.state || nonce !== saved.nonce || Date.now() - saved.at > 15 * 60000) {
      showError('That sign-in expired. Tap Continue with Google to try again.');
      return true;
    }
    onCredential({ credential: token });
    return true;
  }
  // The login screen without the opening animation (after coming back from Google).
  function showLogin() {
    clear();
    el.hidden = false;
    lockApp(true);
    el.classList.add('play', 'to-login');
    renderGoogleButton();
  }
  function renderRedirectButton(box) {
    box.innerHTML = `<button type="button" class="g-redirect" id="g-redirect"><svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>Continue with Google</button>`;
    $('g-redirect').addEventListener('click', startRedirect);
  }

  let initialized = false;
  async function renderGoogleButton() {
    const box = $('g-signin');
    if (!AUTH.configured()) { showError("Sign-in isn't set up yet: add the Google client ID in config.js."); return; }
    // Home Screen web app: Google's page instead of Google's button.
    if (standalone()) { renderRedirectButton(box); return; }
    try { await loadGsi(); }
    catch (err) { renderRedirectButton(box); showError(LOAD_ERRORS[err.message] || LOAD_ERRORS.slow); $('intro-retry').hidden = false; return; }
    const gid = window.google.accounts.id;
    if (!initialized) {
      // hd narrows Google's account chooser to usc.edu accounts; the server enforces it either way.
      gid.initialize({ client_id: CFG.googleClientId, callback: onCredential, hd: 'usc.edu', auto_select: false, context: 'signin', ux_mode: 'popup', itp_support: true });
      initialized = true;
    }
    box.innerHTML = '';
    gid.renderButton(box, { type: 'standard', theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', logo_alignment: 'left', locale: 'en', width: Math.min(320, box.clientWidth || 320) });
  }

  // Guest demo (hackathon only): a throwaway account to try the app without a USC login.
  if (CFG.guestDemo) {
    $('intro-guest').hidden = false;
    $('guest-login').addEventListener('click', async () => {
      showError('');
      $('intro-wait-text').textContent = 'Starting the guest demo…';
      showWait(true);
      try { await AUTH.signInAsGuest(); location.hash = '#/guide'; close(); }
      catch (err) { showWait(false); showError(err.message); }
      finally { $('intro-wait-text').textContent = 'Checking your USC account…'; }
    });
  }

  window.TS_INTRO = {
    logout() { location.hash = '#/home'; AUTH.signOut(); } // signOut fires ts-signed-out, which shows the login screen
  };
  // Session expired or was rejected by the server: back to the login screen.
  window.addEventListener('ts-signed-out', () => { if (el.hidden) play(); });

  let seen = false;
  try { seen = sessionStorage.getItem('ts-intro') === '1'; sessionStorage.setItem('ts-intro', '1'); } catch (e) { /* ignore */ }
  if (finishRedirect()) return; // back from Google's sign-in page
  if (!(seen && AUTH.signedIn())) play();
  if (!AUTH.signedIn() && AUTH.configured() && !standalone()) loadGsi().catch(() => { /* reported when the button is drawn */ });
})();
