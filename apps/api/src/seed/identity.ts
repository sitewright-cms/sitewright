// ---------------------------------------------------------------- corporate identity
export const EXAMPLE_IDENTITY = {
  name: 'Northwind Web Studio',
  legalName: 'Northwind Web Studio Ltd.',
  shortName: 'Northwind',
  slogan: 'Websites that mean business.',
  description:
    'A boutique web studio that designs and builds fast, beautiful, conversion-focused websites for ambitious brands.',
  businessType: 'ProfessionalService',
  email: 'hello@northwindstudio.com',
  telephone: '+1 (415) 555-0142',
  address: {
    street: '548 Market Street, Suite 200',
    locality: 'San Francisco',
    region: 'CA',
    country: 'USA',
    postalCode: '94104',
  },
  social: [
    { link: 'https://twitter.com/northwindstudio', name: 'X', icon: 'brand:x' },
    { link: 'https://www.linkedin.com/company/northwindstudio', name: 'LinkedIn', icon: 'linkedin' },
    { link: 'https://dribbble.com/northwindstudio', name: 'Dribbble', icon: 'brand:dribbble' },
  ],
  // The six mandatory brand tokens → DaisyUI/Tailwind theme colors (the -content foregrounds are
  // auto-derived for contrast). `base-100`/`base-content` are the page Background/Text colors.
  colors: {
    primary: '#4f46e5',
    secondary: '#0ea5e9',
    accent: '#f59e0b',
    neutral: '#171627',
    'base-100': '#ffffff',
    'base-content': '#1a1a23',
  },
} as const;
