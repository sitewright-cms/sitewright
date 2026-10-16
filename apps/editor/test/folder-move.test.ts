import { describe, it, expect } from 'vitest';
import { folderMoveFailure } from '../src/views/files/folder-move';

// A folder rename/move re-files every asset under it, one by one, and reports the ones it could not
// (`failed`). The editor read only `ok` — which used to be true even then — so a partial re-file looked
// like a success while some files stayed under the old name. This is the message it now shows.
describe('folderMoveFailure', () => {
  const assets = [
    { id: 'a', filename: 'harbour.png' },
    { id: 'b', filename: 'boats.jpg' },
    { id: 'c', filename: 'nets.jpg' },
    { id: 'd', filename: 'pier.jpg' },
    { id: 'e', filename: 'gulls.jpg' },
  ];
  const fail = (...ids: string[]) => ids.map((id) => ({ id, error: 'the entity kept changing' }));

  it('is null when every file moved', () => {
    expect(folderMoveFailure([], assets)).toBeNull();
  });

  it('names the file that could not be moved and says to try again', () => {
    expect(folderMoveFailure(fail('a'), assets)).toBe('1 file could not be moved — try again (harbour.png).');
  });

  it('names the first three of many, then counts the rest', () => {
    expect(folderMoveFailure(fail('a', 'b', 'c', 'd', 'e'), assets)).toBe(
      '5 files could not be moved — try again (harbour.png, boats.jpg, nets.jpg and 2 more).',
    );
  });

  it('falls back to the id for a file the editor does not know', () => {
    expect(folderMoveFailure(fail('zz'), assets)).toBe('1 file could not be moved — try again (zz).');
  });
});
