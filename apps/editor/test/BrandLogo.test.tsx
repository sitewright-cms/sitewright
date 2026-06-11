import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrandLogo } from '../src/views/ui/BrandLogo';

describe('BrandLogo', () => {
  it('renders the uploaded logo as an <img> (alt = the platform name) when logoUrl is set', () => {
    render(<BrandLogo logoUrl="/branding/logo?v=1" name="Acme CMS" />);
    const img = screen.getByRole('img', { name: 'Acme CMS' });
    expect(img).toHaveAttribute('src', '/branding/logo?v=1');
  });

  it('falls back to the built-in BrandMark SVG when no logo is set', () => {
    const { container } = render(<BrandLogo logoUrl={null} name="Acme CMS" />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
