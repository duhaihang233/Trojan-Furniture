/* TroShare accounts: sign in with a USC Google account.
   Google returns a signed ID token; the Worker (proxy/worker.js) checks it really is a verified @usc.edu
   account and returns a TroShare session token, which this file keeps in localStorage and sends with
   every request. */
window.TS_AUTH = (() => {
  'use strict';
  const KEY = 'troshare-session';
  const cfg = window.TS_CONFIG;
  let session = read();

  function read() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY));
      if (v && v.token && v.exp * 1000 > Date.now()) return v;
    } catch (e) { /* storage unavailable or corrupt */ }
    return null;
  }
  function write(v) {
    session = v;
    try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  async function call(path, options = {}) {
    const headers = { 'content-type': 'application/json' };
    if (session) headers.authorization = 'Bearer ' + session.token;
    let res;
    try { res = await fetch(cfg.api + path, { ...options, headers }); }
    catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw new Error("Couldn't reach TroShare. Check your connection and try again.");
    }
    const json = await res.json().catch(() => null);
    if (res.status === 401 && session && path !== '/auth/google') {
      write(null);
      window.dispatchEvent(new Event('ts-signed-out'));
    }
    if (!res.ok) {
      const err = new Error((json && json.error && json.error.message) || `Something went wrong (${res.status}). Try again.`);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  return {
    get user() { return session && session.user; },
    get profile() { return session && session.profile; },
    signedIn: () => !!session,
    /** Profile still needs a class year and hall (first login). */
    needsSetup: () => !!session && !(session.profile && session.profile.year && session.profile.hall),
    configured: () => !!cfg.googleClientId,
    call,

    async signInWithGoogle(credential) {
      const r = await call('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) });
      write(r);
      window.dispatchEvent(new Event('ts-signed-in'));
      return r;
    },
    /** Re-checks the session with the server (it may have expired) and refreshes the profile. */
    async refresh() {
      if (!session) return null;
      const r = await call('/me');
      write({ ...session, user: r.user, profile: r.profile });
      return r;
    },
    async saveProfile(profile) {
      const r = await call('/me/profile', { method: 'PUT', body: JSON.stringify(profile) });
      write({ ...session, profile: r.profile });
      return r.profile;
    },
    signOut() {
      write(null);
      try { window.google.accounts.id.disableAutoSelect(); } catch (e) { /* Google script not loaded */ }
      window.dispatchEvent(new Event('ts-signed-out'));
    }
  };
})();
