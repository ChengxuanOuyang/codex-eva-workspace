export default [
  {
    ignores: ['node_modules/**', 'dist/**']
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {ecmaVersion: 'latest', sourceType: 'commonjs'}
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {ecmaVersion: 'latest', sourceType: 'module'}
  }
];
