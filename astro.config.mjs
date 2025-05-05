// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  markdown: {
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
    },
  },
  site: 'https://alan-j-hu.github.io',
})
