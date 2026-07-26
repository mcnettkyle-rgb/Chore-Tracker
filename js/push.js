// Web Push registration for parent devices.
//
// Push is per-device, not per-account: you turn it on once on your phone and
// once on your laptop if you want both to buzz.

import { db, CONFIG } from './data.js';

const FLAG = 'chore-tracker-push';

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function pushEnabled() {
  return localStorage.getItem(FLAG) === 'on' && Notification.permission === 'granted';
}

function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function enablePush(parentToken) {
  if (!pushSupported()) throw new Error('This browser cannot do push notifications.');
  if (!CONFIG.vapidPublicKey) {
    throw new Error('No VAPID key in config.js — see the README, "Push notifications".');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notifications were blocked. Allow them in your browser settings and try again.');
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(CONFIG.vapidPublicKey),
  });

  const label = `${navigator.platform || 'device'} · ${new Date().toLocaleDateString()}`;
  await db.registerPush(parentToken, subscription, label);
  localStorage.setItem(FLAG, 'on');
}

export async function disablePush() {
  localStorage.removeItem(FLAG);
  if (!pushSupported()) return;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  try {
    await db.unregisterPush(subscription.endpoint);
  } finally {
    await subscription.unsubscribe();
  }
}
