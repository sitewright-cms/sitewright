#!/bin/sh
# Give V8 a heap ceiling derived from the container's ACTUAL memory limit.
#
# Without --max-old-space-size, V8 sizes its old space from HOST RAM — on a 62GB build host that is
# a heap far larger than a 1GiB container can survive, so the kernel OOM-kills the process (measured:
# exit 137, every in-flight request lost) instead of V8 raising a catchable allocation failure.
# The render workers have carried a ceiling for a long time; the main process never did.
#
# The ceiling comes from src/runtime/process-sizing.ts, which divides the limit between the processes
# that SHARE this cgroup — the main process and the render workers. Deriving it here independently is
# what over-subscribed a small container: 65% of 512MB for the main heap plus a 128MB worker is 458MB
# of ceilings in a 512MB budget, and the kernel enforces the sum (measured: SIGKILL at cgroup anon
# 416MB, main 407MB, worker 126MB). The shell keeps the old 65% only as a FALLBACK for a derived image
# where dist/ is absent. An explicit NODE_OPTIONS from the operator always wins.
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

# Make jemalloc hand pages back WHILE IDLE.
#
# Preloading jemalloc (above) stopped the monotonic ratchet glibc had, but it did not make an idle
# instance shrink — because jemalloc's decay-based purging is driven by ALLOCATION. A process that
# has stopped working never calls the allocator, so the decay timer is never advanced and dirty pages
# are held indefinitely.
#
# MEASURED on a 768MB container (v0.42.0): idle floor 238MB; 120 AVIF encodes peaked at 682MB; three
# minutes of idle afterwards sat FLAT at 308MB and returned nothing. The reclaim only happened when
# the NEXT batch started (578 -> 390 -> 278MB mid-load) — allocation, not time, was doing the work.
# That is the reported "memory never returns to baseline after churn", and on a 1GiB instance it
# rests proportionally higher because the heap ceiling is higher (576MB vs 491MB).
#
# ⚠️ `background_thread:true` is the OBVIOUS fix and it is NOT SAFE HERE. jemalloc's background thread
# and fork() interact badly: a child forked while that thread holds an internal lock can stall between
# fork and exec. This process forks constantly — render workers, and Chrome for screenshots and
# Lighthouse. MEASURED on an idle 1GiB slot: with background_thread the pagespeed audit failed 3/3
# with `could not launch a headless browser: connect ECONNREFUSED` after a 25s launch timeout, while
# the identical image without it passed 3/3 in 6s. Chrome launched fine by hand under the same
# MALLOC_CONF — only the fork FROM THE API PROCESS broke — which is why this needs saying out loud.
#
# So: shorten the decay windows only. Purging stays allocation-driven, but this instance is never
# truly idle (timers, health checks, session sweeps), so decay does advance — it just held pages ~5x
# longer than needed at the 10s default.
#
# Only set when the operator has not chosen a value.
if [ -z "$MALLOC_CONF" ]; then
  MALLOC_CONF="dirty_decay_ms:2000,muzzy_decay_ms:2000"
  export MALLOC_CONF
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
        # One source of truth (process-sizing.ts), so the heap ceiling and the render-pool size can
        # never be sized against the same limit in ignorance of each other again.
        mb=$(node /app/dist/runtime/process-sizing.js --main-heap-mb 2>/dev/null || true)
        case "$mb" in *[!0-9]*|'') mb=$(( limit / 1024 / 1024 * 65 / 100 ));; esac
        NODE_OPTIONS="--max-old-space-size=${mb}"
        export NODE_OPTIONS
        echo "[sitewright/api] container limit $(( limit / 1024 / 1024 ))MB → NODE_OPTIONS=${NODE_OPTIONS}"
      fi
      ;;
  esac
fi

# OPT-IN heap snapshots, for telling allocator retention apart from a real leak.
#
# The two look identical from outside: RSS that does not come down. Only a snapshot says whether the
# bytes are reachable JS objects (a leak) or freed memory the allocator is holding (not one). Enable
# with SW_HEAPSNAPSHOT=1, then, after the churn you want to inspect:
#
#   docker kill -s SIGUSR2 <container>        # writes Heap.<pid>.<seq>.heapsnapshot into the CWD
#   docker cp <container>:/app/<file> .       # open it in Chrome DevTools → Memory
#
# Off by default: writing one pauses the process and the file is roughly heap-sized, which is not
# something to do to a live instance unasked. It is deliberately NOT the inspector (--inspect opens a
# port that is a remote-code-execution surface on a running instance).
if [ -n "$SW_HEAPSNAPSHOT" ] && [ "$SW_HEAPSNAPSHOT" != "0" ]; then
  NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--heapsnapshot-signal=SIGUSR2"
  export NODE_OPTIONS
  echo "[sitewright/api] heap snapshots ARMED: docker kill -s SIGUSR2 <container>"
fi

exec "$@"
