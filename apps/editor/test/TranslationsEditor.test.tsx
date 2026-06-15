import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TranslationsEditor } from '../src/views/settings/TranslationsEditor';
import type { TranslationRow } from '../src/views/settings/model';

/** Controlled harness so onChange mutations re-render (needed to test ghost-row materialization). */
function Harness({ initial, locales, shopEnabled }: { initial: TranslationRow[]; locales: string[]; shopEnabled?: boolean }) {
  const [rows, setRows] = useState<TranslationRow[]>(initial);
  return (
    <TranslationsEditor rows={rows} localeCodes={locales} defaultLocale={locales[0]!} shopEnabled={shopEnabled} onChange={setRows} />
  );
}

describe('TranslationsEditor — reserved ghost rows', () => {
  it('surfaces the shop_cart reserved keys (locked, default as placeholder) when the shop is enabled and there is >1 locale', () => {
    render(<Harness initial={[]} locales={['en', 'de']} shopEnabled />);
    expect(screen.getByText('Shop · Cart')).toBeTruthy();
    expect(screen.getByText('cart_add')).toBeTruthy();
    // the EN built-in default is shown as a placeholder (discoverability), not a stored value
    const deCell = screen.getByLabelText('cart_add — de') as HTMLInputElement;
    expect(deCell.placeholder).toBe('Add to cart');
    expect(deCell.value).toBe('');
  });

  it('does NOT surface ghost rows when the shop is disabled', () => {
    render(<Harness initial={[]} locales={['en', 'de']} shopEnabled={false} />);
    expect(screen.queryByText('Shop · Cart')).toBeNull();
    expect(screen.queryByText('cart_add')).toBeNull();
  });

  it('does NOT surface ghost rows for a single-locale site (nothing to translate into)', () => {
    render(<Harness initial={[]} locales={['en']} shopEnabled />);
    expect(screen.queryByText('Shop · Cart')).toBeNull();
  });

  it('materializes a ghost row into the catalog when an other-locale cell is edited', () => {
    render(<Harness initial={[]} locales={['en', 'de']} shopEnabled />);
    const deCell = screen.getByLabelText('cart_add — de') as HTMLInputElement;
    fireEvent.change(deCell, { target: { value: 'In den Warenkorb' } });
    expect((screen.getByLabelText('cart_add — de') as HTMLInputElement).value).toBe('In den Warenkorb');
  });
});

describe('TranslationsEditor — key edit-protection', () => {
  it('locks a non-blank free-form key until the pencil unlocks it', () => {
    render(<Harness initial={[{ id: 'r1', key: 'nav_cta', cells: { en: 'Start' } }]} locales={['en', 'de']} />);
    const keyInput = screen.getByLabelText('Translation key') as HTMLInputElement;
    expect(keyInput.readOnly).toBe(true);
    fireEvent.click(screen.getByLabelText('Edit key'));
    expect((screen.getByLabelText('Translation key') as HTMLInputElement).readOnly).toBe(false);
  });
});
