import { describe, it, expect } from 'vitest';
import { companyToOrganization } from '../src/publish/company-seo.js';

describe('companyToOrganization', () => {
  it('returns undefined with no company or the "disabled" sentinel (any case/whitespace)', () => {
    expect(companyToOrganization(undefined, 'Fallback')).toBeUndefined();
    expect(companyToOrganization({ businessType: 'disabled', legalName: 'X' }, 'F')).toBeUndefined();
    expect(companyToOrganization({ businessType: 'DISABLED', legalName: 'X' }, 'F')).toBeUndefined();
    expect(companyToOrganization({ businessType: ' Disabled ', legalName: 'X' }, 'F')).toBeUndefined();
  });

  it('resolves name as legalName → shortName → fallback', () => {
    expect(companyToOrganization({ legalName: 'Legal', shortName: 'Short' }, 'F')?.name).toBe('Legal');
    expect(companyToOrganization({ shortName: 'Short' }, 'F')?.name).toBe('Short');
    expect(companyToOrganization({}, 'Project')?.name).toBe('Project');
  });

  it('maps contact/address/geo/social fields through', () => {
    const org = companyToOrganization(
      {
        shortName: 'Acme',
        businessType: 'LocalBusiness',
        telephone: '+264-81-660-0188',
        email: 'a@b.co',
        logo: 'https://x.io/logo.png',
        address: { locality: 'Windhoek', region: 'Khomas', country: 'NA' },
        geo: { latitude: '-22.5', longitude: '17.0' },
        social: ['https://facebook.com/acme'],
      },
      'Project',
    );
    expect(org).toMatchObject({
      name: 'Acme',
      type: 'LocalBusiness',
      telephone: '+264-81-660-0188',
      email: 'a@b.co',
      logo: 'https://x.io/logo.png',
      address: { locality: 'Windhoek', region: 'Khomas', country: 'NA' },
      geo: { latitude: '-22.5', longitude: '17.0' },
      sameAs: ['https://facebook.com/acme'],
    });
  });

  it('omits type when no businessType and omits empty social', () => {
    const org = companyToOrganization({ legalName: 'X', social: [] }, 'F');
    expect(org?.type).toBeUndefined();
    expect(org?.sameAs).toBeUndefined();
  });
});
