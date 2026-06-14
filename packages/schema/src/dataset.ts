import { z } from 'zod';
import { IdSchema, KeyNameSchema, SlugSchema, safeRecord } from './primitives.js';

/** Supported CMS field types. `list` (an ordered, repeatable group of sub-fields) and `object`
 *  (a named sub-group) are the NESTED types: they carry their own child `fields`, so a single
 *  entry can model a config object with settings + a repeatable array (e.g. a hero Widget:
 *  `{ show_navigation, autoplay, slides: [{ image, caption }, …] }`). */
export const FieldTypeSchema = z.enum([
  'text',
  'richtext',
  'number',
  'boolean',
  'date',
  'time',
  'datetime',
  'image',
  'reference',
  'select',
  'json',
  'list',
  'object',
]);
export type FieldType = z.infer<typeof FieldTypeSchema>;

/** The nesting types — fields of these types carry child `fields`; all others must not. */
const NESTED_TYPES: ReadonlySet<FieldType> = new Set<FieldType>(['list', 'object']);

/** Caps on a dataset's field TREE — bound editor/render cost on attacker-adjacent authored schema.
 *  Depth is enforced STRUCTURALLY (the schema is built to exactly this many levels — see below — so
 *  parsing NEVER recurses deeper than this, even on a pathologically deep input; no z.lazy, no
 *  stack-overflow risk). Children-per-level and total-node count are additional semantic caps; the
 *  HTTP body-size limit is the real backstop on total parse cost. */
export const MAX_FIELD_DEPTH = 4;
export const MAX_FIELD_NODES = 1000;
const MAX_FIELD_CHILDREN = 100;

/** A single field in a dataset's schema. `list`/`object` fields hold child `fields` (≤ MAX_FIELD_DEPTH). */
export type Field = {
  name: string;
  type: FieldType;
  required: boolean;
  localized: boolean;
  /** Type-specific config: `select` options, `reference` target dataset, etc. */
  config?: Record<string, unknown>;
  /** Child fields — REQUIRED (non-empty) for `list`/`object`, forbidden otherwise. */
  fields?: Field[];
};
type FieldInput = {
  name: string;
  type: FieldType;
  required?: boolean;
  localized?: boolean;
  config?: Record<string, unknown>;
  fields?: FieldInput[];
};

const fieldConstraint = (f: { type: FieldType; name: string; fields?: unknown[] }, ctx: z.RefinementCtx): void => {
  const nests = NESTED_TYPES.has(f.type);
  if (nests && (!f.fields || f.fields.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${f.type} field "${f.name}" needs at least one child field`, path: ['fields'] });
  }
  if (!nests && f.fields !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `field "${f.name}" of type "${f.type}" cannot have child fields`, path: ['fields'] });
  }
};

/** One level of the field schema. `child` is the schema for nested `fields` (null at the deepest
 *  level → children are `z.never()`, so a `list`/`object` is impossible there and any input nested
 *  past MAX_FIELD_DEPTH fails to parse WITHOUT recursing further). */
function fieldLevel(child: z.ZodTypeAny | null): z.ZodTypeAny {
  return z
    .object({
      name: KeyNameSchema,
      type: FieldTypeSchema,
      required: z.boolean().default(false),
      localized: z.boolean().default(false),
      config: safeRecord(z.unknown()).optional(),
      fields: z.array(child ?? z.never()).max(MAX_FIELD_CHILDREN).optional(),
    })
    .superRefine(fieldConstraint);
}

let built: z.ZodTypeAny = fieldLevel(null); // deepest level (no children)
for (let d = 1; d < MAX_FIELD_DEPTH; d += 1) built = fieldLevel(built);
/** Field schema, depth-bounded to MAX_FIELD_DEPTH at parse time. */
export const FieldSchema = built as z.ZodType<Field, z.ZodTypeDef, FieldInput>;

/** Total field count across the tree (depth is already structurally bounded). */
function fieldNodeCount(fields: readonly Field[]): number {
  let n = 0;
  for (const f of fields) n += 1 + (f.fields ? fieldNodeCount(f.fields) : 0);
  return n;
}

/** A dataset definition — the CMS schema for a collection. */
export const DatasetSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1).max(200),
    slug: SlugSchema,
    fields: z.array(FieldSchema).max(500).default([]),
  })
  .superRefine((ds, ctx) => {
    const nodes = fieldNodeCount(ds.fields);
    if (nodes > MAX_FIELD_NODES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `dataset has ${nodes} fields (max ${MAX_FIELD_NODES} across the whole tree)`, path: ['fields'] });
    }
  });
export type Dataset = z.infer<typeof DatasetSchema>;

/** A single entry (row) in a dataset. `values` is a permissive record so NESTED values (a `list`
 *  field's array of objects, an `object` field's sub-record) store as-is — the field tree drives the
 *  editor, not entry-storage validation. */
export const EntrySchema = z.object({
  id: IdSchema,
  dataset: SlugSchema,
  locale: z.string().max(35).optional(),
  status: z.enum(['draft', 'published']).default('draft'),
  /**
   * Sort order within the dataset (ascending; ties broken by id). Set by drag-reordering the
   * entries list. Absent → sorts AFTER ordered entries (treated as +Infinity), so legacy entries
   * keep a deterministic id order until first reordered. Mirrors `page.order`.
   */
  order: z.number().int().min(0).max(100_000).optional(),
  values: safeRecord(z.unknown()).default({}),
});
export type Entry = z.infer<typeof EntrySchema>;
