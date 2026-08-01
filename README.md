# Chore Tracker

A weekly chore and allowance app for a family. Kids mark chores done from
their own tablets; nothing earns money until a parent approves it.

- **Kids** get a one-tap screen showing only what they need to do now, split
  into what's due today and what has all week.
- **You** get an approval queue, and a phone notification when something lands
  in it.
- **Money** accrues per approved chore into a running balance you pay out when
  cash actually changes hands. Each kid can have a **savings goal**, shown on
  their own screen as a progress bar — "most of the way to the roller skates"
  lands where "$14.25" doesn't.
- **Days off** can be marked for a sleepover, a sick day or a week at
  grandma's. Those chores stop counting entirely: not done, not paid for, and
  never held against anyone.
- **Bonus jobs** are harder chores worth extra. They pay like anything else
  when done, and cost nothing when they aren't — no missed count, no dent in
  the completion rate, and they never break a streak. They can also be set to
  have **no deadline at all**, sitting on the list until they're done instead
  of expiring with the week.
- **A dashboard** shows completion rate, missed chores and lifetime earnings
  over any week or month — for rewarding a perfect run. Kids see their
  **streak** on the picker and on their own screen, and neither days away nor
  skipped bonus jobs break it.
- **Everything is editable in the app** — chores, prices, who does what, which
  days. You should never need to touch the code to change the routine.
- **Backups** are one button in Settings: the whole history as a JSON file,
  without your PIN in it.

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

> 📖 **Never used Supabase?** [**SETUP.md**](SETUP.md) is a literal,
> click-by-click walkthrough of everything below, written assuming no prior
> knowledge. The summary here is for people who already know the tools.

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

> **Already running an older version?** Re-run `schema.sql` after pulling any
> code update. It only ever adds things — your chores, approvals, balances and
> PIN are untouched — and the parent screen shows a banner telling you plainly
> when the database is behind the app. The test suite applies it to a
> previous-version database on every run, so the upgrade path is exercised
> rather than hoped for.

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

### Approving is reversible

**To check → Approved this week → Undo** puts a chore back on the kid's list as
not done and takes the money back. It leaves no note, because it means "that
was a mistake" rather than "you did this badly" — that's what **Needs redo** in
the queue is for.

This matters most for chores marked "pay without checking", which pay the
instant a kid taps them. Without an undo, a mis-tap there is permanent.

### Prices are snapshotted

Each generated chore records the name, icon and value it had at the time.
Raising "dishes" from 50c to 75c changes this week's unstarted chores and every
future week — it never rewrites what the girls already earned.

A unique index guarantees at most one payment per chore, so a double-tapped
**Approve** cannot pay twice.

### What "completion rate" counts

The dashboard scores a chore once its day has passed, or once it's been
approved. Anything still ahead of its deadline sits outside the rate entirely —
otherwise a rate checked on Wednesday would be dragged down by Friday's chores
and 100% would be unreachable, which would make the perfect-period badge
impossible to earn.

Chores sitting in your approval queue count as done. The kid finished their
part; how fast you review shouldn't move their score.

An "anytime this week" chore has no due date, so it counts on the last day of
its week — that's the point at which it was genuinely owed.

### Dates are judged where the family lives

Supabase runs in UTC. A household in the Americas is several hours behind, so
from early evening until midnight local, UTC has already rolled over to
tomorrow — and a chore due today gets judged against tomorrow's date. A kid
doing chores after dinner was told "This chore is past its due date."

`household_today()` resolves the date in the timezone stored in settings, and
every date-sensitive function uses it instead of `current_date`. The timezone
is shown in **Settings → Rules** with a one-tap button to set it from the
device you're on; if it doesn't match, the app says so and explains what breaks.

### Drawing a line under a trial run

Setting the app up generates a week of chores nobody was actually asked to do,
and those sit in the statistics as misses forever. **Settings → Going live**
deletes them and records a start date.

The date is the important half. `generate_week()` runs on every page load and
would otherwise recreate everything that was just cleared, so it skips anything
before that date too. "All time" on the dashboard then starts there as well.

By default only chores nobody acted on are removed — approved work and the
money it earned are real history and are kept. Wiping balances is a separate,
explicit checkbox.

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
| Completion rate, missed chores, lifetime earnings | Progress → pick a timeframe |
| Change the PIN | Settings → Parent PIN |
| Clear a trial run before going live | Settings → Going live |
| Undo a chore approved by mistake | To check → Approved this week → Undo |

Archiving a chore keeps all its history. Removing a child keeps their balance,
so you can add them back.

---

## Tests

**Database** — spins up a throwaway local Postgres, applies the real schema, and
runs 304 assertions across both project configurations. Never touches your
Supabase project. Needs `postgresql-16`.

```bash
./supabase/test/run-tests.sh
```

It covers the things that would actually hurt: submitting never pays, triple
approval pays once, rejection claws back, past earnings survive a price change,
rotation alternates over three weeks, the PIN lockout refuses even a correct
PIN, and `anon` cannot approve, re-price, or read the PIN hash. The local
cluster grants `anon` the same privileges Supabase does, so those last checks
exercise row-level security rather than a missing `GRANT`.

The last section applies `schema.sql` to a database built on the *previous*
version, in a single transaction, the way the Supabase SQL editor does. That
path can fail on its own: Postgres refuses to use an enum value in the same
transaction that added it, and a fresh install never exercises it — so the
failure would pass every other test here and appear only on a live project.

**Browser** — drives the real UI in Chromium, against a demo-mode copy so it
never touches your data. 317 assertions. Needs Playwright.

```bash
./test/run-tests.sh
```

It walks the whole loop — mark done, undo, reject with a note, redo, approve,
pay out — plus the parent editors, re-pricing, renaming children, expired
chores, the dashboard across timeframes, and the PIN lockout. It also pins down
that the parent's week navigation stays on the parent's screen, that paging
forward actually shows next week's plan while paging back invents nothing, and
that two chores sharing a name stay separate.

For the newer features it checks what they must *not* do: marking someone away
removes those days from the missed count rather than adding to it, a savings
goal can be cleared once set, a streak survives a day away, a skipped bonus job
moves neither the missed count nor the completion rate while a finished one
still pays, and a backup never contains the PIN hash. Screenshots land in
`.test-screenshots/`.

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
  stats.js              dashboard arithmetic (shared by both adapters)
  views/                picker, kid, parent, stats, ledger, schedule, settings, pin
sw.js                   service worker: install + push
supabase/
  schema.sql            tables, RLS, functions  ← run this first
  seed.sql              sample kids and chores  ← optional
  notifications.sql     trigger for push/email  ← optional
  reset.sql             erase everything and start over
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
