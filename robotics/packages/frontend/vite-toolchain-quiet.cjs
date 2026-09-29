/**
 * Must load before `@sveltejs/vite-plugin-svelte` (that package captures `console.log` at import).
 */
const skip = msg =>
  msg.includes('Support for vite 8 beta in vite-plugin-svelte') ||
  msg.includes('vite-plugin-svelte/issues/1143');

const origLog = console.log;
const origWarn = console.warn;

console.log = (...args) => {
  if (skip(args.map(String).join(' '))) return;
  origLog(...args);
};

console.warn = (...args) => {
  if (skip(args.map(String).join(' '))) return;
  origWarn(...args);
};
