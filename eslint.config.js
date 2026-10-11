const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const figmaPlugin = require('@figma/eslint-plugin-figma-plugins');
const globals = require('globals');

module.exports = tseslint.config(
  { ignores: ['code.js', 'ui.html', 'out/**', 'dist/**', 'artifacts/**', 'node_modules/**'] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['code.ts', 'src/**/*.ts', 'tests/**/*.ts', 'tests/*.mjs', 'scripts/*.mjs'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['code.ts'],
    plugins: { '@figma/figma-plugins': figmaPlugin },
    rules: { ...figmaPlugin.configs.recommended.rules },
  },
  {
    files: ['tests/*.mjs', 'scripts/check-figui.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  { files: ['scripts/*.mjs', 'eslint.config.js'], languageOptions: { globals: globals.node } },
  { files: ['eslint.config.js'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
);
