import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * ★★ THE BOOKING SWEEP MUST BE WIRED, not merely written (the lesson of payment-sweeps.test.ts).
 *
 * Every booking claim is promised an end: holds and requests lapse, ledger bookings are forgotten after
 * their retention, and the customers' details go with them. `BookingClaimsRepository.sweep` keeps that
 * promise only if the app's periodic maintenance pass calls it. The failure guarded here is "nobody calls
 * this", which unit tests of the sweep cannot see, so this reads the call graph directly.
 */
const appSource = readFileSync(fileURLToPath(new URL('../src/http/app.ts', import.meta.url)), 'utf8');

/** The body of `const name = (…): void => { … }`, by brace matching from its arrow. */
function arrowBody(name: string): string {
  const start = appSource.indexOf(`const ${name} = (`);
  if (start < 0) throw new Error(`app.ts has no ${name}`);
  const i = appSource.indexOf('=> {', start) + 3;
  let depth = 0;
  for (let j = i; j < appSource.length; j += 1) {
    if (appSource[j] === '{') depth += 1;
    else if (appSource[j] === '}') {
      depth -= 1;
      if (depth === 0) return appSource.slice(i, j + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

describe('the booking claims sweep', () => {
  it('runs from the periodic maintenance pass', () => {
    expect(arrowBody('runMaintenanceSweeps')).toMatch(/bookingClaimsRepo\s*\.sweep\(/);
  });

  it('is constructed over the app database', () => {
    expect(appSource).toMatch(/const bookingClaimsRepo = new BookingClaimsRepository\(db\)/);
  });
});
