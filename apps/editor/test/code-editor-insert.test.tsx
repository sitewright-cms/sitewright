import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { CodeEditor, type CodeEditorHandle } from '../src/lib/code-editor';

/**
 * Mount the editor and hand back its imperative handle plus the latest emitted value.
 *
 * `caret` places the cursor by selecting a zero-width range, which is what the Library's insert acts
 * on. `selectRange` is the same call the preview's click-to-code uses, so a non-empty range here
 * doubles as "insert over a selection".
 */
function mount(initial: string) {
  const ref = createRef<CodeEditorHandle>();
  let value = initial;
  const onChange = vi.fn((next: string) => {
    value = next;
  });
  render(<CodeEditor ref={ref} value={initial} onChange={onChange} ariaLabel="Template source" />);
  return {
    ref,
    latest: () => value,
    caret: (at: number) => act(() => ref.current?.selectRange(at, at)),
    select: (from: number, to: number) => act(() => ref.current?.selectRange(from, to)),
    insert: (text: string) => act(() => ref.current?.insertAtCursor(text)),
  };
}

describe('CodeEditor insertAtCursor', () => {
  it('inserts at the caret', () => {
    const ed = mount('<p class=""></p>');
    ed.caret('<p class="'.length);
    ed.insert('text-sm');
    expect(ed.latest()).toBe('<p class="text-sm"></p>');
  });

  it('adds a separating space so a class cannot weld onto the one before it', () => {
    // The bug this prevents: inserting into class="font-bold|" producing `font-boldtext-sm`, which
    // compiles to nothing and is near-invisible in a long attribute.
    const ed = mount('<p class="font-bold"></p>');
    ed.caret('<p class="font-bold'.length);
    ed.insert('text-sm');
    expect(ed.latest()).toBe('<p class="font-bold text-sm"></p>');
  });

  it('adds a separating space on the trailing side too', () => {
    const ed = mount('<p class="font-bold"></p>');
    ed.caret('<p class="'.length);
    ed.insert('text-sm');
    expect(ed.latest()).toBe('<p class="text-sm font-bold"></p>');
  });

  it('inserts bare against a quote — an empty attribute needs no padding', () => {
    const ed = mount('<p class=""></p>');
    ed.caret('<p class="'.length);
    ed.insert('flex');
    expect(ed.latest()).toBe('<p class="flex"></p>');
  });

  it('inserts bare against existing whitespace, never doubling the space', () => {
    const ed = mount('<p class="a "></p>');
    ed.caret('<p class="a '.length);
    ed.insert('flex');
    expect(ed.latest()).toBe('<p class="a flex"></p>');
  });

  it('replaces the current selection', () => {
    const ed = mount('<p class="text-lg"></p>');
    ed.select('<p class="'.length, '<p class="text-lg'.length);
    ed.insert('text-sm');
    expect(ed.latest()).toBe('<p class="text-sm"></p>');
  });

  it('inserts into an empty document', () => {
    const ed = mount('');
    ed.insert('flex');
    expect(ed.latest()).toBe('flex');
  });
});
