// Edge Function: tell the parent something is waiting to be checked.
//
// Invoked by the chore_submitted_notify trigger in notifications.sql. It reads
// the *whole* current queue rather than just the chore that triggered it, so a
// burst of submissions produces one accurate message instead of a stream of
// stale ones.
//
// Deploy:
//   supabase functions deploy notify --no-verify-jwt
//
// Required secrets (see README):
//   NOTIFY_SECRET        shared with private_config.notify_secret
//   VAPID_PUBLIC_KEY     public half, also goes in config.js
//   VAPID_PRIVATE_KEY    private half, never leaves the server
//   VAPID_SUBJECT        "mailto:you@example.com"
//   RESEND_API_KEY       only needed for email
//   RESEND_FROM          e.g. "Chores <chores@yourdomain.com>"
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const env = (key: string) => Deno.env.get(key) ?? '';

const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

interface Settings {
  notify_push?: boolean;
  notify_email?: boolean;
  notify_email_to?: string;
  quiet_hours_start?: number;
  quiet_hours_end?: number;
  timezone?: string;
  currency_symbol?: string;
}

function money(cents: number, symbol = '$') {
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

/** Local hour in the household's timezone, so quiet hours mean what they say. */
function localHour(timezone: string): number {
  try {
    return Number(
      new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone })
        .format(new Date()),
    );
  } catch {
    return new Date().getUTCHours();
  }
}

function inQuietHours(settings: Settings): boolean {
  const start = settings.quiet_hours_start;
  const end = settings.quiet_hours_end;
  if (start === undefined || end === undefined || start === end) return false;

  const hour = localHour(settings.timezone || 'UTC');
  // Windows that cross midnight (e.g. 21 → 7) need the OR form.
  return start > end ? (hour >= start || hour < end) : (hour >= start && hour < end);
}

async function sendEmail(settings: Settings, subject: string, lines: string[]) {
  const apiKey = env('RESEND_API_KEY');
  const from = env('RESEND_FROM');
  const to = settings.notify_email_to?.trim();

  if (!apiKey || !from || !to) return { skipped: 'email not configured' };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text: lines.join('\n'),
      html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">
               ${lines.map((l) => `<div>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).join('')}
             </div>`,
    }),
  });

  return res.ok ? { sent: true } : { error: `resend ${res.status}: ${await res.text()}` };
}

async function sendPush(title: string, body: string) {
  const publicKey = env('VAPID_PUBLIC_KEY');
  const privateKey = env('VAPID_PRIVATE_KEY');
  if (!publicKey || !privateKey) return { skipped: 'VAPID keys not configured' };

  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:parent@example.com', publicKey, privateKey);

  const { data: subs } = await supabase.from('push_subscriptions').select('*');
  if (!subs?.length) return { skipped: 'no devices registered' };

  const payload = JSON.stringify({ title, body, tag: 'chore-review', url: '/' });
  let sent = 0;
  const stale: string[] = [];

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      sent++;
    } catch (err) {
      // 404/410 mean the browser threw the subscription away — forget it too,
      // otherwise dead endpoints pile up forever.
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) stale.push(sub.endpoint);
      else console.error('push failed', sub.endpoint, err);
    }
  }));

  if (stale.length) {
    await supabase.from('push_subscriptions').delete().in('endpoint', stale);
  }

  return { sent, removed: stale.length };
}

Deno.serve(async (req) => {
  // The trigger proves it's us with a shared secret. The function is deployed
  // with --no-verify-jwt so pg_net can reach it without a user token.
  const expected = env('NOTIFY_SECRET');
  if (expected && req.headers.get('x-notify-secret') !== expected) {
    return new Response('forbidden', { status: 403 });
  }

  const [{ data: household }, { data: queue }, { data: children }] = await Promise.all([
    supabase.from('household_public').select('settings').limit(1).single(),
    supabase.from('chore_instances').select('*').eq('status', 'submitted'),
    supabase.from('children').select('id, name'),
  ]);

  const settings: Settings = household?.settings ?? {};
  const items = queue ?? [];

  if (!items.length) {
    return Response.json({ ok: true, skipped: 'queue is empty' });
  }

  const nameOf = new Map((children ?? []).map((c) => [c.id, c.name]));
  const total = items.reduce((sum, i) => sum + i.value_cents, 0);
  const symbol = settings.currency_symbol ?? '$';

  // "Ava (2), Mia (1)"
  const perChild = new Map<string, number>();
  for (const item of items) {
    const name = nameOf.get(item.child_id) ?? 'Someone';
    perChild.set(name, (perChild.get(name) ?? 0) + 1);
  }
  const breakdown = [...perChild.entries()].map(([name, n]) => `${name} (${n})`).join(', ');

  const title = items.length === 1
    ? `${nameOf.get(items[0].child_id) ?? 'Someone'} finished a chore`
    : `${items.length} chores to check`;

  const body = items.length === 1
    ? `${items[0].chore_name} — ${money(items[0].value_cents, symbol)}`
    : `${breakdown} · ${money(total, symbol)} waiting`;

  const quiet = inQuietHours(settings);

  const push = settings.notify_push !== false && !quiet
    ? await sendPush(title, body)
    : { skipped: quiet ? 'quiet hours' : 'push disabled' };

  const email = settings.notify_email !== false
    ? await sendEmail(settings, title, [
        body,
        '',
        ...items.map((i) => `• ${nameOf.get(i.child_id) ?? '?'} — ${i.chore_name} (${money(i.value_cents, symbol)})`),
        '',
        'Open the app to approve or send them back.',
      ])
    : { skipped: 'email disabled' };

  return Response.json({ ok: true, waiting: items.length, push, email });
});
