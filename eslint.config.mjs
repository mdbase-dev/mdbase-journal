import tseslint from 'typescript-eslint';

export default tseslint.config({
  files: ['**/*.ts', '**/*.mjs'],
  languageOptions: { parser: tseslint.parser },
  rules: {
    'constructor-super': 'error',
    'for-direction': 'error',
    'no-async-promise-executor': 'error',
    'no-constant-binary-expression': 'error',
    'no-dupe-args': 'error',
    'no-duplicate-case': 'error',
    'no-self-assign': 'error',
    'no-unreachable': 'error',
    'no-unsafe-finally': 'error',
    'use-isnan': 'error',
    'valid-typeof': 'error',
  },
});
