import sveltePreprocess from 'svelte-preprocess';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  preprocess: sveltePreprocess({
    postcss: {
      configFilePath: join(__dirname, 'postcss.config.cjs'),
    },
  }),
};
