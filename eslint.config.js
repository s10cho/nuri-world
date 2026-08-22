// ESLint flat config — 정적 분석 (P0 안전망)
import js from '@eslint/js';
import globals from 'globals';

export default [
  // 네이티브(android/ios)는 Capacitor가 web 번들을 복사·생성하는 폴더라 lint 대상에서 제외
  // public/ 는 생성·정적 자산 폴더라 제외하되, 손으로 쓰는 녹음 UI 스크립트는 검사한다
  { ignores: ['node_modules/**', 'public/*', 'public/*/**', '!public/voice-recorder.js', 'dist/**', 'android/**', 'ios/**'] },
  js.configs.recommended,
  {
    // 앱 소스 + 녹음 페이지 UI — 브라우저 환경
    files: ['js/**/*.js', 'public/voice-recorder.js'],
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
