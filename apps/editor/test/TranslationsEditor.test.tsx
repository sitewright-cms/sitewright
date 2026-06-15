import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TranslationsEditor } from '../src/views/settings/TranslationsEditor';
import type { TranslationRow } from '../src/views/settings/model';

/** Controlled harness so onChange mutations re-render (needed to test ghost-row materialization). */
function Harness({
  initial,
  locales,
  shopEnabled,
  extraGhostGroups,
}: {
  initial: TranslationRow[];
  locales: string[];
  shopEnabled?: boolean;
  extraGhostGroups?: Array<{ id: string; label: string; keys: Array<{ key: string; label: string; default: string }> }>;
}) {
  const [rows, setRows] = useState<TranslationRow[]>(initial);
  return (
    <TranslationsEditor
      rows={rows}
      localeCodes={locales}
      defaultLocale={locales[0]!}
      shopEnabled={shopEnabled}
      extraGhostGroups={extraGhostGroups}
      onChange={setRows}
    />
  );
}

describe('TranslationsEditor — reserved ghost rows', () => {
  it('surfaces the shop_cart reserved group (collapsed) when the shop is enabled and there is >1 locale; expanding reveals the locked-key rows', () => {
    render(<Harness initial={[]} locales={['en', 'de']} shopEnabled />);
    const header = screen.getByRole('button', { name: /Shop · Cart/ });
    expect(header).toBeTruthy();
    expect(header.getAttribute('aria-expanded')).toBe('false'); // collapsed by default
    expect(screen.queryByLabelText('cart_add — de')).toBeNull(); // rows hidden while collapsed
    fireEvent.click(header);
    expect(screen.getByText('cart_add')).toBeTruthy();
    // the EN built-in default is shown as a placeholder (discoverability), not a stored value
    const deCell = screen.getByLabelText('cart_add — de') as HTMLInputElement;
    expect(deCell.placeholder).toBe('Add to cart');
    expect(deCell.value).toBe('');
  });

  it('does NOT surface ghost rows when the shop is disabled', () => {
    render(<Harness initial={[]} locales={['en', 'de']} shopEnabled={false} />);
    expect(screen.queryByText('Shop · Cart')).toBeNull();
  });

  it('does NOT surface ghost rows for a single-locale site (nothing to translate into)', () => {
    render(<Harness initial={[]} locales={['en']} shopEnabled />);
    expect(screen.queryByText('Shop · Cart')).toBeNull();
  });

  it('materializes a ghost row into the catalog when an other-locale cell is edited', () => {
    render(<Harness initial={[]} locales={['en', 'de']} shopEnabled />);
    fireEvent.click(screen.getByRole('button', { name: /Shop · Cart/ }));
    const deCell = screen.getByLabelText('cart_add — de') as HTMLInputElement;
    fireEvent.change(deCell, { target: { value: 'In den Warenkorb' } });
    // the row stays visible (lastTouched keeps its group open) and holds the new value
    expect((screen.getByLabelText('cart_add — de') as HTMLInputElement).value).toBe('In den Warenkorb');
  });

  it('surfaces extra (shop.<key>) ghost groups regardless of locale count, and materializes on edit', () => {
    const shopGroup = {
      id: 'shop_labels',
      label: 'Shop · Channels & fields',
      keys: [
        { key: 'shop.whatsapp', label: 'WhatsApp button', default: '' },
        { key: 'shop.name', label: 'Order field', default: '' },
      ],
    };
    // single-locale: the reserved cart_* group does NOT surface, but the extra shop group DOES (its keys
    // have no platform default, so they must be fillable even with one locale).
    render(<Harness initial={[]} locales={['en']} shopEnabled extraGhostGroups={[shopGroup]} />);
    expect(screen.queryByRole('button', { name: /Shop · Cart/ })).toBeNull();
    const header = screen.getByRole('button', { name: /Shop · Channels & fields/ });
    expect(header.getAttribute('aria-expanded')).toBe('false'); // collapsed by default
    fireEvent.click(header);
    expect(screen.getByText('shop.whatsapp')).toBeTruthy();
    const enCell = screen.getByLabelText('shop.whatsapp — en') as HTMLInputElement;
    fireEvent.change(enCell, { target: { value: 'Order on WhatsApp' } });
    expect((screen.getByLabelText('shop.whatsapp — en') as HTMLInputElement).value).toBe('Order on WhatsApp');
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

describe('TranslationsEditor — scope grouping (collapsible, collapsed by default)', () => {
  it('renders flat (no scope headers) when no key uses a dotted scope', () => {
    render(<Harness initial={[{ id: 'r1', key: 'nav_cta', cells: {} }]} locales={['en', 'de']} />);
    expect(screen.queryByRole('button', { name: /General/ })).toBeNull();
    // a flat key renders directly (no collapse) — its cell input is present
    expect(screen.getByLabelText('nav_cta — de')).toBeTruthy();
  });

  it('groups dotted keys under collapsible scope headers (collapsed); flat keys stay under an always-open "General"', () => {
    render(
      <Harness
        initial={[
          { id: 'r1', key: 'nav_cta', cells: {} },
          { id: 'r2', key: 'home.headline', cells: {} },
          { id: 'r3', key: 'home.cta', cells: {} },
          { id: 'r4', key: 'services.headline', cells: {} },
        ]}
        locales={['en', 'de']}
      />,
    );
    // General header (not a button — always open) + its flat row visible
    expect(screen.getByText('General')).toBeTruthy();
    expect(screen.getByLabelText('nav_cta — de')).toBeTruthy();
    // scope headers are collapsible buttons, collapsed by default → their rows are hidden
    const homeHeader = screen.getByRole('button', { name: /home/ });
    expect(homeHeader.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('home.headline — de')).toBeNull();
    expect(screen.getByRole('button', { name: /services/ })).toBeTruthy();
    // expanding reveals the scope's rows
    fireEvent.click(homeHeader);
    expect(screen.getByLabelText('home.headline — de')).toBeTruthy();
    expect(screen.getByLabelText('home.cta — de')).toBeTruthy();
  });
});
