// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CodeEditorModal } from '../src/views/ui/CodeEditorModal';

/**
 * The code editor behind every website slot, critical CSS and code record.
 *
 * ★ SAVING MUST NOT CLOSE IT. Editing a slot or a stylesheet is iterative — save, look, keep going —
 * and closing on every save turned that loop into a reopen each time, on the surfaces where the loop
 * IS the activity. These tests pin that, and the two things that had to come with it: the Save
 * control disabling once the draft matches what is stored, and a confirm before an Escape or backdrop
 * click can discard uncommitted edits (which only became losable once the modal stopped closing).
 */

// CodeMirror needs layout APIs jsdom lacks; the editor body is not what these tests are about.
vi.mock('../src/lib/code-editor', () => ({
  CodeEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="Source" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const onSave = vi.fn();
const onClose = vi.fn();

const open = (props: Partial<Parameters<typeof CodeEditorModal>[0]> = {}) =>
  render(<CodeEditorModal title="Skeleton" value="<p>a</p>" onSave={onSave} onClose={onClose} {...props} />);

const type = (v: string) => fireEvent.change(screen.getByLabelText('Source'), { target: { value: v } });
const saveBtn = () => screen.getByRole('button', { name: /Save changes/i });

beforeEach(() => {
  vi.clearAllMocks();
  onSave.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('CodeEditorModal', () => {
  it('★ stays OPEN after a successful save', async () => {
    open();
    type('<p>b</p>');
    fireEvent.click(saveBtn());
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('<p>b</p>'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Source')).toBeInTheDocument();
  });

  it('★ stays open after Ctrl+S too — the same commit by another route', async () => {
    open();
    type('<p>b</p>');
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('<p>b</p>'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables Save until there is something to commit, and again once committed', async () => {
    // The disabled control is the real "it went through" signal now that closing is not.
    open();
    expect(saveBtn()).toBeDisabled();
    type('<p>b</p>');
    expect(saveBtn()).toBeEnabled();
    fireEvent.click(saveBtn());
    await waitFor(() => expect(saveBtn()).toBeDisabled());
  });

  it('reports the state: "Unsaved changes" while dirty, "Saved" once it went through', async () => {
    // "Saved" is only honest because a caller that could not persist REJECTS — see the test below.
    open();
    type('<p>b</p>');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    fireEvent.click(saveBtn());
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
  });

  it('★ a REJECTED save leaves the draft dirty and the editor open', async () => {
    // The caller surfaces the error; what must not happen is the editor deciding the work is stored.
    onSave.mockRejectedValue(new Error('server said no'));
    open();
    type('<p>b</p>');
    fireEvent.click(saveBtn());
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(saveBtn()).toBeEnabled(); // still dirty — the baseline did not move
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument(); // never claims a write that failed
  });

  describe('★ closing has to ask, now that it is a way to lose work', () => {
    it('confirms before discarding uncommitted edits', () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      open();
      type('<p>b</p>');
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(confirm).toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled(); // declined → stay
    });

    it('closes without asking when nothing is uncommitted', () => {
      const confirm = vi.spyOn(window, 'confirm');
      open();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(confirm).not.toHaveBeenCalled();
    });

    it('does not ask again after a save has committed the draft', async () => {
      const confirm = vi.spyOn(window, 'confirm');
      open();
      type('<p>b</p>');
      fireEvent.click(saveBtn());
      await waitFor(() => expect(saveBtn()).toBeDisabled());
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(confirm).not.toHaveBeenCalled();
    });
  });

  it('carries the edited NAME through, and counts it as a change', async () => {
    open({ nameEdit: { value: 'hero', label: 'Name' } });
    expect(saveBtn()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'hero-2' } });
    expect(saveBtn()).toBeEnabled(); // a rename alone is a change worth committing
    fireEvent.click(saveBtn());
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('<p>a</p>', 'hero-2'));
  });

  it('blocks the save while the name is invalid', () => {
    open({ nameEdit: { value: 'hero', label: 'Name', validate: (n) => (n ? null : 'required') } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '' } });
    expect(saveBtn()).toBeDisabled();
    expect(screen.getByText('required')).toBeInTheDocument();
  });
});
