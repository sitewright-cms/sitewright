import { describe, it, expect } from 'vitest';
import { CompanySchema } from '../src/company.js';

describe('CompanySchema', () => {
  it('accepts a full corporate-identity record', () => {
    const company = {
      businessType: 'Organization',
      legalName: 'ClassCar Hire CC',
      shortName: 'ClassCar',
      slogan: 'Premium Chauffeur Services',
      description: 'Private transportation in Windhoek.',
      logo: 'https://classcar.com.na/logo.png',
      icon: '/icon.png',
      image: '/hero.jpg',
      email: 'info@classcar.com.na',
      telephone: '+264-81-660-0188',
      address: { street: '1 Main', locality: 'Windhoek', region: 'Khomas', country: 'NA', postalCode: '9000' },
      geo: { latitude: '-22.5', longitude: '17.0' },
      social: ['https://facebook.com/classcar', 'https://www.linkedin.com/company/classcar'],
    };
    expect(CompanySchema.parse(company)).toEqual(company);
  });

  it('is entirely optional (an empty object is valid)', () => {
    expect(CompanySchema.parse({})).toEqual({});
  });

  it('rejects a bad email and a non-http(s) / protocol-relative social URL', () => {
    expect(() => CompanySchema.parse({ email: 'not-an-email' })).toThrow();
    expect(() => CompanySchema.parse({ social: ['javascript:alert(1)'] })).toThrow();
    expect(() => CompanySchema.parse({ social: ['//evil.com'] })).toThrow();
    expect(() => CompanySchema.parse({ social: ['/relative'] })).toThrow();
  });

  it('allows the businessType sentinel "disabled" (suppresses schema.org downstream)', () => {
    expect(CompanySchema.parse({ businessType: 'disabled' }).businessType).toBe('disabled');
  });
});
