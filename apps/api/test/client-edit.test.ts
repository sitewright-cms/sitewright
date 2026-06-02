import { describe, it, expect } from 'vitest';
import type { Page } from '@sitewright/schema';
import { assertClientEditAllowed } from '../src/repo/client-edit.js';
import { ForbiddenError } from '../src/repo/context.js';

// A page with one editable node (the RichText) and one locked node (the Heading).
const base = (): Page => ({
  id: 'home',
  path: '/',
  title: 'Home',
  root: {
    id: 'r',
    type: 'Section',
    children: [
      { id: 'h', type: 'Heading', props: { text: 'Locked title', level: 2 } },
      { id: 't', type: 'RichText', editable: true, props: { text: 'Edit me' } },
    ],
  },
});

const clone = (p: Page): Page => JSON.parse(JSON.stringify(p));
const allowed = (mut: (p: Page) => void) => () => {
  const next = clone(base());
  mut(next);
  return assertClientEditAllowed(base(), next);
};
const rejected = (mut: (p: Page) => void) => {
  const next = clone(base());
  mut(next);
  expect(() => assertClientEditAllowed(base(), next)).toThrow(ForbiddenError);
};

describe('assertClientEditAllowed', () => {
  it('allows changing the props of an editable node', () => {
    expect(allowed((p) => { (p.root.children![1]!.props as { text: string }).text = 'New copy'; })).not.toThrow();
  });

  it('allows an unchanged page (no-op save)', () => {
    expect(() => assertClientEditAllowed(base(), base())).not.toThrow();
  });

  it('rejects changing a non-editable node’s props', () => {
    rejected((p) => { (p.root.children![0]!.props as { text: string }).text = 'Hacked title'; });
  });

  it('rejects structural changes (add / remove / reorder children)', () => {
    rejected((p) => { p.root.children!.push({ id: 'x', type: 'Heading', props: {} }); });
    rejected((p) => { p.root.children!.pop(); });
    rejected((p) => { p.root.children!.reverse(); });
  });

  it('rejects changing a node’s type, id, className, or binding', () => {
    rejected((p) => { p.root.children![1]!.type = 'Heading'; });
    rejected((p) => { p.root.children![1]!.id = 'tt'; });
    rejected((p) => { p.root.children![1]!.className = 'bg-red-500'; });
    rejected((p) => { p.root.children![1]!.binding = { mode: 'single', dataset: 'x', match: { field: 'a', equals: 'b' } } as never; });
  });

  it('rejects a client granting itself edit rights (flipping the editable flag)', () => {
    rejected((p) => { p.root.children![0]!.editable = true; (p.root.children![0]!.props as { text: string }).text = 'now editable'; });
    rejected((p) => { delete p.root.children![1]!.editable; });
  });

  it('rejects changing page-level settings (title/path/status/template/nav/seo)', () => {
    rejected((p) => { p.title = 'Renamed'; });
    rejected((p) => { p.path = '/moved'; });
    rejected((p) => { p.status = 'draft'; });
    rejected((p) => { p.template = 'tpl'; });
    rejected((p) => { p.nav = { slots: ['header'] }; });
    rejected((p) => { p.seo = { title: 'X' }; });
  });

  it('rejects changing the collection binding (dataset/param)', () => {
    rejected((p) => { p.collection = { dataset: 'products', param: 'slug' }; });
  });

  it('rejects a client changing the page template source (source is dev-owned)', () => {
    rejected((p) => { p.source = '<section>{{ company.name }}</section>'; });
  });

  it('rejects a client adding content to a BLOCK page (content is a source-page surface only)', () => {
    rejected((p) => { p.content = { sneaky: 'value' }; });
  });
});

// A code-first source page: the client's editable surface is `content` (bound `{{edit}}`
// regions), never the template.
const sourcePage = (): Page => ({
  id: 'home',
  path: '/',
  title: 'Home',
  root: { id: 'r', type: 'Section' },
  source: '<h1>{{edit "headline" "Welcome"}}</h1>',
  content: { headline: 'Current copy' },
});

describe('assertClientEditAllowed — code-first source page', () => {
  it('allows the client to change bound region content', () => {
    const next = clone(sourcePage());
    next.content = { headline: 'Client rewrote the headline' };
    expect(() => assertClientEditAllowed(sourcePage(), next)).not.toThrow();
  });

  it('allows adding content for a new region key', () => {
    const next = clone(sourcePage());
    next.content = { headline: 'Current copy', tagline: 'Added by the client' };
    expect(() => assertClientEditAllowed(sourcePage(), next)).not.toThrow();
  });

  it('still rejects changing the template source (even alongside a content edit)', () => {
    const next = clone(sourcePage());
    next.content = { headline: 'New' };
    next.source = '<h1>{{edit "headline" "Welcome"}}</h1><script>x()</script>';
    expect(() => assertClientEditAllowed(sourcePage(), next)).toThrow(ForbiddenError);
  });

  it('rejects changing page settings on a source page', () => {
    const next = clone(sourcePage());
    next.title = 'Renamed';
    expect(() => assertClientEditAllowed(sourcePage(), next)).toThrow(ForbiddenError);
  });
});
