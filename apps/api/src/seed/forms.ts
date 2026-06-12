import type { Form } from '@sitewright/schema';

// ---------------------------------------------------------------- forms (per locale)
//
// One form definition per locale, named by the platform's `<id>-<locale>` convention: a `de`
// page embedding `{{sw-form "contact"}}` (or `data-sw-form="contact"`) auto-resolves the
// `contact-de` definition — translated labels/placeholders/messages, shared delivery config.
// The contact page's code stays INHERITED across locales; only the form definitions differ.

const SHARED = {
  recipient: 'hello@northwindstudio.com',
  mode: 'globalSmtp',
  hcaptcha: false,
} as const;

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
    ...SHARED,
  },
  {
    id: 'contact-de',
    name: 'Projektanfrage (DE)',
    fields: [
      { name: 'name', label: 'Ihr Name', type: 'text', required: true, placeholder: 'Erika Mustermann' },
      { name: 'email', label: 'E-Mail', type: 'email', required: true, placeholder: 'erika@firma.de' },
      { name: 'company', label: 'Unternehmen', type: 'text', required: false, placeholder: 'Muster GmbH' },
      { name: 'budget', label: 'Budget', type: 'select', required: false, options: ['Unter 10.000 $', '10.000 – 25.000 $', '25.000 – 50.000 $', 'Über 50.000 $'] },
      { name: 'message', label: 'Erzählen Sie uns von Ihrem Projekt', type: 'textarea', required: true, placeholder: 'Was möchten Sie erreichen?' },
    ],
    submitLabel: 'Anfrage senden',
    successMessage: 'Danke — Ihre Anfrage ist da. Wir melden uns innerhalb eines Werktags.',
    errorMessage: 'Das hat leider nicht geklappt. Schreiben Sie uns an hello@northwindstudio.com.',
    ...SHARED,
  },
  {
    id: 'contact-es',
    name: 'Consulta de proyecto (ES)',
    fields: [
      { name: 'name', label: 'Su nombre', type: 'text', required: true, placeholder: 'Juana Pérez' },
      { name: 'email', label: 'Correo electrónico', type: 'email', required: true, placeholder: 'juana@empresa.es' },
      { name: 'company', label: 'Empresa', type: 'text', required: false, placeholder: 'Ejemplo S.L.' },
      { name: 'budget', label: 'Presupuesto', type: 'select', required: false, options: ['Menos de 10.000 $', '10.000 – 25.000 $', '25.000 – 50.000 $', 'Más de 50.000 $'] },
      { name: 'message', label: 'Cuéntenos su proyecto', type: 'textarea', required: true, placeholder: '¿Qué quiere conseguir?' },
    ],
    submitLabel: 'Enviar consulta',
    successMessage: 'Gracias — hemos recibido su consulta y responderemos en un día laborable.',
    errorMessage: 'No se pudo enviar. Escríbanos a hello@northwindstudio.com.',
    ...SHARED,
  },
];
