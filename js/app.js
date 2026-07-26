// Entry point: boot the store, then re-render on every state change.

import { el, clear } from './util.js';
import { state, subscribe, boot } from './store.js';
import { renderPicker } from './views/picker.js';
import { renderKid } from './views/kid.js';
import { renderParent } from './views/parent.js';

const root = document.getElementById('app');

function render() {
  if (!state.ready) return;

  // Preserve scroll across re-renders, otherwise approving a chore near the
  // bottom of the queue throws you back to the top.
  const y = window.scrollY;
  clear(root);

  try {
    if (state.route === 'kid') root.append(renderKid());
    else if (state.route === 'parent') root.append(renderParent());
    else root.append(renderPicker());
  } catch (err) {
    console.error(err);
    root.append(
      el('div', { class: 'empty', style: { marginTop: '40px' } },
        el('span', { class: 'empty__emoji' }, '😕'),
        el('div', { class: 'empty__title' }, 'Something went wrong'),
        el('div', {}, err.message),
      ),
    );
  }

  window.scrollTo(0, y);
}

subscribe(render);

boot().then(render).catch((err) => {
  console.error(err);
  clear(root);
  root.append(
    el('div', { class: 'empty', style: { marginTop: '60px' } },
      el('span', { class: 'empty__emoji' }, '🔌'),
      el('div', { class: 'empty__title' }, "Couldn't start"),
      el('div', {}, err.message),
      el('p', { class: 'hint' },
        'If you are using Supabase, check the URL and anon key in config.js.'),
    ),
  );
});

// Service worker powers the home-screen install and push notifications.
// Harmless when it isn't registered yet.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline install is optional */ });
}
