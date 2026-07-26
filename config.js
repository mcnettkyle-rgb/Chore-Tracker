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

  // From your Supabase project: Settings → API.
  supabaseUrl: '',
  supabaseAnonKey: '',

  // Only needed if you turn on phone notifications. This is the PUBLIC half
  // of your VAPID key pair — see README, "Push notifications".
  vapidPublicKey: '',
};
