import { describe, it, expect } from 'vitest';
import type { Template } from '@sitewright/schema';
import {
  GLOBAL_TEMPLATES,
  GLOBAL_TEMPLATE_PREFIX,
  isGlobalTemplate,
  resolveTemplateSource,
  TemplateResolutionError,
} from '../src/index.js';

const projectTemplates = new Map<string, Template>([
  ['legal', { id: 'legal', name: 'Legal', source: '<article>{{edit "body" "…"}}</article>' }],
]);

describe('resolveTemplateSource (code-first templates)', () => {
  it('resolves a project template to its Handlebars source', () => {
    expect(resolveTemplateSource('legal', projectTemplates)).toContain('{{edit "body"');
  });

  it('resolves built-in global templates by prefix', () => {
    for (const template of GLOBAL_TEMPLATES) {
      expect(isGlobalTemplate(template.id)).toBe(true);
      expect(resolveTemplateSource(template.id, new Map())).toBe(template.source);
    }
  });

  it('throws an author-correctable error for unknown references (never a blank page)', () => {
    expect(() => resolveTemplateSource('missing', projectTemplates)).toThrow(TemplateResolutionError);
    expect(() => resolveTemplateSource('global:missing', projectTemplates)).toThrow(TemplateResolutionError);
  });

  it('global templates are valid, content-editable, code-first sources', () => {
    for (const template of GLOBAL_TEMPLATES) {
      expect(template.id.startsWith(GLOBAL_TEMPLATE_PREFIX)).toBe(true);
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.source).toContain('{{edit '); // a referencing page can edit its content
      expect(template.source).not.toContain('<script'); // same no-JS rule as page sources
    }
  });
});
