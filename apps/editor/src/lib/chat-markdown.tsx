import { type ReactNode } from 'react';

/**
 * A tiny, SAFE markdown renderer for the AI chat bubbles — handles the light formatting the agent
 * uses (bold, italic, inline code, links, bullet + numbered lists, fenced code blocks) by building
 * React nodes. No `dangerouslySetInnerHTML`, so model output can never inject HTML; unknown syntax
 * falls through as plain text. Not a full CommonMark parser — deliberately minimal.
 */

/** Only allow safe link schemes (http/https/mailto/tel) or a relative path — never javascript:/data:. */
function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  if (/^[/#]/.test(u)) return u; // relative / anchor
  return null;
}

/** Inline: `code`, **bold**, *italic* / _italic_, [text](url). */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith('`')) {
      nodes.push(
        <code key={key} className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em] text-slate-800">{tok.slice(1, -1)}</code>,
      );
    } else if (tok.startsWith('**')) {
      nodes.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('*') || tok.startsWith('_')) {
      nodes.push(<em key={key}>{tok.slice(1, -1)}</em>);
    } else {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      const href = lm ? safeHref(lm[2]!) : null;
      if (lm && href) {
        nodes.push(
          <a key={key} href={href} target="_blank" rel="noreferrer noopener" className="text-indigo-600 underline">{lm[1]}</a>,
        );
      } else {
        nodes.push(tok);
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function ChatMarkdown({ text }: { text: string }): ReactNode {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    // Fenced code block: ``` … ```
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) body.push(lines[i++]!);
      i++; // closing fence
      blocks.push(
        <pre key={key++} className="my-1 overflow-x-auto rounded-lg bg-slate-900/90 p-2 text-xs text-slate-100">
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    // Bullet list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*[-*]\s+/, ''));
      blocks.push(
        <ul key={key++} className="my-1 list-disc space-y-0.5 pl-5">
          {items.map((it, j) => (<li key={j}>{renderInline(it, `ul${key}-${j}`)}</li>))}
        </ul>,
      );
      continue;
    }
    // Numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*\d+\.\s+/, ''));
      blocks.push(
        <ol key={key++} className="my-1 list-decimal space-y-0.5 pl-5">
          {items.map((it, j) => (<li key={j}>{renderInline(it, `ol${key}-${j}`)}</li>))}
        </ol>,
      );
      continue;
    }
    // Blank line → skip (paragraph separator)
    if (line.trim() === '') {
      i++;
      continue;
    }
    // Paragraph: gather consecutive non-blank, non-list lines
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '' && !/^\s*([-*]\s+|\d+\.\s+|```)/.test(lines[i]!)) {
      para.push(lines[i++]!.replace(/^#{1,6}\s+/, '')); // strip heading markers → plain emphasis line
    }
    blocks.push(
      <p key={key++} className="whitespace-pre-wrap">{renderInline(para.join('\n'), `p${key}`)}</p>,
    );
  }
  return <div className="flex flex-col gap-1">{blocks}</div>;
}
