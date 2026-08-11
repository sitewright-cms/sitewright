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
    expect(screen.queryByLabelText('cart.add — de')).toBeNull(); // rows hidden while collapsed
    fireEvent.click(header);
    expect(screen.getByText('cart.add')).toBeTruthy();
    // the EN built-in default is shown as a placeholder (discoverability), not a stored value
    const deCell = screen.getByLabelText('cart.add — de') as HTMLInputElement;
    expect(deCell.placeholder).toBe('Add to cart');
    expect(deCell.value).toBe('');
  });

  it('does NOT surface ghost rows when the shop is disabled', () => {
    render(<Harness initial={[]} locales={['en', 'de']} shopEnabled={false} />);
    expect(screen.queryByText('Shop · Cart')).toBeNull();
  });

  // The shop group carries merchant COPY and CONFIG, not a11y boilerplate: `cart.currency_symbol` is how a
  // single-locale Namibian shop turns "$" into "N$". Gating it on a 2nd locale left that shop with no UI for
  // it at all — while Shop settings pointed the operator at a Translations row that never rendered.
  it('surfaces the shop group on a SINGLE-LOCALE site whenever the shop is on', () => {
    render(<Harness initial={[]} locales={['en']} shopEnabled />);
    fireEvent.click(screen.getByRole('button', { name: /Shop · Cart/ }));
    expect(screen.getByLabelText('cart.currency_symbol — en')).toBeTruthy();
  });

  // …but the SYSTEM group keeps its locale gate: those are component a11y strings ("Close", "Next slide")
  // identical to the built-in defaults on an English site, so surfacing them there is pure clutter.
  it('still hides the system group on a single-locale English site', () => {
    render(<Harness initial={[]} locales={['en']} shopEnabled />);
    expect(screen.queryByText('System · Components')).toBeNull();
  });

  it('materializes a ghost row into the catalog when an other-locale cell is edited', () => {
    render(<Harness initial={[]} locales={['en', 'de']} shopEnabled />);
    fireEvent.click(screen.getByRole('button', { name: /Shop · Cart/ }));
    const deCell = screen.getByLabelText('cart.add — de') as HTMLInputElement;
    fireEvent.change(deCell, { target: { value: 'In den Warenkorb' } });
    // the row stays visible (lastTouched keeps its group open) and holds the new value
    expect((screen.getByLabelText('cart.add — de') as HTMLInputElement).value).toBe('In den Warenkorb');
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
    // Single-locale: the extra shop group surfaces because its keys have no platform default at all, so
    // they must be fillable even with one locale — the same reason the reserved shop group now surfaces too.
    render(<Harness initial={[]} locales={['en']} shopEnabled extraGhostGroups={[shopGroup]} />);
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
