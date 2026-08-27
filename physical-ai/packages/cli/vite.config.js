const PACKAGE_ROOT = __dirname;

/** @type {import('vite').UserConfig} */
const config = {
  root: PACKAGE_ROOT,
  test: {
    globals: true,
    include: ['src/**/*.spec.ts'],
  },
};

export default config;
