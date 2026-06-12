import type { Form } from '@sitewright/schema';

// ---------------------------------------------------------------- contact form
export const EXAMPLE_FORMS: Form[] = [
  {
    id: 'contact',
    name: 'Project enquiry',
    fields: [
      { name: 'name', label: 'Your name', type: 'text', required: true, placeholder: 'Jane Doe' },
      { name: 'email', label: 'Email', type: 'email', required: true, placeholder: 'jane@company.com' },
      { name: 'company', label: 'Company', type: 'text', required: false, placeholder: 'Acme Inc.' },
      { name: 'budget', label: 'Budget', type: 'select', required: false, options: ['Under $10k', '$10k – $25k', '$25k – $50k', '$50k+'] },
      { name: 'message', label: 'Tell us about your project', type: 'textarea', required: true, placeholder: 'What are you trying to achieve?' },
    ],
    submitLabel: 'Send enquiry',
    successMessage: 'Thanks — we’ve got your enquiry and will reply within one business day.',
    errorMessage: 'Sorry, that didn’t go through. Please email us at hello@northwindstudio.com.',
    recipient: 'hello@northwindstudio.com',
    mode: 'globalSmtp',
    hcaptcha: false,
  },
];
