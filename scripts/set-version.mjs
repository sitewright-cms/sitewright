#!/usr/bin/env node
// Set the monorepo version across the root package.json + every workspace package (apps/*, packages/*).
// The published image's version comes from the release TAG (release.yml bakes SW_VERSION), so this is for
// human/tooling consistency — keep package.json versions in step with the tag you're about to cut.
//
// Usage: node scripts/set-version.mjs <semver>     e.g. 0.2.0   or   1.0.0-rc1
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const version = process.argv[2];
// Linear semver check (no nested quantifiers → not ReDoS-prone); the arg is a developer CLI input anyway.
// eslint-disable-next-line security/detect-unsafe-regex
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Usage: node scripts/set-version.mjs <semver>   (e.g. 0.2.0 or 1.0.0-rc1)');
  process.exit(1);
}

/** The root package.json + every workspace package.json under apps/* and packages/*. */
function targets() {
  const files = [join(ROOT, 'package.json')];
  for (const group of ['apps', 'packages']) {
    const dir = join(ROOT, group);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const pkg = join(dir, name, 'package.json');
      if (existsSync(pkg)) files.push(pkg);
    }
  }
  return files;
}

// Regex-replace only the top-level "version" value so formatting/key-order is preserved (minimal diff).
let changed = 0;
for (const file of targets()) {
  const rel = relative(ROOT, file);
  const content = readFileSync(file, 'utf8');
  const match = content.match(/"version"\s*:\s*"([^"]*)"/);
  if (!match) {
    console.warn(`  (skip — no "version" field) ${rel}`);
    continue;
  }
  if (match[1] === version) continue;
  writeFileSync(file, content.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`));
  console.log(`  ${rel}: ${match[1]} → ${version}`);
  changed += 1;
}

console.log(changed ? `\nSet ${changed} package(s) to ${version}.` : `\nAll packages already at ${version}.`);
console.log(`Next: update CHANGELOG.md, commit, then \`git tag v${version} && git push origin v${version}\`.`);
