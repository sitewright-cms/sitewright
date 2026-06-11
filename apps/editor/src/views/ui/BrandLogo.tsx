import { BrandMark } from './BrandMark';

/**
 * The platform logo: the uploaded image when an instance admin has set one, else the built-in
 * {@link BrandMark} SVG. `className` sizes both forms identically (the `<img>` is contained, so a
 * non-square upload never distorts). Used by the login wordmark, the header brand button, and the
 * project selector — all fed `logoUrl`/`name` from `useBranding()`.
 */
export function BrandLogo({ logoUrl, name, className = 'h-[22px] w-[22px]' }: { logoUrl: string | null; name: string; className?: string }) {
  if (logoUrl) {
    return <img src={logoUrl} alt={name} className={`${className} object-contain`} />;
  }
  return <BrandMark className={className} />;
}
