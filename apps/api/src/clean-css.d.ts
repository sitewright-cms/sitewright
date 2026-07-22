// Minimal ambient types for clean-css (the package ships none, and we avoid pulling in @types/clean-css).
declare module 'clean-css' {
  interface Output {
    styles: string;
    errors: string[];
    warnings: string[];
  }
  interface Options {
    returnPromise?: boolean;
    level?: number;
  }
  export default class CleanCSS {
    constructor(options?: Options);
    minify(source: string): Output;
  }
}
