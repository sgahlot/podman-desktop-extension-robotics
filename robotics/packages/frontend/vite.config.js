import { join } from 'path';
import * as path from 'path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';

const filename = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.dirname(filename);
const REPO_ROOT = join(PACKAGE_ROOT, '../../..');

export default defineConfig({
  mode: process.env.MODE,
  root: PACKAGE_ROOT,
  resolve: {
    alias: {
      '/@/': join(PACKAGE_ROOT, 'src') + '/',
      '/@shared/': join(PACKAGE_ROOT, '../shared') + '/',
      '/@docs/': join(REPO_ROOT, 'robotics/docs/img') + '/',
    },
  },
  plugins: [svelte({ hot: !process.env.VITEST }), svelteTesting()],
  test: {
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    globals: true,
    environment: 'jsdom',
  },
  base: '',
  server: {
    fs: {
      strict: true,
      allow: [PACKAGE_ROOT, REPO_ROOT],
    },
  },
  build: {
    sourcemap: true,
    outDir: '../backend/media',
    assetsDir: '.',
    emptyOutDir: true,
    reportCompressedSize: false,
  },
});
