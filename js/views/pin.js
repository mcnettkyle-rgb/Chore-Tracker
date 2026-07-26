// The parent PIN pad.
//
// A numeric keypad rather than a text field: it's faster on a tablet, and it
// makes it obvious to a kid that this door is not for them.

import { el } from '../util.js';
import { db } from '../data.js';

const MAX = 10;
const MIN = 4;

/**
 * Ask for the PIN and unlock a parent session.
 * Resolves with a session token, or null if cancelled.
 */
export function openPinPad({ title = 'Parent PIN', subtitle = null } = {}) {
  return new Promise((resolve) => {
    const dlg = el('dialog');
    let pin = '';
    let busy = false;

    const dots = el('div', { class: 'pin-dots' });
    const error = el('div', { class: 'pin-error' });
    const pad = el('div', { class: 'pinpad' });

    const submitBtn = el('button', { class: 'btn btn--primary', type: 'button', onclick: () => submit() }, 'Unlock');

    const paint = () => {
      dots.replaceChildren(
        ...Array.from({ length: Math.max(MIN, pin.length) }, (_, i) =>
          el('span', { class: `pin-dot${i < pin.length ? ' is-filled' : ''}` })),
      );
      submitBtn.disabled = busy || pin.length < MIN;
    };

    const press = (digit) => {
      if (busy || pin.length >= MAX) return;
      pin += digit;
      error.textContent = '';
      paint();
    };

    const back = () => {
      if (busy) return;
      pin = pin.slice(0, -1);
      paint();
    };

    const fail = (message) => {
      pin = '';
      error.textContent = message;
      paint();
      pad.classList.remove('shake');
      void pad.offsetWidth;          // restart the animation
      pad.classList.add('shake');
    };

    const submit = async () => {
      if (busy || pin.length < MIN) return;
      busy = true;
      submitBtn.disabled = true;
      try {
        const res = await db.parentUnlock(pin);
        if (res?.ok) {
          dlg.close();
          dlg.remove();
          resolve({ token: res.token, needsPinSetup: !!res.needs_pin_setup });
          return;
        }
        if (res?.reason === 'locked') {
          fail('Too many tries. Wait 5 minutes.');
        } else {
          const left = res?.attempts_left;
          fail(left ? `Wrong PIN — ${left} ${left === 1 ? 'try' : 'tries'} left` : 'Wrong PIN');
        }
      } catch (err) {
        fail(err.message || 'Something went wrong');
      } finally {
        busy = false;
        paint();
      }
    };

    const keys = el('div', { class: 'pin-keys' });
    for (const n of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      keys.append(el('button', { class: 'pin-key', type: 'button', onclick: () => press(n) }, n));
    }
    keys.append(
      el('button', { class: 'pin-key pin-key--blank', type: 'button', disabled: true, tabindex: '-1' }, ''),
      el('button', { class: 'pin-key', type: 'button', onclick: () => press('0') }, '0'),
      el('button', { class: 'pin-key', type: 'button', onclick: back, 'aria-label': 'Delete' }, '⌫'),
    );

    pad.append(dots, error, keys);

    // Physical keyboard, for the parent on a laptop.
    const onKey = (e) => {
      if (e.key >= '0' && e.key <= '9') { press(e.key); e.preventDefault(); }
      else if (e.key === 'Backspace') { back(); e.preventDefault(); }
      else if (e.key === 'Enter') { submit(); e.preventDefault(); }
    };
    dlg.addEventListener('keydown', onKey);

    const cancel = () => {
      dlg.close();
      dlg.remove();
      resolve(null);
    };

    dlg.append(
      el('div', { class: 'dialog__head' }, title),
      el('div', { class: 'dialog__body' },
        subtitle ? el('p', { class: 'field__hint', style: { marginTop: '0' } }, subtitle) : null,
        pad,
      ),
      el('div', { class: 'dialog__foot' },
        el('button', { class: 'btn btn--ghost', type: 'button', onclick: cancel }, 'Cancel'),
        submitBtn,
      ),
    );

    dlg.addEventListener('cancel', (e) => { e.preventDefault(); cancel(); });
    document.body.append(dlg);
    dlg.showModal();
    paint();
  });
}

/**
 * Choose a new PIN, entered twice. Resolves with the PIN, or null if cancelled.
 */
export function openSetPin({ title = 'Choose a parent PIN', subtitle = null } = {}) {
  return new Promise((resolve) => {
    const dlg = el('dialog');
    let pin = '';
    let confirming = false;
    let first = '';

    const dots = el('div', { class: 'pin-dots' });
    const error = el('div', { class: 'pin-error' });
    const prompt = el('p', { class: 'field__hint', style: { marginTop: '0', textAlign: 'center' } });
    const pad = el('div', { class: 'pinpad' });
    const nextBtn = el('button', { class: 'btn btn--primary', type: 'button', onclick: () => advance() }, 'Next');

    const paint = () => {
      dots.replaceChildren(
        ...Array.from({ length: Math.max(MIN, pin.length) }, (_, i) =>
          el('span', { class: `pin-dot${i < pin.length ? ' is-filled' : ''}` })),
      );
      prompt.textContent = confirming
        ? 'Enter it once more to confirm.'
        : (subtitle ?? 'Pick 4–10 digits. Six is a good balance of memorable and hard to guess.');
      nextBtn.textContent = confirming ? 'Set PIN' : 'Next';
      nextBtn.disabled = pin.length < MIN;
    };

    const shake = (message) => {
      error.textContent = message;
      pin = '';
      paint();
      pad.classList.remove('shake');
      void pad.offsetWidth;
      pad.classList.add('shake');
    };

    const advance = () => {
      if (pin.length < MIN) return;
      if (!confirming) {
        first = pin;
        pin = '';
        confirming = true;
        error.textContent = '';
        paint();
        return;
      }
      if (pin !== first) {
        confirming = false;
        first = '';
        shake("Those didn't match — start again");
        return;
      }
      dlg.close();
      dlg.remove();
      resolve(pin);
    };

    const press = (d) => { if (pin.length < MAX) { pin += d; error.textContent = ''; paint(); } };
    const back = () => { pin = pin.slice(0, -1); paint(); };

    const keys = el('div', { class: 'pin-keys' });
    for (const n of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      keys.append(el('button', { class: 'pin-key', type: 'button', onclick: () => press(n) }, n));
    }
    keys.append(
      el('button', { class: 'pin-key pin-key--blank', type: 'button', disabled: true, tabindex: '-1' }, ''),
      el('button', { class: 'pin-key', type: 'button', onclick: () => press('0') }, '0'),
      el('button', { class: 'pin-key', type: 'button', onclick: back, 'aria-label': 'Delete' }, '⌫'),
    );

    pad.append(dots, error, keys);

    dlg.addEventListener('keydown', (e) => {
      if (e.key >= '0' && e.key <= '9') { press(e.key); e.preventDefault(); }
      else if (e.key === 'Backspace') { back(); e.preventDefault(); }
      else if (e.key === 'Enter') { advance(); e.preventDefault(); }
    });

    const cancel = () => { dlg.close(); dlg.remove(); resolve(null); };

    dlg.append(
      el('div', { class: 'dialog__head' }, title),
      el('div', { class: 'dialog__body' }, prompt, pad),
      el('div', { class: 'dialog__foot' },
        el('button', { class: 'btn btn--ghost', type: 'button', onclick: cancel }, 'Cancel'),
        nextBtn,
      ),
    );

    dlg.addEventListener('cancel', (e) => { e.preventDefault(); cancel(); });
    document.body.append(dlg);
    dlg.showModal();
    paint();
  });
}
