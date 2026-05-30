// Block descriptors: the single source of truth for the editor's block palette
// and prop forms. Every type here MUST have a matching branch in render.ts (and,
// in production, an Astro component) — the descriptors test guards that.

/** Supported prop-form input kinds. */
export type FieldInput = 'text' | 'textarea' | 'number' | 'url' | 'select' | 'boolean';

/** A single editable prop on a block. */
export interface FieldDescriptor {
  /** Prop key written into `node.props`. */
  key: string;
  label: string;
  input: FieldInput;
  /** Options for `select` inputs (value + human label). */
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** Default value seeded into a freshly-added block. */
  default?: string | number | boolean;
  placeholder?: string;
}

/** Palette grouping. */
export type BlockCategory = 'layout' | 'content' | 'nav';

/** Editor + renderer metadata for one block type. */
export interface BlockDescriptor {
  type: string;
  label: string;
  category: BlockCategory;
  /** Whether the block accepts child blocks (renders a slot). */
  container: boolean;
  fields: ReadonlyArray<FieldDescriptor>;
}

const levelOptions = [1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `H${n}` }));
const columnOptions = [1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `${n} cols` }));
const toneOptions = [
  { value: 'surface', label: 'Surface' },
  { value: 'primary', label: 'Primary' },
  { value: 'muted', label: 'Muted' },
];

export const BLOCK_DESCRIPTORS: ReadonlyArray<BlockDescriptor> = [
  // --- layout ---
  {
    type: 'Section',
    label: 'Section',
    category: 'layout',
    container: true,
    fields: [{ key: 'tone', label: 'Tone', input: 'select', options: toneOptions, default: 'surface' }],
  },
  {
    type: 'Grid',
    label: 'Grid',
    category: 'layout',
    container: true,
    fields: [{ key: 'columns', label: 'Columns', input: 'select', options: columnOptions, default: 3 }],
  },
  { type: 'Card', label: 'Card', category: 'layout', container: true, fields: [] },
  // --- content ---
  {
    type: 'Hero',
    label: 'Hero',
    category: 'content',
    container: true,
    fields: [
      { key: 'title', label: 'Title', input: 'text' },
      { key: 'subtitle', label: 'Subtitle', input: 'textarea' },
      { key: 'ctaText', label: 'CTA text', input: 'text' },
      { key: 'ctaHref', label: 'CTA link', input: 'url', placeholder: '/contact' },
    ],
  },
  {
    type: 'Heading',
    label: 'Heading',
    category: 'content',
    container: false,
    fields: [
      { key: 'text', label: 'Text', input: 'text' },
      { key: 'level', label: 'Level', input: 'select', options: levelOptions, default: 2 },
    ],
  },
  {
    type: 'RichText',
    label: 'Rich text',
    category: 'content',
    container: false,
    fields: [{ key: 'text', label: 'Text', input: 'textarea' }],
  },
  {
    type: 'Image',
    label: 'Image',
    category: 'content',
    container: false,
    fields: [
      { key: 'src', label: 'Source URL', input: 'url', placeholder: '/photo.jpg' },
      { key: 'alt', label: 'Alt text', input: 'text' },
      { key: 'priority', label: 'Eager load (LCP)', input: 'boolean' },
    ],
  },
  {
    type: 'Button',
    label: 'Button',
    category: 'content',
    container: false,
    fields: [
      { key: 'text', label: 'Label', input: 'text', default: 'Click me' },
      { key: 'href', label: 'Link', input: 'url', placeholder: '/' },
    ],
  },
  {
    type: 'Icon',
    label: 'Icon',
    category: 'content',
    container: false,
    fields: [
      // UI glyph (Lucide) by bare name, or a brand/social logo as `brand:<slug>`
      // (e.g. `brand:github`). See ICON_NAMES / BRAND_ICON_NAMES for the picker.
      { key: 'name', label: 'Icon name', input: 'text', placeholder: 'menu or brand:github', default: 'star' },
      { key: 'size', label: 'Size (px)', input: 'number', default: 24 },
      { key: 'label', label: 'Accessible label', input: 'text' },
      // Brand icons only: render in the brand's official color (else currentColor).
      { key: 'brandColor', label: 'Use brand color', input: 'boolean' },
    ],
  },
  // --- nav ---
  {
    type: 'Link',
    label: 'Link',
    category: 'nav',
    container: false,
    fields: [
      { key: 'text', label: 'Label', input: 'text' },
      { key: 'href', label: 'Link', input: 'url', placeholder: '/' },
    ],
  },
  {
    type: 'Nav',
    label: 'Navigation',
    category: 'nav',
    container: true,
    fields: [
      {
        key: 'slot',
        label: 'Menu',
        input: 'select',
        options: [
          { value: 'header', label: 'Header' },
          { value: 'footer', label: 'Footer' },
          { value: 'mobile', label: 'Mobile' },
        ],
        default: 'header',
      },
    ],
  },
  {
    type: 'Header',
    label: 'Header',
    category: 'nav',
    container: true,
    fields: [{ key: 'brand', label: 'Brand name', input: 'text' }],
  },
  {
    type: 'Footer',
    label: 'Footer',
    category: 'nav',
    container: true,
    fields: [{ key: 'text', label: 'Text', input: 'text' }],
  },
];

const BY_TYPE = new Map<string, BlockDescriptor>(BLOCK_DESCRIPTORS.map((d) => [d.type, d]));

/** Looks up a descriptor by block type. */
export function descriptorFor(type: string): BlockDescriptor | undefined {
  return BY_TYPE.get(type);
}

/** Whether a block type accepts child blocks. */
export function isContainerType(type: string): boolean {
  return descriptorFor(type)?.container ?? false;
}

/** Builds an initial `props` object from a descriptor's field defaults. */
export function defaultPropsFor(type: string): Record<string, unknown> {
  const descriptor = descriptorFor(type);
  if (!descriptor) return {};
  // Computed keys in a fresh object literal (not dynamic indexing of an existing
  // object), so this stays clear of the object-injection lint rule.
  return descriptor.fields.reduce<Record<string, unknown>>(
    (acc, field) =>
      field.default !== undefined ? { ...acc, [field.key]: field.default } : acc,
    {},
  );
}
