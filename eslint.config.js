// ESLint flat config — 정적 분석 (P0 안전망)
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'public/**', 'dist/**'] },
  js.configs.recommended,
  {
    // 앱 소스 — 브라우저 환경
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-console': 'off',
      eqeqeq: ['warn', 'smart'],
    },
  },
  {
    // 설정·도구·테스트 — Node 환경
    files: ['*.config.{js,mjs}', 'tools/**/*.{js,mjs}', 'tests/**/*.{js,mjs}', '**/*.test.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
];
