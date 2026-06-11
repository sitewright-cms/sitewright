import { describe, it, expect } from 'vitest';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_RULES,
  passwordSchema,
  failingPasswordRules,
  isPasswordValid,
} from '../src/password.js';

// A password that satisfies every rule: ≥8 chars, upper, lower, number, symbol.
const STRONG = 'Str0ng-Pw!';

describe('PASSWORD_RULES', () => {
  it('covers length + the four character classes', () => {
    expect(PASSWORD_RULES.map((r) => r.id)).toEqual(['length', 'uppercase', 'lowercase', 'number', 'symbol']);
  });

  it('each rule tests exactly its requirement', () => {
    const rule = (id: string) => {
      const r = PASSWORD_RULES.find((x) => x.id === id);
      if (!r) throw new Error(`no rule "${id}"`);
      return r;
    };
    expect(rule('length').test('a'.repeat(PASSWORD_MIN_LENGTH))).toBe(true);
    expect(rule('length').test('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe(false);
    expect(rule('uppercase').test('A')).toBe(true);
    expect(rule('uppercase').test('a')).toBe(false);
    expect(rule('lowercase').test('a')).toBe(true);
    expect(rule('lowercase').test('A')).toBe(false);
    expect(rule('number').test('1')).toBe(true);
    expect(rule('number').test('a')).toBe(false);
    expect(rule('symbol').test('!')).toBe(true);
    expect(rule('symbol').test('aA1')).toBe(false);
  });
});

describe('isPasswordValid / failingPasswordRules', () => {
  it('accepts a password meeting every rule', () => {
    expect(isPasswordValid(STRONG)).toBe(true);
    expect(failingPasswordRules(STRONG)).toEqual([]);
  });

  it('reports each unmet rule by its label', () => {
    // all-lowercase, no number, no symbol, too short
    expect(failingPasswordRules('abc')).toEqual([
      `At least ${PASSWORD_MIN_LENGTH} characters`,
      'One uppercase letter',
      'One number',
      'One symbol',
    ]);
    // missing only the uppercase class (the legacy weak test password shape)
    expect(failingPasswordRules('pw-secret-1')).toEqual(['One uppercase letter']);
    expect(isPasswordValid('pw-secret-1')).toBe(false);
  });

  it('rejects a password over the max length even if otherwise strong', () => {
    expect(isPasswordValid(`${STRONG}${'a'.repeat(PASSWORD_MAX_LENGTH)}`)).toBe(false);
  });
});

describe('passwordSchema', () => {
  it('parses a compliant password', () => {
    expect(passwordSchema.parse(STRONG)).toBe(STRONG);
  });

  it('emits EVERY failing rule at once (not just the first)', () => {
    const result = passwordSchema.safeParse('abc');
    expect(result.success).toBe(false);
    if (result.success) return;
    const messages = result.error.issues.map((i) => i.message);
    expect(messages).toContain(`At least ${PASSWORD_MIN_LENGTH} characters`);
    expect(messages).toContain('One uppercase letter');
    expect(messages).toContain('One number');
    expect(messages).toContain('One symbol');
  });

  it('rejects a password past the length cap', () => {
    expect(passwordSchema.safeParse(`${STRONG}${'a'.repeat(PASSWORD_MAX_LENGTH)}`).success).toBe(false);
  });
});
