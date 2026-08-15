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
