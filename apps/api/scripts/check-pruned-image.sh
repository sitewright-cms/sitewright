#!/usr/bin/env bash
# Checks the node_modules pruning in apps/api/.dockerignore on a built runtime image: the pruned files are
# not in it, and nothing else went with them. Every package.json (what image scanners read) and every
# license file of the deploy output must still be in the image, and no link may be left dangling.
#
#   apps/api/scripts/check-pruned-image.sh <deploy dir> <image>
set -euo pipefail

deploy="${1:?usage: check-pruned-image.sh <deploy dir> <image>}"
image="${2:?usage: check-pruned-image.sh <deploy dir> <image>}"
[ -d "$deploy/node_modules" ] || { echo "::error::no node_modules in $deploy"; exit 1; }

# Paths matching a find expression in the deploy output, leaving out the WebAssembly fallback, which the
# image is meant to lack; and in the image.
in_deploy() {
  find "$deploy/node_modules" -path '*/.pnpm/@tailwindcss+oxide-wasm32-wasi@*' -prune -o \( "$@" \) -print | wc -l
}
in_image() {
  docker run --rm --network none --entrypoint find "$image" /app/node_modules \( "$@" \) -print | wc -l
}

failed=0
# <what> <expected> <find expression…>: the image must hold exactly the expected number.
expect() {
  local what="$1" want="$2" got
  shift 2
  got="$(in_image "$@")"
  echo "$what: $got in the image, $want expected"
  if [ "$got" -ne "$want" ]; then
    echo "::error::the image has $got $what where $want were expected"
    failed=1
  fi
}
# <what> <find expression…>: as many in the image as in the deploy output, and some at all.
same_as_deploy() {
  local what="$1" want
  shift
  want="$(in_deploy "$@")"
  if [ "$want" -eq 0 ]; then
    echo "::error::the deploy output has no $what: is $deploy a pnpm deploy output?"
    failed=1
  fi
  expect "$what" "$want" "$@"
}

expect 'pruned files' 0 -type f \( -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.js.map' \
  -o -name '*.cjs.map' -o -name '*.mjs.map' -o -name '*.ts.map' -o -name '*.mts.map' -o -name '*.cts.map' \
  -o -name '*.css.map' -o -iname 'readme*.md' -o -iname 'changelog*.md' -o -iname 'history*.md' \
  -o -name CONTRIBUTING.md -o -name SECURITY.md -o -name GOVERNANCE.md -o -path '*oxide-wasm32-wasi*' \)
same_as_deploy 'package.json files' -type f -name package.json
# A license-like name that is also a pruned one (`license.d.ts`) is no license, and would never match.
same_as_deploy 'license files' -type f \( -iname 'licen[cs]e*' -o -iname 'notice*' -o -iname 'copying*' \) \
  ! -name '*.d.ts' ! -name '*.d.mts' ! -name '*.d.cts' ! -name '*.map'
# A link left pointing at something pruned. The deploy output's own count (0 today) is the baseline.
links="$(in_deploy -xtype l)"
expect 'dangling links' "$links" -xtype l
exit "$failed"
