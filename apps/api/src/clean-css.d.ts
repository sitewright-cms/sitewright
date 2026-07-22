// Minimal ambient types for clean-css (the package ships none, and we avoid pulling in @types/clean-css).
declare module 'clean-css' {
  interface Output {
    styles: string;
    errors: string[];
    warnings: string[];
  }
  interface Options {
    returnPromise?: boolean;
    // A numeric optimization level (0/1/2) OR the granular form `{ 1: { all: false, … } }` that toggles
    // individual level-1/2 optimizations (we disable level-1 `all` to stop clean-css silently dropping
    // modern CSS it can't model — see minify.ts).
    level?: number | { [level: number]: boolean | { [option: string]: boolean | number | string } };
  }
  export default class CleanCSS {
    constructor(options?: Options);
    minify(source: string): Output;
  }
}
