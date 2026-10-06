import { describe, it, expect } from 'vitest';
import {
  interpolateString,
  interpolateValue,
  readPath,
  readStringPath,
  InterpolationError,
  type InterpolationScope,
} from '../src/payments/interpolate.js';

const scope: InterpolationScope = {
  cred: { secretKey: 'sk_test_abc', empty: '' },
  amount: { minor: 2498, decimal: '24.98', currency: 'EUR' },
  txn: { id: 'txn_1', publicToken: 'tok_1', reference: 'ref_1' },
  url: { return: 'https://shop.test/thanks/', cancel: 'https://shop.test/cart/', webhook: 'https://sw.test/pay/p1/webhook/acme' },
  field: { name: 'Ada', note: '' },
  text: { order_name: '1x Mug' },
};

describe('interpolateString', () => {
  it('substitutes every namespace', () => {
    expect(interpolateString('${CRED:secretKey}', scope)).toBe('sk_test_abc');
    expect(interpolateString('${AMOUNT:minor}', scope)).toBe('2498');
    expect(interpolateString('${AMOUNT:decimal}', scope)).toBe('24.98');
    expect(interpolateString('${AMOUNT:currency}', scope)).toBe('EUR');
    expect(interpolateString('${AMOUNT:currency_lower}', scope)).toBe('eur');
    expect(interpolateString('${TXN:id}/${TXN:token}/${TXN:reference}', scope)).toBe('txn_1/tok_1/ref_1');
    expect(interpolateString('${URL:return}', scope)).toBe('https://shop.test/thanks/');
    expect(interpolateString('${URL:cancel}', scope)).toBe('https://shop.test/cart/');
    expect(interpolateString('${URL:webhook}', scope)).toBe('https://sw.test/pay/p1/webhook/acme');
    expect(interpolateString('${FIELD:name}', scope)).toBe('Ada');
    expect(interpolateString('${TEXT:order_name}', scope)).toBe('1x Mug');
  });

  it('substitutes several tokens in one string and leaves the rest alone', () => {
    expect(interpolateString('order ${TXN:id} for ${AMOUNT:decimal} ${AMOUNT:currency}', scope)).toBe('order txn_1 for 24.98 EUR');
    expect(interpolateString('nothing to replace', scope)).toBe('nothing to replace');
    expect(interpolateString('', scope)).toBe('');
  });

  it('★ the variable set is CLOSED — an unknown token throws rather than blanking a field', () => {
    // A typo would otherwise send a provider a request with a field silently empty, and the field
    // most likely to be blanked is the amount.
    expect(() => interpolateString('${NOPE:x}', scope)).toThrow(InterpolationError);
    expect(() => interpolateString('${AMOUNT:bogus}', scope)).toThrow(/unknown amount field/);
    expect(() => interpolateString('${TXN:bogus}', scope)).toThrow(/unknown transaction field/);
    expect(() => interpolateString('${URL:bogus}', scope)).toThrow(/unknown url field/);
  });

  it('★★ a MISSING credential throws — never an empty Authorization header', () => {
    // An unauthenticated call to a payment provider is at best a confusing 401 and at worst a call
    // that half-succeeds.
    expect(() => interpolateString('${CRED:absent}', scope)).toThrow(/has no value for this mode/);
    expect(() => interpolateString('${CRED:empty}', scope)).toThrow(/has no value for this mode/);
  });

  it('★ a BUYER field is allowed to be absent — an optional input left blank is not an error', () => {
    expect(interpolateString('${FIELD:absent}', scope)).toBe('');
    expect(interpolateString('${FIELD:note}', scope)).toBe('');
    expect(interpolateString('${TEXT:absent}', scope)).toBe('');
  });

  it('★ a prototype key resolves to empty, never to something off the prototype chain', () => {
    expect(interpolateString('${FIELD:constructor}', scope)).toBe('');
    expect(interpolateString('${TEXT:constructor}', scope)).toBe('');
    expect(() => interpolateString('${CRED:constructor}', scope)).toThrow();
  });

  it('leaves a malformed token untouched rather than guessing at it', () => {
    for (const t of ['${lowercase:x}', '${CRED}', '$CRED:x}', '${CRED:}', '{CRED:x}']) {
      expect(interpolateString(t, scope), t).toBe(t);
    }
  });
});

describe('interpolateValue', () => {
  it('walks a nested body, substituting in strings', () => {
    const body = { a: { b: ['${TXN:id}', { c: '${AMOUNT:currency}' }] }, n: 5, t: true, z: null };
    expect(interpolateValue(body, scope)).toEqual({ a: { b: ['txn_1', { c: 'EUR' }] }, n: 5, t: true, z: null });
  });

  it('★ the `#` form yields a JSON NUMBER — providers differ on whether an amount is one', () => {
    const out = interpolateValue({ amount: '${#AMOUNT:minor}', shown: '${AMOUNT:minor}' }, scope) as Record<string, unknown>;
    expect(out.amount).toBe(2498);
    expect(out.shown).toBe('2498');
  });

  it('refuses a `#` token that does not resolve to a number', () => {
    expect(() => interpolateValue({ x: '${#AMOUNT:currency}' }, scope)).toThrow(/did not resolve to a number/);
  });

  it('only treats `#` as numeric when it is the WHOLE string', () => {
    expect(interpolateValue({ x: 'n=${#AMOUNT:minor}' }, scope)).toEqual({ x: 'n=${#AMOUNT:minor}' });
  });

  it('interpolates object KEYS, for a provider wanting metadata[<id>]', () => {
    expect(interpolateValue({ 'metadata[${TXN:id}]': 'x' }, scope)).toEqual({ 'metadata[txn_1]': 'x' });
  });

  it('★ a key that interpolates to a prototype name is DROPPED, not assigned', () => {
    const out = interpolateValue({ __proto__: 'x', constructor: 'y', prototype: 'z', ok: '1' }, scope) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(['ok']);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).ok).toBeUndefined();
  });

  it('★ bounds nesting, so a stored body cannot be made pathologically deep', () => {
    let deep: unknown = 'x';
    for (let i = 0; i < 20; i += 1) deep = { d: deep };
    expect(() => interpolateValue(deep, scope)).toThrow(/nested too deeply/);
  });

  it('passes non-string primitives through untouched', () => {
    expect(interpolateValue(42, scope)).toBe(42);
    expect(interpolateValue(null, scope)).toBeNull();
    expect(interpolateValue(undefined, scope)).toBeUndefined();
  });
});

describe('readPath', () => {
  const body = { a: { b: { c: 'deep' } }, list: [{ id: 'first' }, { id: 'second' }], n: 7, zero: 0, nil: null, s: 'str' };

  it('reads dotted and bracketed paths', () => {
    expect(readPath(body, 'a.b.c')).toBe('deep');
    expect(readPath(body, 'list[0].id')).toBe('first');
    expect(readPath(body, 'list[1].id')).toBe('second');
    expect(readPath(body, 'n')).toBe(7);
  });

  it('returns undefined for a miss rather than throwing', () => {
    for (const p of ['a.b.missing', 'missing', 'list[9].id', 'a.b.c.d', 'nil.x', 's.x', 'list[x].id']) {
      expect(readPath(body, p), p).toBeUndefined();
    }
  });

  it('★ refuses a prototype segment, so a provider response cannot walk the chain', () => {
    expect(readPath(body, '__proto__')).toBeUndefined();
    expect(readPath(body, 'a.constructor')).toBeUndefined();
    expect(readPath(body, 'a.prototype.x')).toBeUndefined();
    // And an inherited property is not an own property.
    expect(readPath(body, 'toString')).toBeUndefined();
  });

  it('distinguishes a falsy VALUE from a miss', () => {
    expect(readPath(body, 'zero')).toBe(0);
    expect(readPath(body, 'nil')).toBeNull();
  });

  it('handles a null or non-object root', () => {
    expect(readPath(null, 'a')).toBeUndefined();
    expect(readPath('string', 'a')).toBeUndefined();
    expect(readPath(undefined, 'a')).toBeUndefined();
  });
});

describe('readStringPath', () => {
  const body = { s: 'text', n: 42, f: 1.5, bad: Number.NaN, b: true, o: {}, arr: [1] };

  it('returns a string, and stringifies a finite number', () => {
    expect(readStringPath(body, 's')).toBe('text');
    expect(readStringPath(body, 'n')).toBe('42');
    expect(readStringPath(body, 'f')).toBe('1.5');
  });

  it('★ refuses anything that is not text or a finite number', () => {
    // A provider reference read as "true" or "[object Object]" would be a reference to nothing.
    for (const p of ['bad', 'b', 'o', 'arr', 'missing']) expect(readStringPath(body, p), p).toBeUndefined();
  });
});
