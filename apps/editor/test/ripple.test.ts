import { describe, it, expect, afterEach, vi } from 'vitest';
import { installRipple } from '../src/lib/ripple';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

/** Dispatch a pointerdown on an element (jsdom has no PointerEvent → use a MouseEvent shim). */
function pointerDown(el: Element) {
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
}

describe('installRipple (delegated waves runtime)', () => {
  it('spawns a ripple span inside the nearest .waves-effect on pointerdown', () => {
    const btn = document.createElement('button');
    btn.className = 'waves-effect';
    btn.append(document.createElement('span')); // an inner child — the event target
    document.body.append(btn);
    const cleanup = installRipple();

    pointerDown(btn.firstChild as Element); // target a descendant → closest() walks up
    expect(btn.querySelector('.waves-ripple')).not.toBeNull();

    cleanup();
  });

  it('ignores clicks outside any .waves-effect', () => {
    const plain = document.createElement('button');
    document.body.append(plain);
    const cleanup = installRipple();
    pointerDown(plain);
    expect(document.querySelector('.waves-ripple')).toBeNull();
    cleanup();
  });

  it('does not ripple a disabled .waves-effect control', () => {
    const btn = document.createElement('button');
    btn.className = 'waves-effect';
    btn.disabled = true;
    document.body.append(btn);
    const cleanup = installRipple();
    pointerDown(btn);
    expect(btn.querySelector('.waves-ripple')).toBeNull();
    cleanup();
  });

  it('cleanup removes the listener (no ripple after teardown)', () => {
    const btn = document.createElement('button');
    btn.className = 'waves-effect';
    document.body.append(btn);
    installRipple()(); // install then immediately tear down
    pointerDown(btn);
    expect(btn.querySelector('.waves-ripple')).toBeNull();
  });

  it('is a no-op under prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addListener() {}, removeListener() {} }));
    const btn = document.createElement('button');
    btn.className = 'waves-effect';
    document.body.append(btn);
    const cleanup = installRipple();
    pointerDown(btn);
    expect(btn.querySelector('.waves-ripple')).toBeNull();
    cleanup();
  });
});
