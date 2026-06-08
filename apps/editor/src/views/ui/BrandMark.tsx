/**
 * The Sitewright brand mark — "the Wright's Square": an ink square (currentColor) with a teal +
 * indigo block stacked inside. Shared by the header brand button and the project selector so the
 * logo is defined once. Sizes via `className` (default 22px square); the stroke takes currentColor.
 */
export function BrandMark({ className = 'h-[22px] w-[22px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 96" fill="none" aria-hidden="true" className={className}>
      <path d="M30 18 V72 H78" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="40" y="52" width="26" height="14" rx="3" fill="#14B8A6" />
      <rect x="40" y="35" width="26" height="14" rx="3" fill="#4F2DD8" />
    </svg>
  );
}
