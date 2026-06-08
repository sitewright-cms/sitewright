/**
 * A page-shaped loading placeholder for the preview iframe: a faux navbar, a hero, a couple of body
 * paragraphs, and a card grid — each a DaisyUI `.skeleton` shimmer. Reads as "a page is loading"
 * rather than one blank shimmer block. Purely decorative (the live region / sr-only label lives in
 * {@link PreviewPane}).
 */
export function PreviewSkeleton() {
  return (
    <div aria-hidden className="flex h-full w-full flex-col gap-6 overflow-hidden rounded-xl bg-white p-6">
      {/* Navbar: brand + nav links + a CTA pill */}
      <div className="flex items-center justify-between">
        <div className="skeleton h-7 w-32 rounded-lg" />
        <div className="flex items-center gap-3">
          <div className="skeleton h-4 w-14 rounded" />
          <div className="skeleton h-4 w-14 rounded" />
          <div className="skeleton h-4 w-14 rounded" />
          <div className="skeleton h-8 w-24 rounded-lg" />
        </div>
      </div>

      {/* Hero: a big heading, a couple of subtitle lines, two buttons */}
      <div className="mt-4 flex flex-col items-center gap-4 py-6">
        <div className="skeleton h-9 w-2/3 rounded-lg" />
        <div className="skeleton h-4 w-1/2 rounded" />
        <div className="skeleton h-4 w-2/5 rounded" />
        <div className="mt-2 flex gap-3">
          <div className="skeleton h-10 w-32 rounded-lg" />
          <div className="skeleton h-10 w-32 rounded-lg" />
        </div>
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-3 rounded-xl border border-slate-100 p-4">
            <div className="skeleton h-10 w-10 rounded-lg" />
            <div className="skeleton h-4 w-3/4 rounded" />
            <div className="skeleton h-3 w-full rounded" />
            <div className="skeleton h-3 w-5/6 rounded" />
          </div>
        ))}
      </div>

      {/* A trailing band */}
      <div className="mt-auto flex flex-col gap-2">
        <div className="skeleton h-3 w-full rounded" />
        <div className="skeleton h-3 w-11/12 rounded" />
        <div className="skeleton h-3 w-4/5 rounded" />
      </div>
    </div>
  );
}
