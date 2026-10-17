import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ShopMarket } from '@sitewright/schema';
import { MarketsEditor, type MarketsEditorProps } from '../src/views/settings/MarketsEditor';

/**
 * The Markets board edits website.shop.markets. It keeps no rules of its own: what a checkout depends on
 * is the schema's, shown as `issues`. These pin what the board itself owns — adding, ordering (the first
 * is the default), countries one market at a time, channels "every" vs a list, and money in MAJOR units.
 */
const eu: ShopMarket = { id: 'eu', name: 'Europe', currency: 'EUR', countries: ['DE'] };
const ch: ShopMarket = { id: 'ch', name: 'Switzerland', currency: 'CHF', countries: ['CH'] };

function setup(markets: ShopMarket[], over: Partial<MarketsEditorProps> = {}) {
  const onChange = vi.fn();
  render(
    <MarketsEditor
      markets={markets}
      onChange={onChange}
      checkoutChannels={[{ key: 'card', label: 'card' }, { key: 'twint', label: 'twint' }]}
      locales={['en', 'de']}
      shopCurrency="EUR"
      issues={[]}
      {...over}
    />,
  );
  return onChange;
}
const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)![0] as ShopMarket[];

describe('MarketsEditor', () => {
  it('adds a market in the shop currency, shipping nowhere yet', () => {
    const onChange = setup([]);
    fireEvent.click(screen.getByRole('button', { name: /Add market/ }));
    expect(last(onChange)).toEqual([{ id: 'default', name: 'Default', currency: 'EUR', countries: [] }]);
  });

  it('marks the first market the default, and reorders', () => {
    const onChange = setup([eu, ch]);
    expect(within(screen.getByRole('group', { name: 'market Europe' })).getByText('default')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Move market Switzerland up' }));
    expect(last(onChange).map((m) => m.id)).toEqual(['ch', 'eu']);
  });

  it('★ a country another market ships to cannot be ticked here too', () => {
    const onChange = setup([eu, ch]);
    const group = screen.getByRole('group', { name: 'market Switzerland' });
    expect(within(group).getByLabelText('Germany for market Switzerland')).toBeDisabled();
    fireEvent.click(within(group).getByLabelText('Austria for market Switzerland'));
    expect(last(onChange)[1]!.countries).toEqual(['CH', 'AT']);
  });

  it('channels: every checkout channel by default, or an explicit list', () => {
    const onChange = setup([eu]);
    fireEvent.click(screen.getByLabelText('Every checkout channel'));
    expect(last(onChange)[0]!.channels).toEqual(['card', 'twint']);
  });

  it('★ shipping is typed in MAJOR units and stored in the market currency’s minor units', () => {
    const onChange = setup([{ ...ch, pricing: {} }]);
    fireEvent.change(screen.getByLabelText('Shipping (CHF)'), { target: { value: '9.50' } });
    expect(last(onChange)[0]!.pricing).toEqual({ shipping: { flatMinor: 950 } });
  });

  it('shows the schema’s verdict on the markets', () => {
    setup([eu], { issues: ['DE is in two markets ("eu" and "dach")'] });
    expect(screen.getByRole('list', { name: 'Market problems' })).toHaveTextContent('DE is in two markets');
  });
});
