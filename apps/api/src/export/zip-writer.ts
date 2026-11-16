import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';

/** One archive entry: a file on disk (streamed, never read whole) or bytes already in hand. */
export type ZipEntry = { name: string; path: string } | { name: string; data: string | Buffer };

/**
 * Formats that are already compressed. Deflating them again saves nothing and costs the most CPU of any
 * entry, so they get zlib's FASTEST level — never "stored": a stored entry of unknown size needs a data
 * descriptor, and Java's `ZipInputStream` refuses that combination ("only DEFLATED entries can have EXT
 * descriptor"), which is how storing photos broke a streaming reader once before.
 */
const PRECOMPRESSED = /\.(?:jpe?g|png|webp|avif|gif|woff2?|mp4|webm|mov|m4v|mp3|m4a|ogg|opus|zip|gz|br|pdf)$/i;

/**
 * Write a zip to `outPath` and return its size, aborting with `tooLarge()` the moment the archive would
 * pass `maxBytes`.
 *
 * ★ Compression runs in Node's zlib, on the libuv thread pool — NOT on the event loop. The JSZip writer
 * this replaces deflated every byte in JavaScript (pako) on the main thread: under several agents' load a
 * profile put it at 9-12% of the thread every other request waits for, and a 230 MB export kept that
 * thread busy for ~8 s. Entries are DEFLATE (the format every reader handles); file entries are
 * world-readable (0644) because a site archive is unpacked onto web servers, and the stored media files'
 * own modes must not leak into it.
 *
 * ★ Every file this opens is tracked and destroyed on failure. yazl has no abort: when the output is torn
 * down (the size cap, a missing file) it leaves the entry it was reading piped into nothing, paused, with
 * its file descriptor open for good — one leaked descriptor per over-size export, measured.
 */
export async function writeZipFile(
  entries: Iterable<ZipEntry>,
  outPath: string,
  maxBytes: number,
  tooLarge: () => Error,
): Promise<number> {
  const zip = new ZipFile();
  const opened = new Set<ReadStream>();
  let total = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _enc, done): void {
      total += chunk.length;
      if (total > maxBytes) {
        done(tooLarge());
        return;
      }
      done(null, chunk);
    },
  });
  // yazl reports a bad input on the ZipFile, and an input file's own errors come from its read stream.
  let fail!: (err: unknown) => void;
  const failed = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  zip.on('error', (err: unknown) => fail(err));
  const out = createWriteStream(outPath);
  const written = pipeline(zip.outputStream, cap, out);
  // Whichever loses the race below may still settle later (a stream torn down after an error); that is
  // expected, and must never surface as an unhandled rejection — which would take the process down.
  failed.catch(() => {});
  written.catch(() => {});
  try {
    for (const entry of entries) {
      const options = { mode: 0o100644, compressionLevel: PRECOMPRESSED.test(entry.name) ? 1 : 6 };
      if ('path' in entry) {
        // Opened only when yazl reaches this entry, so a 20k-file archive holds one descriptor at a time.
        zip.addReadStreamLazy(entry.name, options, (cb) => {
          const stream = createReadStream(entry.path);
          opened.add(stream);
          stream.once('close', () => opened.delete(stream));
          stream.once('error', (err) => fail(err));
          cb(null, stream);
        });
      } else {
        zip.addBuffer(typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data, entry.name, options);
      }
    }
    zip.end();
    await Promise.race([written, failed]);
  } catch (err) {
    // Tear down everything this opened: the output, the cap, and any input still being read.
    (zip.outputStream as Readable).destroy();
    cap.destroy();
    out.destroy();
    for (const stream of opened) stream.destroy();
    opened.clear();
    throw err;
  }
  return total;
}
