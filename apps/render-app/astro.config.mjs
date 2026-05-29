import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Static-first output: zero runtime JS by default, optimized HTML/CSS.
export default defineConfig({
  output: 'static',
  compressHTML: true,
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
