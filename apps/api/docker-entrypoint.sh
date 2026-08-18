#!/bin/sh
# Give V8 a heap ceiling derived from the container's ACTUAL memory limit.
#
# Without --max-old-space-size, V8 sizes its old space from HOST RAM — on a 62GB build host that is
# a heap far larger than a 1GiB container can survive, so the kernel OOM-kills the process (measured:
# exit 137, every in-flight request lost) instead of V8 raising a catchable allocation failure.
# The render workers have carried a ceiling for a long time; the main process never did.
#
# ~65% of the limit: the rest is native code (libvips/libsql/lightningcss ~40MB), Chromium when a
# screenshot runs, the render workers, and page cache. An explicit NODE_OPTIONS from the operator
# always wins.
set -e

# Bound glibc's per-thread malloc arenas.
#
# Measured with sharp: ONE thumbnail encode grows RSS ~31MB and the memory survives a forced V8 gc()
# — heap +0.0MB, external +0.0MB — because it is native allocation the allocator keeps, not anything
# V8 owns. Arenas are PER THREAD, so concurrency multiplies them: 20 concurrent encodes cost +170MB
# by default and +94MB with this set (-45%). It does not remove the ~117MB sequential plateau, so
# this is a mitigation, not a cure.
#
# Only set when the operator has not chosen a value.
if [ -z "$MALLOC_ARENA_MAX" ]; then
  MALLOC_ARENA_MAX=2
  export MALLOC_ARENA_MAX
fi

# Use jemalloc instead of glibc's allocator, because capping the arenas was only ever a mitigation.
#
# MEASURED on a 768MB container: six concurrent 4-6 megapixel encodes retained ~23MB per wave
# (249 -> 272 -> 294 -> 320MB anon), monotonically, and 90 SECONDS OF IDLE RETURNED EXACTLY 0MB.
# Ordinary web-sized images are cheaper but equally one-way (~200KB retained each). glibc frees those
# blocks into per-thread arenas and keeps them; nothing in Node ever calls malloc_trim. Past a few
# thousand encodes the memory ledger can no longer admit ANY image work, and the only cure is a
# restart — which is how a bulk import locked an instance out of media uploads entirely.
#
# jemalloc hands the pages back. Preloaded for the whole container so it covers the render workers
# too. Resolved by glob rather than hardcoded, so this works on arm64 as well as amd64, and skipped
# silently if the package is absent (a slim/derived image must still boot).
if [ -z "$LD_PRELOAD" ]; then
  for candidate in /usr/lib/*/libjemalloc.so.2 /usr/lib/libjemalloc.so.2; do
    if [ -r "$candidate" ]; then
      LD_PRELOAD="$candidate"
      export LD_PRELOAD
      echo "[sitewright/api] allocator: jemalloc ($candidate)"
      break
    fi
  done
fi

if [ -z "$NODE_OPTIONS" ]; then
  limit=""
  if [ -r /sys/fs/cgroup/memory.max ]; then
    limit=$(cat /sys/fs/cgroup/memory.max)
  elif [ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
    limit=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes)
  fi
  # "max" (v2) or an absurd value (v1 unlimited) means no limit is set — leave V8's default alone
  # rather than inventing a ceiling from host RAM.
  # Anything non-numeric (a corrupted or unusual cgroup value) is treated as unset: with `set -e`,
  # feeding it to `test -gt` would abort the script before `exec` and take the container down.
  case "$limit" in *[!0-9]*) limit='' ;; esac
  case "$limit" in
    ''|max) ;;
    *)
      if [ "$limit" -gt 134217728 ] && [ "$limit" -lt 1099511627776 ]; then
        mb=$(( limit / 1024 / 1024 * 65 / 100 ))
        NODE_OPTIONS="--max-old-space-size=${mb}"
        export NODE_OPTIONS
        echo "[sitewright/api] container limit $(( limit / 1024 / 1024 ))MB → NODE_OPTIONS=${NODE_OPTIONS}"
      fi
      ;;
  esac
fi

exec "$@"
