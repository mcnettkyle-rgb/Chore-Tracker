# Setup, step by step

A literal walkthrough for connecting the app to a real database, written
assuming you've never used Supabase or anything like it.

**Total time:** about 20 minutes. **Cost:** free.

You do not need to install anything, use a terminal, or understand databases.
You will copy two files' contents into a web page and paste two values back.

> **You can do all of this in a web browser.** Git, terminals and cloning are
> not required — GitHub can show you file contents and let you edit files
> directly on its website. See [Doing this without a terminal](#doing-this-without-a-terminal)
> at the bottom if you'd rather not install anything.

---

## What you're about to do, in plain terms

Right now the app stores everything inside one browser. That's why the girls'
tablets can't see what you approve — the data physically never leaves the
device it was created on.

To fix that, the data needs to live somewhere all your devices can reach.
Supabase is a company that runs a database for you. You make an account, click
"new project", and they hand you a web address and a password-like key. You
paste those two things into `config.js`, and the app starts using their database
instead of the browser.

That's the whole idea. Steps 1–3 below are just the clicking.

---

## Part 1 — Make an account and a project

**1.1** Go to <https://supabase.com> and click **Start your project** (top
right).

**1.2** Sign in. It offers GitHub, or email and password. Either is fine — if
you already have a GitHub account, that's one less password.

**1.3** You'll land on a dashboard. Click **New project**.

If it asks you to create an *organization* first, do that. Name it anything
(`Home` works). Pick the **Free** plan. An organization is just a folder to put
projects in; you'll never think about it again.

**1.4** Fill in the new-project form:

| Field | What to put |
|---|---|
| **Name** | `chores` |
| **Database Password** | Click **Generate a password**, then copy it somewhere safe |
| **Region** | The one geographically closest to you |
| **Plan** | Free |

About that database password: **this app never uses it.** It's for connecting to
the database directly with other tools. Save it in your password manager and
move on. If you lose it you can reset it later.

**The GitHub field is optional — leave it blank.** It sets up automatic schema
deployment from a repo, which this project doesn't use. You'll paste the SQL in
by hand in Part 2, which is simpler and easier to see going wrong.

### The Security checkboxes

The new-project form has three security options. The schema is written so that
**none of them change how the app behaves** — it sets its own permissions
explicitly rather than depending on these. The test suite runs the whole thing
twice, once with these on and once off, to keep that true.

That said, here's what each one is and what I'd pick:

| Option | Set it to | Why |
|---|---|---|
| **Enable Data API** | ✅ **On** — required | This is the web API the app talks to. Without it there's nothing to connect to. |
| **Automatically expose new tables** | Either — **off is tidier** | Grants the API roles access to every new table automatically. `schema.sql` revokes all of it and grants back exactly read access on exactly the six tables that need it, so the end result is the same either way. Off is the better habit. |
| **Enable automatic RLS** | Either — **on is tidier** | Turns on row-level security for any new table. `schema.sql` already does this for all twelve tables it creates, so it changes nothing for this app. It's a safety net against some *future* table being added without protection. |

Short version: **the only one that has to be on is "Enable Data API."** The
other two don't change how this app behaves — the SQL sets its own permissions
and its own row-level security rather than depending on project defaults. Tick
them the tidy way if you like, but if you already created the project with
different settings, **there is nothing to redo.**

**1.5** Click **Create new project**, then wait. It takes 1–3 minutes and shows
a progress spinner. Go make a coffee.

✅ **You'll know it worked when** the spinner is replaced by a project dashboard
with charts on it.

---

## Part 2 — Create the tables

Your database exists but is completely empty. This step builds the tables that
hold chores, kids, approvals, and the money ledger.

**2.1** In the left sidebar, click **SQL Editor**. The icon looks like a
database cylinder or `SQL`.

**2.2** Click **New query** (usually a `+` at the top of the panel).

You now have a big empty text box. This is a place to paste database commands
and run them.

**2.3** Open [`supabase/schema.sql`](supabase/schema.sql) from this project.
Select **all** of it (Ctrl+A / Cmd+A) and copy it.

**2.4** Paste it into the big empty box in Supabase.

**2.5** Click **Run** (bottom right, or press Ctrl+Enter / Cmd+Enter).

It takes a few seconds. You'll see `Success. No rows returned` — that is the
correct, healthy result. It means "I did what you asked and had nothing to
report back."

> ⚠️ If you see red error text, don't panic and don't re-run it piecemeal.
> Scroll to the very bottom of the error, copy it, and see
> [Troubleshooting](#troubleshooting). The script is safe to run again from the
> top once the cause is fixed.

**2.6 (optional but recommended)** Do the same thing again with
[`supabase/seed.sql`](supabase/seed.sql) — **New query**, paste, **Run**. This
adds two sample kids and ten sample chores so the app isn't a blank page on
first open. You can rename or delete all of it inside the app afterwards.

✅ **Check it worked.** Open a new query, paste this, and Run:

```sql
select
  (select count(*) from children) as kids,
  (select count(*) from chores)   as chores,
  (select count(*) from chore_instances) as this_weeks_chores;
```

With the seed data you should see something like `2 | 10 | 48`. Without it,
`0 | 0 | 0` — also fine, it just means you'll add your own chores in the app.

✅ **Check your security is on.** This is the one worth eyeballing, because it's
what stops a kid approving their own chores:

```sql
select tablename as table_name,
       case when rowsecurity then 'protected' else '*** NOT PROTECTED ***' end
         as row_level_security
  from pg_tables
 where schemaname = 'public'
 order by rowsecurity, tablename;
```

Every row must say `protected`. The query deliberately sorts unprotected tables
to the top, so if anything is wrong it's the first thing you see. Ten rows,
all protected, is a correct result.

---

## Part 3 — Connect the app to it

**3.1** In the Supabase sidebar, click the **gear icon** (Project Settings) at
the bottom, then **API** in the menu that appears.

**3.2** You need two values from this page.

**The first is the Project URL.** It looks like:

```
https://abcdefghijklmnop.supabase.co
```

**The second is the public API key.** This is the one place the labels have
changed over time, so go by meaning rather than by name. You want the key
described as **public**, **publishable**, or **anon** — the one Supabase says is
safe to use in a browser or mobile app. It's a long string.

> 🚫 **Do not use the key marked `service_role` or `secret`.** That one bypasses
> every security rule in the database. It belongs on a server, never in a web
> page. If a key's description contains the words "secret", "service role", or
> "never expose", it's the wrong one.
>
> The public key being visible in your page source is normal and expected. The
> database is protected by rules that live *inside* the database (see
> [README](README.md#kids-cant-approve-their-own-work)), not by hiding this key.

**3.3** Open `config.js` in this project and fill it in:

```js
export const CONFIG = {
  mode: 'supabase',
  supabaseUrl: 'https://abcdefghijklmnop.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6...',
  vapidPublicKey: '',
};
```

Three things to get right:
- `mode` changes from `'local'` to `'supabase'` — this is the actual switch
- Keep the quotes around both values
- No trailing slash on the URL

**3.4** Reload the app.

✅ **You'll know it worked when** Parent → Settings no longer says "Running in
demo mode" at the bottom, and instead names your Supabase project. Two browser
windows open side by side will now update each other live — mark a chore done in
one and watch the other's badge change without a refresh.

---

## Part 4 — Put it online so the tablets can reach it

Running `python3 -m http.server` on your laptop only works while your laptop is
on and only on your home wifi. For the girls' tablets you want a real web
address.

### If your GitHub repo is public: GitHub Pages

1. In your repo on GitHub, go to **Settings → Pages**.
2. Under **Source**, choose **Deploy from a branch**.
3. Pick your branch and the folder **`/ (root)`**. Click **Save**.
4. Wait a minute. The page will show your URL, like
   `https://mcnettkyle-rgb.github.io/chore-tracker/`.

**Is a public repo a privacy problem?** Less than you'd think. Your daughters'
names, chores, and balances live in the *database*, not in the repo — the repo
only contains the sample names `Ava` and `Mia`. The only personal thing in the
code is your Supabase URL and public key in `config.js`, which are safe to
publish by design.

### If your repo is private

GitHub Pages needs a paid plan for private repos. Free alternatives that work
with private repos:

- **Cloudflare Pages** — connect the repo, no build command, output directory `/`
- **Netlify** — same, "no build" / publish directory `.`

Both are free and take about the same five minutes.

---

## Part 5 — Set up the tablets

On **each** device (both girls' tablets and your phone):

1. Open the URL in the browser.
2. **Add to Home Screen:**
   - **iPad/iPhone:** Share button (□ with ↑) → *Add to Home Screen*
   - **Android:** ⋮ menu → *Install app* or *Add to Home screen*
3. Open it from the new icon. It runs fullscreen, without browser chrome.
4. Tap the child's tile. **That tablet now remembers who it belongs to** and
   opens straight to their chores.

On your own phone, tap **Parent** instead and set a PIN when prompted.

> On iPhone and iPad, adding to the home screen isn't just cosmetic — Safari
> refuses to send notifications to a normal browser tab. If you want to be
> pinged, you must open it from the icon.

---

## Part 6 — First run

1. Open the parent screen. On the very first unlock there's no PIN yet, so
   **any four digits get you in** — it then immediately asks you to choose a
   real one. Do this before handing a tablet to anyone. Six digits is meaningfully
   better than four.
2. **Settings → Children** — rename Ava and Mia, pick their colours and avatars.
3. **Schedule → Chores** — tap each sample chore to change what it's worth, who
   does it, and which days. Archive the ones that don't apply. Add your own.
4. Hand over the tablets.

---

## Part 7 — Notifications (optional, do it later)

Skip this on day one. The app already shows a live count of what's waiting on
the parent screen; this part is only about making your phone buzz.

It needs a terminal and about 15 minutes. Full instructions are in
[README → Phone notifications](README.md#phone-notifications-optional).

---

## Doing this without a terminal

If you've never used Git, skip it. Everything above can be done from
github.com in a browser.

### Getting the contents of a file to paste into Supabase

Every file has a **Raw** button on GitHub, which shows it as plain text with no
formatting or line numbers. That's the version you want to copy.

1. Open the file on GitHub and click **Raw** (top right of the file view).
2. `Ctrl+A` then `Ctrl+C` (`Cmd` on a Mac) to select and copy all of it.
3. Paste into the Supabase SQL Editor.

That's Part 2 done, with no clone.

### Editing config.js (Part 3)

1. Open `config.js` on GitHub.
2. Click the **pencil icon** (top right) — "Edit this file".
3. Change `mode` to `'supabase'` and paste in your URL and key.
4. Scroll down, click **Commit changes**.

GitHub saves it straight into the repo. If you've set up GitHub Pages, the live
site updates by itself within a minute or two.

### When you'd actually want a terminal

Only if you want to run the app on your own computer before publishing it, or
run the test suites. Neither is needed to get this working on the tablets.

If you do want to: install [Git](https://git-scm.com/downloads) (it is **not**
built into Windows), then open **Command Prompt** on Windows or **Terminal** on
a Mac. Note that this repo's default branch is not the one with the app on it,
so the branch name is required:

```
git clone -b BRANCH-NAME https://github.com/YOUR-NAME/YOUR-REPO.git
```

All on one line. Multi-line commands written with a `\` at the end of each line
are a Mac/Linux convention and will fail in Windows Command Prompt.

---

## Troubleshooting

**"Couldn't start" when the app loads**
The URL or key in `config.js` is wrong. Check for a missing quote, a trailing
slash on the URL, or that you pasted the key into the URL field by mistake.

**`permission denied for table ...` in the app**
`schema.sql` didn't finish — it's the part near the top that grants read access
that you're missing. Re-run the whole file from the top in the SQL Editor; it's
designed to be safe to run repeatedly. This is *not* caused by the
"Automatically expose new tables" setting; the schema grants what it needs
regardless of how that's set.

**`extension "pgcrypto" is not available`**
Rare, and usually means the project hadn't finished provisioning. Wait two
minutes and run the file again.

**The app loads but there are no chores**
You ran `schema.sql` but not `seed.sql`. That's fine — go to
Parent → Schedule → **Add a chore**.

**Chores appear for one kid but not the other**
Each chore needs an assignment per child. Open the chore in
Parent → Schedule and check the "Who does it, and when" section has a row for
each of them.

**Nothing syncs between devices**
`mode` in `config.js` is probably still `'local'`. Settings → bottom of the page
tells you which mode you're actually in.

**"Project paused"**
Supabase pauses free projects after about 7 days with zero activity. Un-pause it
from the dashboard; nothing is lost. Daily family use never triggers this.

**I want to start over**
Run [`supabase/reset.sql`](supabase/reset.sql) in the SQL Editor, then
`schema.sql` and `seed.sql` again. This erases everything — chores, approvals,
balances, payout history — and there's no undo.

Don't use `drop schema public cascade` for this, even though you'll find it
suggested online. It also strips the permissions Supabase granted on the schema,
and the app then fails with "relation does not exist" for every table, which is
a miserable thing to debug. `reset.sql` drops this app's own objects and leaves
those permissions alone.
