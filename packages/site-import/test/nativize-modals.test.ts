import { describe, expect, it } from 'vitest';
import { hoistGlobalModals } from '../src/nativize/modals.js';

const modal = (id: string): string => `<dialog id="${id}" data-sw-component="modal"><p>hi ${id}</p></dialog>`;

describe('hoistGlobalModals', () => {
  it('hoists a site-wide modal into bottom + strips it from every page', () => {
    const r = hoistGlobalModals([
      { id: 'p1', html: `<div>a</div>${modal('contact-modal')}` },
      { id: 'p2', html: `<div>b</div>${modal('contact-modal')}` },
      { id: 'p3', html: '<div>c</div>' },
    ]);
    expect(r.bottom).toBe(modal('contact-modal'));
    expect(r.stripped.get('p1')).toBe('<div>a</div>');
    expect(r.stripped.get('p2')).toBe('<div>b</div>');
    expect(r.stripped.has('p3')).toBe(false); // never had it
  });

  it('leaves a page-local modal (single page) in place', () => {
    const r = hoistGlobalModals([
      { id: 'p1', html: `<div>a</div>${modal('local')}` },
      { id: 'p2', html: '<div>b</div>' },
      { id: 'p3', html: '<div>c</div>' },
    ]);
    expect(r.bottom).toBe('');
    expect(r.stripped.size).toBe(0);
  });

  it('hoists the global modal but keeps a page-local one on the same page', () => {
    const r = hoistGlobalModals([
      { id: 'p1', html: `${modal('g')}<div>a</div>${modal('localx')}` },
      { id: 'p2', html: `${modal('g')}<div>b</div>` },
    ]);
    expect(r.bottom).toBe(modal('g'));
    expect(r.stripped.get('p1')).toBe(`<div>a</div>${modal('localx')}`);
    expect(r.stripped.get('p2')).toBe('<div>b</div>');
  });

  it('handles no pages / no modals', () => {
    expect(hoistGlobalModals([]).bottom).toBe('');
    expect(hoistGlobalModals([{ id: 'p1', html: '<div>x</div>' }]).bottom).toBe('');
  });
});
