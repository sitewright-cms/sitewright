import { Parser } from 'htmlparser2';

/**
 * A WebDAV response (`207 Multi-Status`) as a small tree, element names by their LOCAL name (`d:href`, `D:href`
 * and `href` are one): servers pick their own prefixes, and the few names CalDAV uses do not clash across its
 * namespaces. Entities are decoded; text is kept per element. Bounded by the caller's response size.
 */
export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const local = (name: string): string => name.slice(name.indexOf(':') + 1).toLowerCase();

/** Bounds on a document: nesting (the walkers below recurse) and elements (each is an object). */
export const XML_LIMITS = { depth: 64, nodes: 200_000 } as const;

export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let nodes = 0;
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        // ★ A tenant chooses the server: a document nested or sized to exhaust the stack or the heap is refused.
        nodes += 1;
        if (stack.length > XML_LIMITS.depth || nodes > XML_LIMITS.nodes) throw new Error('the document is too deep or too large');
        const node: XmlNode = { name: local(name), attrs, children: [], text: '' };
        stack[stack.length - 1]!.children.push(node);
        stack.push(node);
      },
      ontext(text) {
        stack[stack.length - 1]!.text += text;
      },
      onclosetag() {
        if (stack.length > 1) stack.pop();
      },
    },
    { xmlMode: true, decodeEntities: true },
  );
  parser.write(xml);
  parser.end();
  return root;
}

/** The first descendant with this local name (depth first), if any. */
export function find(node: XmlNode, name: string): XmlNode | undefined {
  for (const child of node.children) {
    if (child.name === name) return child;
    const deeper = find(child, name);
    if (deeper) return deeper;
  }
  return undefined;
}

/** Every descendant with this local name. */
export function findAll(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const child of node.children) {
    if (child.name === name) out.push(child);
    findAll(child, name, out);
  }
  return out;
}

/** An element's text, its descendants' included, trimmed. */
export function textOf(node: XmlNode | undefined): string {
  if (!node) return '';
  return (node.text + node.children.map(textOf).join('')).trim();
}

/** The `<response>` elements of a multistatus whose `<propstat>` is a 2xx, with their href and properties. */
export function okResponses(root: XmlNode): Array<{ href: string; prop: XmlNode }> {
  const out: Array<{ href: string; prop: XmlNode }> = [];
  for (const response of findAll(root, 'response')) {
    const href = textOf(response.children.find((c) => c.name === 'href'));
    for (const propstat of response.children.filter((c) => c.name === 'propstat')) {
      const status = textOf(propstat.children.find((c) => c.name === 'status'));
      const prop = propstat.children.find((c) => c.name === 'prop');
      if (prop && /\s2\d\d\s/.test(` ${status} `)) out.push({ href, prop });
    }
  }
  return out;
}
