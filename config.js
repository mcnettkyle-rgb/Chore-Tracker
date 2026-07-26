// Your settings. This is the only file you should need to edit.
//
// It IS committed to the repo. The Supabase anon key is designed to be public
// — it ships in the page source of every Supabase app — and the database is
// protected by row-level security, not by hiding this key. If you would rather
// not publish it anyway, add `config.js` to .gitignore after filling it in.

export const CONFIG = {
  // 'local'    — everything lives in this browser's localStorage.
  //              No account, no internet, no sync. Great for trying the app
  //              out and for letting the girls poke at it before you commit.
  //
  // 'supabase' — real cross-device sync. Tablets and your phone all see the
  //              same data. Requires the two values below.
  mode: 'local',

  // From your Supabase project: Settings → API (or "API Keys" / "Data API").
  //
  // supabaseUrl is the project root and NOTHING else:
  //     ✅ https://YOUR-PROJECT.supabase.co
  //     ❌ https://YOUR-PROJECT.supabase.co/rest/v1/    <- an endpoint, not the URL
  //
  // The dashboard displays that /rest/v1/ form too, and it's the easy one to
  // grab. The client adds /rest/v1 itself, so pasting it gives you requests to
  // /rest/v1/rest/v1/... and the error "Invalid path specified in request URL".
  supabaseUrl: '',

  // The key labelled public / publishable / anon — never the service_role or
  // secret one. Both formats work: "eyJhbGci..." or "sb_publishable_...".
  supabaseAnonKey: '',

  // Only needed if you turn on phone notifications. This is the PUBLIC half
  // of your VAPID key pair — see README, "Push notifications".
  vapidPublicKey: '',
};
