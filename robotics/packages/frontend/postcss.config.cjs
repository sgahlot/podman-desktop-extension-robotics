const path = require('path');

module.exports = {
  plugins: {
    // Vitest is invoked from the monorepo root (`robotics/`); pin the config path so
    // Tailwind does not warn about an empty `content` glob.
    tailwindcss: { config: path.join(__dirname, 'tailwind.config.cjs') },
    'postcss-import': {},
    autoprefixer: {},
  },
};
