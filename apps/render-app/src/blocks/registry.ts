import { z } from 'zod';

/**
 * The block registry: the set of block types the renderer understands, each with
 * a Zod schema describing its `props`. The editor will use these schemas to drive
 * the inspector; the renderer uses them to validate/normalize props before render.
 *
 * The actual Astro components are wired in `BlockTree.astro` (Astro components
 * cannot be imported into plain `.ts`); this registry is the type metadata.
 */
export const blockRegistry = {
  Section: z.object({ tone: z.enum(['surface', 'muted', 'primary']).optional() }),
  Hero: z.object({
    title: z.string().optional(),
    titleField: z.string().optional(),
    subtitle: z.string().optional(),
    ctaText: z.string().optional(),
    ctaHref: z.string().optional(),
  }),
  Heading: z.object({
    text: z.string().optional(),
    textField: z.string().optional(),
    level: z.number().int().min(1).max(6).optional(),
  }),
  RichText: z.object({
    text: z.string().optional(),
    textField: z.string().optional(),
  }),
  Image: z.object({
    src: z.string().optional(),
    srcField: z.string().optional(),
    alt: z.string().optional(),
    altField: z.string().optional(),
  }),
  Grid: z.object({ columns: z.number().int().min(1).max(4).optional() }),
  Card: z.object({}),
  Button: z.object({
    text: z.string().optional(),
    textField: z.string().optional(),
    href: z.string().optional(),
    hrefField: z.string().optional(),
  }),
  Link: z.object({
    text: z.string().optional(),
    textField: z.string().optional(),
    href: z.string().optional(),
    hrefField: z.string().optional(),
  }),
  Header: z.object({ brand: z.string().optional() }),
  Footer: z.object({ text: z.string().optional() }),
} as const satisfies Record<string, z.ZodTypeAny>;

export type BlockType = keyof typeof blockRegistry;

/** Type names the renderer knows how to render. */
export const knownBlockTypes = Object.keys(blockRegistry) as BlockType[];

/** Whether a block type is registered. */
export function isKnownBlockType(type: string): type is BlockType {
  return Object.prototype.hasOwnProperty.call(blockRegistry, type);
}
