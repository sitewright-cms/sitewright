import type { PageNode, Template } from '@sitewright/schema';
import { TemplateResolutionError } from './errors.js';

/**
 * Wraps a page's content tree in its template layout. The template tree must
 * contain exactly one `Outlet` node (`type === 'Outlet'`), which is replaced by
 * `pageRoot`. Returns `pageRoot` unchanged when `templateId` is undefined.
 *
 * Runs BEFORE partial expansion, so a template may itself contain `partialRef`s.
 * Throws {@link TemplateResolutionError} on a missing template or a template
 * with zero or multiple Outlet nodes (an ambiguous injection point).
 */
export function resolveTemplate(
  pageRoot: PageNode,
  templateId: string | undefined,
  templates: ReadonlyMap<string, Template>,
): PageNode {
  if (templateId === undefined) return pageRoot;
  const template = templates.get(templateId);
  if (template === undefined) {
    throw new TemplateResolutionError(`unknown template: ${templateId}`);
  }

  let outlets = 0;
  const inject = (node: PageNode): PageNode => {
    if (node.type === 'Outlet') {
      outlets += 1;
      return pageRoot; // the page's content replaces the outlet (its own id is preserved)
    }
    if (!node.children) return node;
    return { ...node, children: node.children.map(inject) };
  };
  const root = inject(template.root);
  if (outlets !== 1) {
    throw new TemplateResolutionError(
      `template "${templateId}" must contain exactly one Outlet (found ${outlets})`,
    );
  }
  return root;
}
