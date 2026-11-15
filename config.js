// TroShare settings. Both values are public: they identify the app, they aren't secrets.
window.TS_CONFIG = {
  // Cloudflare Worker in proxy/: USC sign-in, profiles, and the AI room planner.
  api: 'https://troshare-room-proxy.thomas-haihang-du.workers.dev',
  // OAuth client ID from Google Cloud Console (APIs & Services → Credentials). Must match
  // GOOGLE_CLIENT_ID in proxy/wrangler.toml.
  googleClientId: '53504650186-br07fmrs9d8apcmd502ttnd4lkjv6cua.apps.googleusercontent.com',
  // Public half of the Web Push (VAPID) key. Must match VAPID_PUBLIC_KEY in proxy/wrangler.toml.
  // Guest demo login on the sign-in screen (the Worker's GUEST_DEMO must be "on" too).
  guestDemo: true,
  vapidPublicKey: 'BKPuBG6sP-Q0nBVDgUqUxR5qZ1-9lUz3JnBgFtbSDkcR1V6H5EE0CMVzS6sZizDzzFu6VmW92jdapBm568f9FQw'
};
