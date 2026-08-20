// RANDOM-ACCESS reader for a PROJECT export zip held on DISK.
//
// ★ WHY NOT JSZip, WHICH THE REST OF THE IMPORT PATH USES. JSZip parses from a Buffer, so reading a
// project archive meant holding the whole compressed archive in memory — and the multipart upload
// that produced it was buffered too (`file.toBuffer()`). Two full copies of the archive in RAM is
// survivable at the old 200 MiB upload cap and impossible at the size a real project actually
// reaches: the reference large project exports to ~2.9 GB, on an instance with a fraction of that in
// RAM. The cap was not protecting the import, it WAS the import's ceiling — and it sat well below the
// export's, so a backup could be taken and never restored.
//
// yauzl reads the central directory from a file descriptor and opens one entry at a time, so nothing
// larger than a single entry is ever resident. The same zip-bomb and zip-slip defenses apply: entries
// are counted, each decompressed stream is byte-bounded as it flows, the running total is bounded,
// and every path is normalized before it reaches the filesystem.
import { open as openZip, type Entry, type ZipFile } from 'yauzl';
import { UploadError } from './upload.js';

/** An opened archive plus its entries, indexed by name. `close` releases the file descriptor. */
export interface OpenProjectZip {
  entries: Map<string, Entry>;
  /** Reads ONE entry fully, refusing past `maxBytes` — for the small JSON documents only. */
  readEntry: (name: string, maxBytes: number) => Promise<Buffer>;
  /** Streams one entry through `onChunk`, refusing past `maxBytes`. Returns the bytes read. */
  streamEntry: (name: string, maxBytes: number, onChunk: (chunk: Buffer) => void) => Promise<number>;
  close: () => void;
}

/**
 * Opens a zip from disk and indexes its central directory.
 *
 * `lazyEntries` keeps the walk pull-driven so the entry count is bounded as it is read rather than
 * after — an archive declaring millions of entries is refused before the map grows to match.
 */
export function openProjectZipFile(path: string, maxEntries: number): Promise<OpenProjectZip> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- private temp path written by the upload handler
    openZip(path, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(new UploadError('not a valid zip archive'));
        return;
      }
      const entries = new Map<string, Entry>();
      let failed = false;
      const fail = (e: Error): void => {
        if (failed) return;
        failed = true;
        zipfile.close();
        reject(e);
      };

      zipfile.on('error', () => fail(new UploadError('not a valid zip archive')));
      zipfile.on('entry', (entry: Entry) => {
        if (entries.size >= maxEntries) {
          fail(new UploadError('archive has too many entries'));
          return;
        }
        // Directory entries carry a trailing slash and no content — index files only.
        if (!entry.fileName.endsWith('/')) entries.set(entry.fileName, entry);
        zipfile.readEntry();
      });
      zipfile.on('end', () => {
        if (failed) return;
        resolve(makeHandle(zipfile, entries));
      });
      zipfile.readEntry();
    });
  });
}

function makeHandle(zipfile: ZipFile, entries: Map<string, Entry>): OpenProjectZip {
  const streamEntry = (name: string, maxBytes: number, onChunk: (chunk: Buffer) => void): Promise<number> =>
    new Promise((resolve, reject) => {
      const entry = entries.get(name);
      if (!entry) {
        reject(new UploadError(`archive entry is missing: ${name}`));
        return;
      }
      // ★ The DECLARED size is a claim by the archive, checked here only as a cheap pre-filter. The
      // running count below is what actually enforces the bound, because a lying header is exactly
      // how a zip bomb works.
      if (entry.uncompressedSize > maxBytes) {
        reject(new UploadError('an archive entry exceeds the per-entry size limit'));
        return;
      }
      zipfile.openReadStream(entry, (err, stream) => {
        if (err || !stream) {
          reject(new UploadError('archive entry could not be read'));
          return;
        }
        let total = 0;
        stream.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            stream.destroy();
            reject(new UploadError('an archive entry exceeds the per-entry size limit'));
            return;
          }
          onChunk(chunk);
        });
        stream.on('error', () => reject(new UploadError('archive entry could not be read')));
        stream.on('end', () => resolve(total));
      });
    });

  return {
    entries,
    readEntry: async (name, maxBytes) => {
      const parts: Buffer[] = [];
      await streamEntry(name, maxBytes, (chunk) => parts.push(chunk));
      return Buffer.concat(parts);
    },
    streamEntry,
    close: () => zipfile.close(),
  };
}
