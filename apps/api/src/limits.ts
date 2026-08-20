import { statfs } from 'node:fs/promises';

/**
 * PROJECT-SCALE LIMITS — the ceilings a WHOLE PROJECT can push against.
 *
 * They live together because they are not independent: a project you can export must also be
 * re-importable, and an archive you may build must be one the instance can actually produce. Split
 * across four files they drifted apart, and the round trip broke in the middle — you could take a
 * backup you could never restore.
 *
 * ★ THE ONLY QUESTION THAT MATTERS FOR EACH: is it bounded by DISK or by MEMORY?
 *
 *  - **Disk / streamed** — the bytes pass through a stream to a temp file and are never held whole.
 *    These are policy, and policy on a box with a terabyte of disk should not stop at half a gigabyte.
 *  - **Memory** — the value is assembled as one object or Buffer. Raising these trades directly
 *    against the instance's RAM ceiling, so each carries the MEASUREMENT it was derived from.
 *
 * Measured on the reference large project (a school site, the biggest real one on the instance):
 *   1,085 pages · 7,907 media assets · 2.9 GB of media originals · 1.25 GB built site
 *   (130 MiB of HTML across 1,085 files + 1.1 GB of assets) · 6.7 MB of TOTAL content JSON.
 *
 * ★ Note the last figure. A project whose media weighs 2.9 GB holds under 7 MB of content — media
 * bytes stream, content bytes do not. That is why the byte ceilings below are large and the COUNT
 * ceilings are merely generous.
 */

/**
 * Ceiling on any whole-project archive this instance will PRODUCE or ACCEPT — the project export
 * zip, the published-site zip, and the import that reads one back.
 *
 * ONE number for all three on purpose: they are the two ends of a round trip. When the export cap was
 * 500 MiB, the site archive 100 MiB and the import 200 MiB, a 1.25 GB site could not be downloaded,
 * a 2.9 GB project could not be backed up, and had either succeeded the result could not have been
 * restored.
 *
 * Every one of those paths STREAMS to (or from) a temp file, so this bounds DISK, not RAM. 32 GiB is
 * ~10× the reference project and still an order of magnitude below the instance's free space; the
 * real disk floor is enforced separately by {@link assertDiskHeadroom}, which fails with a reason
 * instead of an ENOSPC crash.
 */
export const MAX_PROJECT_ARCHIVE_BYTES = 32 * 1024 * 1024 * 1024;

/**
 * Per-file ceiling inside a project archive. Matches the media upload ceiling (200 MiB) — a file that
 * could be uploaded must survive a backup/restore round trip, and a smaller number here would quietly
 * make some projects un-exportable.
 */
export const MAX_ARCHIVE_ENTRY_BYTES = 200 * 1024 * 1024;

/**
 * Ceiling on ENTRIES in a project archive (a zip-bomb guard: entries are cheap to declare and each
 * costs a filesystem write). The reference project holds ~40k (7,907 assets plus their retained
 * variants); 500k leaves room for an order of magnitude more.
 */
export const MAX_ARCHIVE_ENTRIES = 500_000;

/**
 * Free space that must remain on the filesystem holding the temp archive AFTER a build.
 *
 * Without it, {@link MAX_PROJECT_ARCHIVE_BYTES} is a promise the disk may not be able to keep, and
 * the failure surfaces as an ENOSPC mid-write — which reads to the caller as a crash and can take
 * unrelated writes (the database) down with it. With it, the same situation is a 507 naming the
 * shortfall.
 */
export const ARCHIVE_DISK_RESERVE_BYTES = 2 * 1024 * 1024 * 1024;

/** Thrown when a filesystem has too little room to safely build an archive. */
export class DiskSpaceError extends Error {
  constructor(
    readonly availableBytes: number,
    readonly requiredBytes: number,
  ) {
    super(
      `not enough free disk space to build the archive: ${availableBytes} bytes available, ` +
        `${requiredBytes} required (including a ${ARCHIVE_DISK_RESERVE_BYTES}-byte reserve)`,
    );
    this.name = 'DiskSpaceError';
  }
}

/**
 * Refuses up front when `path`'s filesystem cannot hold `wantBytes` plus the reserve.
 *
 * `wantBytes` is an ESTIMATE (a project's media total, a build directory's size) — the point is not
 * precision but catching the obviously-doomed build before it writes a single byte. A filesystem we
 * cannot stat is allowed through: an unreadable `statfs` is not evidence of a full disk, and refusing
 * on it would break archives on platforms that do not implement it.
 */
export async function assertDiskHeadroom(path: string, wantBytes: number): Promise<void> {
  let available: number;
  try {
    const fs = await statfs(path);
    available = Number(fs.bavail) * Number(fs.bsize);
  } catch {
    return;
  }
  if (!Number.isFinite(available) || available <= 0) return;
  const required = wantBytes + ARCHIVE_DISK_RESERVE_BYTES;
  if (available < required) throw new DiskSpaceError(available, required);
}
