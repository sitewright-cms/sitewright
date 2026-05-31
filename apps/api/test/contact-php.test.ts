import { describe, it, expect } from 'vitest';
import type { Form } from '@sitewright/schema';
import { renderContactPhp, hasContactPhpForm } from '../src/publish/contact-php.js';

function form(over: Partial<Form>): Form {
  return {
    id: 'contact',
    name: 'Contact',
    fields: [{ name: 'email', label: 'Email', type: 'email', required: true }],
    submitLabel: 'Send',
    successMessage: 'ok',
    errorMessage: 'no',
    recipient: 'sales@acme.com',
    mode: 'contactPhp',
    hcaptcha: false,
    ...over,
  } as Form;
}

describe('hasContactPhpForm', () => {
  it('is true only when a form uses contactPhp', () => {
    expect(hasContactPhpForm([form({ mode: 'globalSmtp' })])).toBe(false);
    expect(hasContactPhpForm([form({ mode: 'globalSmtp' }), form({ id: 'b', mode: 'contactPhp' })])).toBe(true);
  });
});

describe('renderContactPhp', () => {
  it('bakes recipient + resolved subject as a JSON map, only for contactPhp forms', () => {
    const php = renderContactPhp([
      form({ id: 'contact', recipient: 'leads@acme.com', subject: 'Lead', mode: 'contactPhp' }),
      form({ id: 'newsletter', recipient: 'skip@acme.com', mode: 'globalSmtp' }), // excluded
    ]);
    expect(php).toMatch(/^<\?php/);
    expect(php).toContain('leads@acme.com');
    expect(php).toContain('"contact"');
    expect(php).not.toContain('skip@acme.com'); // non-contactPhp form excluded
    expect(php).toContain('@mail($to, $subject, $body, $headers)'); // uses PHP mail()
  });

  it('derives a default subject from the form name when none is set', () => {
    const php = renderContactPhp([form({ name: 'Careers', subject: undefined })]);
    // (The exact escaping is JSON-then-PHP-single-quote; assert the derived text is present.)
    expect(php).toContain('Careers');
    expect(php).toContain('submission');
  });

  it('escapes single quotes/backslashes in the baked JSON (PHP single-quote literal)', () => {
    const php = renderContactPhp([form({ id: 'contact', name: "O'Brien", subject: "O'Brien's form" })]);
    // The apostrophe must be backslash-escaped so it can't terminate the PHP string.
    expect(php).toContain("O\\'Brien");
    // And there must be no unescaped lone quote breaking out (no `'O'Brien` without escape).
    expect(php).not.toMatch(/[^\\]'O'Brien/);
  });

  it('bakes every contactPhp form into the dispatch map (multi-form)', () => {
    const php = renderContactPhp([
      form({ id: 'contact', recipient: 'sales@acme.com', subject: 'Sales', mode: 'contactPhp' }),
      form({ id: 'careers', recipient: 'hr@acme.com', subject: 'Careers', mode: 'contactPhp' }),
    ]);
    expect(php).toContain('"contact"');
    expect(php).toContain('sales@acme.com');
    expect(php).toContain('"careers"');
    expect(php).toContain('hr@acme.com');
  });

  it('produces valid PHP with an empty dispatch map when given no forms', () => {
    const php = renderContactPhp([]);
    expect(php).toMatch(/^<\?php/);
    expect(php).toContain("json_decode('{}', true)"); // empty map → every request 404s
  });

  it('hardens the handler: POST-only, CORS, body-size + JSON-depth limits', () => {
    const php = renderContactPhp([form({})]);
    expect(php).toContain("$_SERVER['REQUEST_METHOD'] !== 'POST'"); // method guard
    expect(php).toContain('Access-Control-Allow-Origin: *'); // CORS for cross-origin posts
    expect(php).toContain("REQUEST_METHOD'] === 'OPTIONS'"); // preflight
    expect(php).toContain('strlen($raw) > 131072'); // body size cap
    expect(php).toContain('json_decode($raw, true, 10)'); // depth limit
  });

  it('includes the bot filters, CRLF subject strip, and Reply-To validation', () => {
    const php = renderContactPhp([form({})]);
    expect(php).toContain("$data['_hpt']"); // honeypot
    expect(php).toContain("intval($data['_elapsed'])"); // time-trap
    expect(php).toContain('< 1200');
    expect(php).toContain('str_replace(array("\\r", "\\n"), \'\', $cfg[\'subject\'])'); // header-injection guard
    expect(php).toContain('FILTER_VALIDATE_EMAIL'); // Reply-To validation
    expect(php).toContain("in_array($k, $skip, true)"); // control fields excluded from the body
  });
});
