import { defineConfig } from 'vitest/config';

// Unit tests: fast, no infrastructure required.
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
  },
});
