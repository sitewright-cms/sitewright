/** A single generated image file (one format at one width). */
export interface ImageVariant {
  format: 'avif' | 'webp';
  width: number;
  height: number;
  /** File name relative to the output directory. */
  path: string;
}

/** The result of optimizing one source image. */
export interface OptimizedImage {
  /** Intrinsic width of the source image (for `width`/`height` attrs → no CLS). */
  width: number;
  height: number;
  /** Tiny blurred inline data-URI placeholder (LQIP). */
  placeholder: string;
  /** Responsive AVIF/WebP variants. */
  variants: ImageVariant[];
  /** File name of the fallback (largest width, JPEG) for `<img>`. */
  fallback: string;
}

export interface OptimizeOptions {
  /** Responsive target widths (source is never upscaled). Default: 400/800/1200. */
  widths?: number[];
  /** Output formats in `<source>` precedence order. Default: avif, webp. */
  formats?: Array<'avif' | 'webp'>;
  /** Encoder quality (1–100). Default: 70. */
  quality?: number;
}
