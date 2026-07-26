// Shared UI pieces: dialogs, confirmations, prompts.
//
// Everything returns a Promise so callers read top-to-bottom instead of
// disappearing into callbacks.

import { el, clear, contrastOn } from './util.js';

/**
 * Generic modal. `build(body, helpers)` fills the body and returns a function
 * producing the resolved value, or use helpers.close(value) directly.
 */
export function openDialog({ title, build, confirmLabel = 'Save', cancelLabel = 'Cancel', danger = null, wide = false }) {
  return new Promise((resolve) => {
    const dlg = el('dialog', { class: 'dialog' });
    if (wide) dlg.style.width = 'min(720px, calc(100vw - 28px))';

    let settled = false;
    const close = (value) => {
      if (settled) return;
      settled = true;
      dlg.close();
      dlg.remove();
      resolve(value);
    };

    const body = el('div', { class: 'dialog__body' });
    const getValue = build(body, { close });

    const foot = el('div', { class: `dialog__foot${danger ? ' dialog__foot--spread' : ''}` });

    if (danger) {
      foot.append(el('button', {
        class: 'btn btn--danger',
        type: 'button',
        onclick: () => close({ __danger: true }),
      }, danger));
    }

    const right = el('div', { class: 'spread' });
    right.append(
      el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => close(null) }, cancelLabel),
    );
    if (confirmLabel) {
      right.append(el('button', {
        class: 'btn btn--primary',
        type: 'button',
        onclick: () => {
          const value = getValue ? getValue() : true;
          if (value !== undefined) close(value);   // undefined = validation failed, stay open
        },
      }, confirmLabel));
    }
    foot.append(right);

    dlg.append(el('div', { class: 'dialog__head' }, title), body, foot);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    document.body.append(dlg);
    dlg.showModal();

    const firstInput = body.querySelector('input, select, textarea');
    if (firstInput && !('ontouchstart' in window)) firstInput.focus();
  });
}

export function confirmDialog({ title, message, confirmLabel = 'Yes', cancelLabel = 'Cancel' }) {
  return openDialog({
    title,
    confirmLabel,
    cancelLabel,
    build: (body) => {
      body.append(el('p', { class: 'muted', style: { margin: '0', lineHeight: '1.5' } }, message));
      return () => true;
    },
  }).then((v) => v === true);
}

export function promptDialog({ title, label, hint, value = '', placeholder = '', confirmLabel = 'Save', multiline = false }) {
  return openDialog({
    title,
    confirmLabel,
    build: (body) => {
      const input = multiline
        ? el('textarea', { placeholder })
        : el('input', { type: 'text', placeholder });
      input.value = value;
      const field = el('div', { class: 'field' });
      if (label) field.append(el('label', { class: 'field__label' }, label));
      field.append(input);
      if (hint) field.append(el('div', { class: 'field__hint' }, hint));
      body.append(field);
      return () => input.value;
    },
  });
}

/** The coloured circle+name chip used wherever a kid is referenced. */
export function childChip(child, { size = 26 } = {}) {
  if (!child) return el('span', { class: 'muted' }, 'Unknown');
  return el('span', {
    class: 'review__who',
    style: { background: `${child.color}1f`, color: child.color },
  },
    el('span', {
      class: 'dot',
      style: { background: child.color, color: contrastOn(child.color), width: `${size}px`, height: `${size}px` },
    }, child.emoji),
    child.name,
  );
}

export function emptyState(emoji, title, message) {
  return el('div', { class: 'empty' },
    el('span', { class: 'empty__emoji' }, emoji),
    el('div', { class: 'empty__title' }, title),
    message ? el('div', {}, message) : null,
  );
}

export function section(title, count, ...children) {
  const head = el('div', { class: 'section__head' }, el('h2', { class: 'section__title' }, title));
  if (count !== null && count !== undefined) head.append(el('span', { class: 'section__count' }, count));
  return el('section', { class: 'section' }, head, ...children);
}

/**
 * A section that starts folded away. Used for anything a kid doesn't need to
 * act on right now — a full week of upcoming chores is overwhelming on the
 * screen they're supposed to be working from.
 */
export function foldedSection(title, count, ...children) {
  return el('details', { class: 'section fold' },
    el('summary', { class: 'fold__summary' },
      el('span', { class: 'section__title' }, title),
      count !== null && count !== undefined ? el('span', { class: 'section__count' }, count) : null,
    ),
    ...children,
  );
}

export { el, clear };
