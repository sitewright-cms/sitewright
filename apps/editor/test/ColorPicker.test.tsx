import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ColorPicker, ColorField, ColorCard } from '../src/views/settings/ColorPicker';

// A stateful host: onChange feeds `value` back in, mirroring how the settings form drives the
// picker — so the live cross-space conversion is exercised end to end.
function Harness({ initial, spy }: { initial: string; spy?: (v: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <ColorPicker
        value={v}
        onChange={(x) => {
          spy?.(x);
          setV(x);
        }}
      />
      <output data-testid="stored">{v}</output>
    </>
  );
}

describe('ColorPicker', () => {
  it('shows the same color in all four spaces', () => {
    render(<ColorPicker value="#0ea5e9" onChange={() => {}} />);
    expect(screen.getByLabelText('HEX')).toHaveValue('#0ea5e9');
    expect(screen.getByLabelText('RGB')).toHaveValue('rgb(14 165 233)');
    expect(screen.getByLabelText('HSL')).toHaveValue('hsl(199 89% 48%)');
    expect(screen.getByLabelText('OKLCH')).toHaveValue('oklch(0.685 0.148 237.32)');
  });

  it('edits in RGB and live-converts the other lenses + stores hex', () => {
    const spy = vi.fn();
    render(<Harness initial="#0ea5e9" spy={spy} />);
    fireEvent.change(screen.getByLabelText('RGB'), { target: { value: 'rgb(255 0 0)' } });
    expect(spy).toHaveBeenLastCalledWith('#ff0000');
    expect(screen.getByTestId('stored')).toHaveTextContent('#ff0000');
    // The HEX + HSL lenses (not focused) follow the canonical value.
    expect(screen.getByLabelText('HEX')).toHaveValue('#ff0000');
    expect(screen.getByLabelText('HSL')).toHaveValue('hsl(0 100% 50%)');
  });

  it('accepts an oklch edit and converts it to a stored hex', () => {
    const spy = vi.fn();
    render(<Harness initial="#000000" spy={spy} />);
    fireEvent.change(screen.getByLabelText('OKLCH'), { target: { value: 'oklch(1 0 0)' } });
    expect(spy).toHaveBeenLastCalledWith('#ffffff');
  });

  it('stores 8-digit #rrggbbaa when alpha drops below 1 (the transparency selector)', () => {
    const spy = vi.fn();
    render(<Harness initial="#0ea5e9" spy={spy} />);
    fireEvent.change(screen.getByLabelText('Alpha'), { target: { value: '0.5' } });
    expect(spy).toHaveBeenLastCalledWith('#0ea5e980');
    expect(screen.getByLabelText('HEX')).toHaveValue('#0ea5e980');
  });

  it('re-seeds every lens when `value` changes externally (the lastEmit guard)', () => {
    // The row's own text input can change `value` without going through the picker; the picker
    // must follow it rather than hold its prior working color.
    const { rerender } = render(<ColorPicker value="#ff0000" onChange={() => {}} />);
    expect(screen.getByLabelText('HEX')).toHaveValue('#ff0000');
    rerender(<ColorPicker value="#0000ff" onChange={() => {}} />);
    expect(screen.getByLabelText('HEX')).toHaveValue('#0000ff');
    expect(screen.getByLabelText('HSL')).toHaveValue('hsl(240 100% 50%)');
  });

  it('round-trips an alpha hex typed straight into the HEX field', () => {
    render(<Harness initial="#0ea5e9" />);
    fireEvent.change(screen.getByLabelText('HEX'), { target: { value: '#11223380' } });
    // The alpha slider reflects the parsed alpha (128/255 ≈ 0.5).
    expect(Number((screen.getByLabelText('Alpha') as HTMLInputElement).value)).toBeCloseTo(0.5, 1);
    expect(screen.getByLabelText('RGB')).toHaveValue('rgb(17 34 51 / 0.502)');
  });
});

describe('ColorField (swatch + popover)', () => {
  it('opens the picker on click and closes on Escape', () => {
    render(<ColorField value="#0ea5e9" onChange={() => {}} label="Primary Color" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Primary Color' }));
    expect(screen.getByRole('dialog', { name: 'Primary Color picker' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('emits edits made inside the popover', () => {
    const spy = vi.fn();
    render(<ColorField value="#0ea5e9" onChange={spy} label="Accent Color" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Accent Color' }));
    fireEvent.change(screen.getByLabelText('HEX'), { target: { value: '#abcdef' } });
    expect(spy).toHaveBeenLastCalledWith('#abcdef');
  });
});

describe('ColorCard (brand-color card)', () => {
  it('shows the title + current value and opens the picker from the preview', () => {
    render(<ColorCard title="Primary" value="#0ea5e9" onChange={() => {}} />);
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByText('#0ea5e9')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Primary' }));
    expect(screen.getByRole('dialog', { name: 'Primary picker' })).toBeInTheDocument();
  });

  it('reads an empty value as "Default" and emits picker edits (the only way to set the color)', () => {
    const spy = vi.fn();
    render(<ColorCard title="Accent" value="" onChange={spy} />);
    expect(screen.getByText('Default')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Accent' }));
    fireEvent.change(screen.getByLabelText('HEX'), { target: { value: '#abcdef' } });
    expect(spy).toHaveBeenLastCalledWith('#abcdef');
  });
});
