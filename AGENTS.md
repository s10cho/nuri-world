# Repository Guidelines

## Project Structure & Module Organization

This repository contains a Vite-based Korean Hangul learning web app with Capacitor native targets.

- `index.html`, `css/style.css`, and `js/` hold the browser app.
- `js/app.js` is the app entry point; reusable logic lives in `js/hangul.js`, `js/data.js`, `js/store.js`, `js/audio.js`, and `js/ui.js`.
- Screen modules are in `js/screens/`; game flows are in `js/games/`.
- Unit tests live in `tests/*.test.js`.
- Web assets are under `public/assets/`; native iOS and Android projects are under `ios/` and `android/`.
- Built output goes to `dist/` and should be treated as generated.

## Build, Test, and Development Commands

- `npm run dev` or `npm start`: start the local Vite dev server.
- `npm run build`: create the production web build in `dist/`.
- `npm run preview`: serve the production build locally.
- `npm run typecheck`: run TypeScript checking against `jsconfig.json`.
- `npm run lint`: run ESLint.
- `npm run format:check`: check Prettier formatting for app JavaScript.
- `npm run test`: run Vitest once.
- `npm run check`: run typecheck, lint, and tests together.
- `npm run sync:ios` / `npm run sync:android`: build and sync Capacitor native projects.

## Coding Style & Naming Conventions

Use ES modules and plain JavaScript. Match the existing style: two-space indentation, semicolons, single quotes, and named exports for shared helpers. Use `camelCase` for functions and variables, `PascalCase` only for class-like constructs, and `UPPER_SNAKE_CASE` for constants such as Hangul tables. Keep browser-only code in `js/`; avoid touching generated native files unless the change is specifically native.

Run `npm run lint:fix` or `npm run format` before large edits when practical.

## Testing Guidelines

Tests use Vitest and follow the `tests/<module>.test.js` pattern. Keep tests close to pure logic and state behavior, as in `hangul.test.js`, `data.test.js`, and `store.test.js`. Add regression tests when changing Hangul composition, curriculum data, localStorage behavior, or game scoring. Use `npm run test` for focused validation and `npm run check` before submitting broader changes.

## Commit & Pull Request Guidelines

Recent commits use short conventional prefixes, often with Korean descriptions, such as `feat:`, `fix:`, and scoped forms like `feat(native):`. Keep subjects imperative and specific, for example `fix: 모바일 보스전 레이아웃 넘침 해결`.

Pull requests should include a concise summary, testing performed, linked issue if applicable, and screenshots or screen recordings for UI changes. For native changes, mention the platform tested and any required Capacitor sync/build command.
