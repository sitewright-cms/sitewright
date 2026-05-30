import { describe, it, expect } from 'vitest';
import type { PageNode, Template } from '@sitewright/schema';
import { resolveTemplate, TemplateResolutionError } from '../src/index.js';

const pageRoot: PageNode = {
  id: 'p',
  type: 'Section',
  children: [{ id: 'h', type: 'Heading', props: { text: 'Hi' } }],
};
const tmpl = (root: PageNode): Template => ({ id: 't1', name: 'T', root });
const map = (t: Template) => new Map([[t.id, t]]);

describe('resolveTemplate', () => {
  it('returns the page root unchanged when no templateId', () => {
    expect(resolveTemplate(pageRoot, undefined, new Map())).toBe(pageRoot);
  });

  it('injects the page root at the template Outlet, preserving layout order', () => {
    const t = tmpl({
      id: 'troot',
      type: 'Layout',
      children: [
        { id: 'hdr', type: 'Header' },
        { id: 'out', type: 'Outlet' },
        { id: 'ftr', type: 'Footer' },
      ],
    });
    const result = resolveTemplate(pageRoot, 't1', map(t));
    expect(result.type).toBe('Layout');
    expect(result.children?.map((c) => c.type)).toEqual(['Header', 'Section', 'Footer']);
    expect(result.children?.[1]).toBe(pageRoot); // the outlet became the page content
  });

  it('finds a nested Outlet', () => {
    const t = tmpl({
      id: 'troot',
      type: 'Layout',
      children: [{ id: 'main', type: 'Section', children: [{ id: 'o', type: 'Outlet' }] }],
    });
    const result = resolveTemplate(pageRoot, 't1', map(t));
    expect(result.children?.[0]?.children?.[0]).toBe(pageRoot);
  });

  it('treats a template whose root IS an Outlet as an identity wrap (returns the page root)', () => {
    const t = tmpl({ id: 'o', type: 'Outlet' });
    expect(resolveTemplate(pageRoot, 't1', map(t))).toBe(pageRoot);
  });

  it('throws on an unknown template', () => {
    expect(() => resolveTemplate(pageRoot, 'missing', new Map())).toThrow(TemplateResolutionError);
  });

  it('throws when the template has zero or multiple Outlets', () => {
    const none = tmpl({ id: 'r', type: 'Layout', children: [{ id: 'hdr', type: 'Header' }] });
    expect(() => resolveTemplate(pageRoot, 't1', map(none))).toThrow(/exactly one Outlet/);
    const two = tmpl({
      id: 'r',
      type: 'Layout',
      children: [
        { id: 'o1', type: 'Outlet' },
        { id: 'o2', type: 'Outlet' },
      ],
    });
    expect(() => resolveTemplate(pageRoot, 't1', map(two))).toThrow(/exactly one Outlet/);
  });
});
