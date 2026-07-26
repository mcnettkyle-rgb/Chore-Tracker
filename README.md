# Chore Tracker

A weekly chore and allowance app for a family. Kids mark chores done from
their own tablets; nothing earns money until a parent approves it.

- **Kids** get a one-tap screen showing only what they need to do now.
- **You** get an approval queue, and a phone notification when something lands
  in it.
- **Money** accrues per approved chore into a running balance you pay out when
  cash actually changes hands.
- **Everything is editable in the app** — chores, prices, who does what, which
  days. You should never need to touch the code to change the routine.

No build step, no framework, no npm install. It's HTML, CSS and JavaScript.

---

## Try it in 10 seconds

```bash
git clone <this repo> && cd Chore-Tracker
python3 -m http.server 8000
```

Open <http://localhost:8000>. It starts in **demo mode** with two sample kids
and ten chores, all stored in your browser. Nothing syncs yet — that's the next
section — but every screen works, so poke at it before committing to anything.

The parent tile has no PIN on first run: tap any four digits to get in, and
you'll be asked to choose a real one.

---

## Making it real (about 15 minutes, free)

Demo mode keeps everything in one browser, so the girls' tablets wouldn't see
what you approve. To sync across devices you need a backend. This uses
**Supabase** — free tier, no credit card.

### 1. Create the project

1. Sign up at [supabase.com](https://supabase.com) and create a project.
2. Wait for it to finish provisioning (~2 minutes).

### 2. Create the tables

In the dashboard: **SQL Editor → New query**.

1. Paste all of [`supabase/schema.sql`](supabase/schema.sql) and hit **Run**.
2. Optionally paste [`supabase/seed.sql`](supabase/seed.sql) and **Run** to get
   the sample kids and chores. Skip it if you'd rather start empty — you can add
   everything in the app.

Both are safe to re-run.

### 3. Point the app at it

**Settings → API** in the dashboard gives you a Project URL and an `anon`
public key. Put them in `config.js`:

```js
export const CONFIG = {
  mode: 'supabase',
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabaseAnonKey: 'eyJhbGciOi...',
  vapidPublicKey: '',
};
```

Reload. You're now on the real database, and two browsers will stay in sync
live.

### 4. Put it somewhere the tablets can reach

Anything that serves static files works. GitHub Pages is the easy one:
**Settings → Pages → Deploy from branch**, pick your branch and `/ (root)`.

On each tablet, open the URL and **Add to Home Screen**. It then runs
fullscreen like an app, and remembers which kid that tablet belongs to.

> On iPhone/iPad, adding to the home screen is also what makes notifications
> possible at all — Safari won't allow push from a normal browser tab.

---

## Phone notifications (optional)

The in-app badge works without any of this. Set it up if you want your phone to
buzz when a chore is marked done.

### Generate a VAPID key pair

```bash
npx web-push generate-vapid-keys
```

Put the **public** key in `config.js` as `vapidPublicKey`. The private one stays
on the server.

### Deploy the function

With the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase link --project-ref YOUR-PROJECT-REF

supabase secrets set \
  NOTIFY_SECRET="$(openssl rand -hex 24)" \
  VAPID_PUBLIC_KEY="...your public key..." \
  VAPID_PRIVATE_KEY="...your private key..." \
  VAPID_SUBJECT="mailto:you@example.com"

# Deployed without JWT checking so the database trigger can reach it; the
# function verifies the shared secret instead.
supabase functions deploy notify --no-verify-jwt
```

For email as well, add a free [Resend](https://resend.com) key:

```bash
supabase secrets set \
  RESEND_API_KEY="re_..." \
  RESEND_FROM="Chores <chores@yourdomain.com>"
```

### Wire up the trigger

Run [`supabase/notifications.sql`](supabase/notifications.sql) in the SQL
Editor, then run this with your own values (the secret must match the
`NOTIFY_SECRET` you set above):

```sql
insert into private_config (key, value) values
  ('notify_function_url', 'https://YOUR-PROJECT.supabase.co/functions/v1/notify'),
  ('notify_secret',       'the-same-secret-you-set-above')
on conflict (key) do update set value = excluded.value;
```

Finally, in the app: **Parent → Settings → Notifications → Turn on for this
device**, and set the email address to send to.

Bursts are coalesced — five chores marked done in a row buzzes you once, with a
summary of everything waiting. Quiet hours hold back push (email still goes out).

---

## How it works

### Only approved chores pay

Marking a chore done moves it to `submitted` and nothing else. Money is created
only when you approve, and it's created in the same transaction that flips the
status. Rejecting a chore you'd already approved claws the money back and puts
it back on the kid's list with your note attached.

### Kids can't approve their own work

The `anon` key is public — it ships in the page source of every Supabase app.
That's safe here because **`anon` can read, and cannot write anything, ever**.
Every write goes through a database function:

- Kids get exactly two: `submit_chore` and `unsubmit_chore`. They can only move
  a chore between `pending` and `submitted`. They cannot approve, cannot set a
  price, and cannot touch the ledger.
- Every parent action requires a session token from `parent_unlock`, which
  requires the PIN. The PIN is stored as a bcrypt hash and is not readable
  through the API at all.
- Five wrong PINs locks parent actions for five minutes, so a four-digit PIN
  can't be brute-forced from the developer console. Six digits is better.

This is built to stop a curious ten-year-old with devtools, which is the actual
threat model here. It is not bank-grade, and no real money moves through it.

### Prices are snapshotted

Each generated chore records the name, icon and value it had at the time.
Raising "dishes" from 50c to 75c changes this week's unstarted chores and every
future week — it never rewrites what the girls already earned.

A unique index guarantees at most one payment per chore, so a double-tapped
**Approve** cannot pay twice.

### The week generates itself

`generate_week()` builds the week's chores from your template. It's idempotent
and runs on every page load, so there's no cron job to maintain and no way to
miss a week. Rotating chores work out whose turn it is by counting whole weeks
from the rotation's anchor date.

---

## Changing the routine

Everything below lives in **Parent → Schedule** or **Parent → Settings**:

| What | Where |
|---|---|
| Add/edit/archive a chore, change what it's worth | Schedule → tap a chore |
| Who does a chore, and on which days | Schedule → tap a chore → "Who does it, and when" |
| A chore that alternates between kids weekly | Schedule → Rotations |
| A one-off bonus job for this week only | Schedule → add a chore → When: "Just once, this week" |
| Chores you don't want to inspect | Chore editor → "Pay without checking" |
| Kids' names, colours, avatars | Settings → Children |
| Week start day, currency, late chores | Settings → Rules |
| Notifications, quiet hours | Settings → Notifications |
| Change the PIN | Settings → Parent PIN |

Archiving a chore keeps all its history. Removing a child keeps their balance,
so you can add them back.

---

## Tests

**Database** — spins up a throwaway local Postgres, applies the real schema, and
runs 57 assertions. Never touches your Supabase project. Needs `postgresql-16`.

```bash
./supabase/test/run-tests.sh
```

It covers the things that would actually hurt: submitting never pays, triple
approval pays once, rejection claws back, past earnings survive a price change,
rotation alternates over three weeks, the PIN lockout refuses even a correct
PIN, and `anon` cannot approve, re-price, or read the PIN hash. The local
cluster grants `anon` the same privileges Supabase does, so those last checks
exercise row-level security rather than a missing `GRANT`.

**Browser** — drives the real UI in Chromium. Needs Playwright.

```bash
./test/run-tests.sh
```

It walks the whole loop — mark done, undo, reject with a note, redo, approve,
pay out — and the parent editors, re-pricing, and PIN lockout. Screenshots land
in `.test-screenshots/`.

---

## Layout

```
index.html              shell
config.js               the only file you should need to edit
css/styles.css
js/
  app.js                router
  store.js              app state + render loop
  data.js               picks an adapter
  local-adapter.js      demo mode (localStorage)
  supabase-adapter.js   real backend + realtime
  push.js               web push registration
  ui.js  util.js
  views/                picker, kid, parent, ledger, schedule, settings, pin
sw.js                   service worker: install + push
supabase/
  schema.sql            tables, RLS, functions  ← run this first
  seed.sql              sample kids and chores  ← optional
  notifications.sql     trigger for push/email  ← optional
  functions/notify/     Edge Function
  test/                 database tests
test/                   browser tests
```

## Troubleshooting

**"Couldn't start"** — check `supabaseUrl` and `supabaseAnonKey` in `config.js`.

**Chores don't appear** — you probably ran `schema.sql` but not `seed.sql`, and
haven't added any chores yet. Parent → Schedule → Add a chore.

**Free project paused** — Supabase pauses free projects after ~7 days of no
activity. Un-pause it in the dashboard. Daily family use never hits this.

**Push doesn't arrive on iPhone** — it must be added to the home screen and
opened from that icon. Safari doesn't allow push from a normal tab.

**Kid's tablet shows the wrong kid** — tap **Switch** in the top right.
