# 누리의 한글 왕국 — 장기 운영 로드맵

> 미취학 아동용 한글 학습 웹앱을 **장기 프로젝트로 안정적으로 개발·운영**하기 위한 구조 개선 로드맵.
> 코드베이스를 6개 관점(아키텍처·빌드/배포·테스트·콘텐츠·성능/접근성·신뢰성)으로 분석해 하나의 실행 계획으로 종합했다.
> 표기: **effort** S(<0.5일)/M(~2일)/L(~1주)/XL(>1주) · **우선순위** P0(지금)/P1(곧)/P2(여유)/P3(선택)

---

## 0. 핵심 통찰

여섯 관점이 다른 얘기처럼 보이지만, 실제로는 **"무빌드 정적 → 빌드 기반"으로 넘어가는 하나의 전환 축** 위에 놓여 있다.

- **타입 · 테스트 · 수명주기는 분리된 3개 과제가 아니라 한 덩어리다.** 지금까지 반복해서 잡은 버그 — 자산 경로 드리프트(`.jpg`↔`.png`), 조사 을/를 비문, 화면 이탈 후 TTS·타이머 누수 — 의 뿌리가 전부 "타입으로 잡을 수 있었는데 안 잡았고, 테스트가 없어 몰랐고, 수명주기 계약이 없어 재발"이라는 **같은 구멍**이다. 그래서 TypeScript 도입은 테스트·빌드와 **따로 가면 안 되고 같이 짜야** 한다(§3).
- **급한 건 Vite가 아니라 안전망이다.** 캐시 깨짐·백지 화면·배포 재시도 같은 실통증부터 **무빌드로** 끄고, Vite는 서비스워커·에셋 최적화·번들이 실제로 빌드를 요구하는 Phase 2에 들인다. `.ts` 실파일 전환은 트리거 기반 Phase 3 선택.
- **관통 원칙 = "작게, 무빌드로, 배포 무위험부터."** 첫 6주는 런타임·배포 산출물을 한 글자도 안 바꾸고 dev 의존만 늘려 안전망을 친다. 구조를 뜯는 L 작업(AbortSignal 전면화·Vite)은 그물을 친 뒤에 한다.

---

## 1. 현재 드러난 구조 부채 (구체 근거)

| 영역 | 문제 | 근거 |
|---|---|---|
| **신뢰성** | 화면 수명주기를 손으로 관리 — DOM 노드에 `_dead/_token/_onShow` monkey-patch + 게임마다 `seq/mySeq` 가드 복붙 → **4중 이탈 판정**. 새 async 경계마다 수동 재검사를 잊으면 분리된 DOM에 콜백·TTS 발화 | `app.js`(24·30·39), `stage.js`·`result.js`·`festival.js`·`match.js`·`story.js`, 모든 게임의 `seq` |
| **에러 경계** | `window.onerror`/`unhandledrejection` **0건**. `boot()`이 8개 화면 모듈을 `await import` — 하나만 실패해도 `#app`이 **영구 백지**, 유아·보호자에게 폴백 없음 | `app.js` boot |
| **테스트** | 자동화 테스트 **0건**. 순수 로직(hangul 조합/분해·조사, store 별점/잠금)은 테스트하기 쉬운데도 방치 | `.github` 없음, `package.json`에 `start`만 |
| **타입** | 타입 안전망 없어 데이터 드리프트가 런타임에서만 드러남. `Kingdom.type`은 완벽한 판별 유니온 후보인데 미적용 | `data.js`(`.jpg` 참조 vs 실제 `.png`였던 사고), `stage.js` `k.type` 분기 |
| **자산** | 저장소 135MB 중 실사용 5.4MB. **미참조 원본 68MB**(raw 컨셉 19MB·`*_master_*` 8.6MB·`*_transparent*`·배경 PNG 24MB)가 GitHub Pages로 **공개 서빙** 중 | `public/assets/images/raw`, `*_master_v*.png` |
| **배포** | 브랜치 배포 큐 충돌·재시도 고통(빈 "retry" 커밋), 캐시버스팅·CI·롤백·스테이징 부재. 파일명 고정이라 배포 후 스테일 캐시 | git log `trigger rebuild`/`retry deployment`, `.github` 없음 |
| **상태** | `store.get()`이 복제본이 아닌 **live state 반환**(우회 변이 가능). 왕국 순서가 `store.js`·`data.js` 이중 정의. `DEFAULT.stars` 길이가 스테이지 수에 수동 결합 | `store.js`(49·90), `data.js`(160) |
| **에셋 파이프라인** | 배경 제거(Vision)·최적화(Pillow) 스크립트가 **저장소에 없음**(임시 스크립트로만 존재) → 새 캐릭터 산출 재현 불가·개인 종속 | `tools/` 없음 |
| **성능** | 외부 폰트(Google Fonts) 렌더블로킹 → 오프라인 불가·프라이버시. 이미지 WebP/AVIF·지연로딩·프리로드 미적용. SW 0건이라 PWA 표방 대비 실제 오프라인 불가 | `index.html`, `manifest.webmanifest` |
| **접근성** | `user-scalable=no`/`maximum-scale`(WCAG 1.4.4 위배), `:focus-visible` 없음, 앱 내 모션 토글 없음(OS 설정 의존), 사진 배경 위 텍스트 명암비 미검증 | `index.html`, `style.css` |

---

## 2. Phase 1 / 2 / 3 실행 로드맵

### Phase 1 — 안전망 + 출혈 차단 (약 0–6주, 전부 무빌드·배포 무위험)

> 목표: 회귀를 잡는 그물을 먼저 치고, 지금 아픈 급한 불(백지·캐시·배포 재시도·데이터 손실·마스터 유출)을 끈다. 런타임/배포 산출물 불변, dev 의존만 추가.

| 항목 | effort | P | 지금 왜 |
|---|---|---|---|
| **정적분석·타입체크 기반** — ESLint(flat)+Prettier+EditorConfig+`jsconfig`(strict/checkJs/noEmit)+`// @ts-check`(hangul/data/store)+npm scripts | S | **P0** | 자산 드리프트를 런타임 전에 잡는 최저비용 그물. 이후 CI·TS·테스트 전부의 진입점 |
| **Vitest 하니스 + 순수로직 테스트** — hangul 조합/분해/조사 → data 무결성(자모40·자음19/모음21·받침·예시단어 첫소리 일치) → store 잠금/별점 | M (hangul/data 먼저 S) | **P0** | compose 오프바이원 하나가 전 게임 프롬프트를 비문화하는데 감지 수단이 수동뿐 |
| **CI 게이트** — GH Actions: `npm ci` → typecheck+lint+test, 브랜치 보호 | S | **P0** | 테스트·타입은 강제 안 하면 썩는다 |
| **전역 에러 경계 + boot() 폴백** — `window.onerror`/`unhandledrejection` + "다시 시작할까요?" 재시도 카드, boot try/catch | S | **P0** | 모듈 import 하나 실패 = 유아 앞 영구 백지. 독립·초저비용 |
| **GH Actions 공식 Pages 배포 + `concurrency{group:pages,cancel-in-progress}`** | M | **P0** | 배포 큐 충돌·재시도 지옥 종료 |
| **캐시버스팅 최소안** — 배포 시 CSS/JS에 커밋 해시 쿼리 스탬프 | S | **P0** | 세션 중 실제 겪은 구 CSS 캐시를 Vite 없이 즉시 해결 |
| **미참조 자산 68MB 워킹트리 제거 + `.gitignore`**(raw/·`*_master_*`·`*_transparent*`) | S/M | **P0** | 미사용 원본이 Pages로 공개 서빙(아동앱 유출·용량). 히스토리 정리는 후속 |
| **localStorage 스키마 버저닝·마이그레이션**(`schemaVersion`+순차 마이그레이션+안전 백업) | S | P1 | 저장 구조 변경이 복귀 아동 진행도를 조용히 파괴하는 것 방지 |
| **AbortSignal 파일럿** — `listen.js` 1개에 signal 주입·취소가능 sleep/speak 적용 | S/M | P0(파일럿) | L 전면 리팩터 리스크를 한 파일로 검증 |
| **확대 차단 제거**(`user-scalable=no`/`maximum-scale`) | S | P1 | WCAG 1.4.4 위배. 더블탭 줌은 이미 `touch-action`이 억제 |

### Phase 2 — 구조 정리 + 타입 심화 + 빌드 승격 + PWA + 콘텐츠 (약 6–16주)

**2a. 구조·타입·신뢰성**

| 항목 | effort | P | 의존 |
|---|---|---|---|
| **도메인 타입 모델링** — `types.d.ts`, `Kingdom` 판별 유니온, `GameContext{signal}`, `Screen` 계약 | L | P1 | ← 정적분석 기반 |
| **AbortSignal 수명주기 전면화 + Screen 계약 객체화** `{el, onShow(signal), onHide()}` — `_dead`/`seq`/`isAlive` 4중 가드 제거 | L | P1 | ← 파일럿, 도메인 타입 (§3: 타입과 같은 작업) |
| **store 불변 반환 + progression 모듈 + 진도 스테이지 id화** | M | P1 | ← 도메인 타입, 스키마 버저닝 |
| **TTS 엔진 단일화** — `voiceschanged` 경쟁 해소(showModel 오고정 수정), Chrome keepalive, 매직넘버 정리, signal 연동 | M | P1 | ← AbortSignal |
| **audio.speak 경쟁조건 테스트**(fake timer + speechSynthesis 목) | L | P1 | ← 테스트 하니스 |
| **테스트 가능성 리팩터**(starsFor/makeBossQuestions/pickDistractors, rng 주입) | M | P1 | ← 테스트 하니스 |
| **모듈 경계 재정비** — router/boot 분리, 명시적 화면 레지스트리, `ui.js` 3분할(dom/util/fx), import 계층 린트 | M | P2 | ← AbortSignal |
| **문서화** — ARCHITECTURE.md/CLAUDE.md/CONTRIBUTING(수명주기 계약 명문화) | M | P2 | ← 새 수명주기 확정 후 |
| **개발용 디버그 오버레이**(`?debug`: 화면명·navToken·활성 signal·타이머·speak 큐) | S | P2 | |

**2b. 빌드 승격 + 자산 + PWA** (여기서 무빌드→빌드 전환)

| 항목 | effort | P | 의존 |
|---|---|---|---|
| **Vite 번들러 도입**(해시 파일명·번들·최소화·index.html 자동 주입) | M | P1 | 캐시버스팅 최소안 대체 |
| **Jua 셀프호스팅 + 한글 서브셋**(woff2, unicode-range) | M | P1 | |
| **WebP/AVIF 전환 + `<picture>`/`image-set()`** | L | P1 | |
| **서비스워커 오프라인 PWA**(Workbox/vite-plugin-pwa) | M | P1 | ← Vite·폰트·이미지 |
| **녹음 오디오 폴백**(필수 음가 opus 번들) — ko-KR 음성 없는 기기의 무음 방지 | L | P1 | ← SW |
| **에셋 파이프라인 코드화**(`tools/assets`, rembg/Pillow 버전 핀, `make assets`) | M | P1 | |
| **소스/빌드 분리 + git 히스토리 정리**(assets-src or LFS, filter-repo) | L | P1 | ← 파이프라인 코드화 |
| **초기 로딩·프리로드**(동적 import, `<link rel=preload>`, fetchpriority) | M | P2 | ← Vite |
| **Sentry + 프라이버시 분석**(Plausible/Umami) | M | P2 | |
| **릴리스·환경 분리 + 롤백**(semver tag, staging/PR 프리뷰, 원클릭 재실행) | M | P2 | ← GH Actions |

**2c. 콘텐츠·QA·접근성 마감**

| 항목 | effort | P | 의존 |
|---|---|---|---|
| **버전드 JSON 콘텐츠팩 + JSON Schema + 검증 로더**(data.js는 어댑터로 축소) | L | P2 | |
| **단어·이모지 정규화 어휘표 `words.json`**(hasBatchim 데이터화) | M | P2 | ← 콘텐츠팩 |
| **자산 매니페스트 + 데이터↔파일 무결성 검증** | M | P2 | ← 콘텐츠팩 |
| **E2E Playwright**(Chromium+WebKit, 시드 점프, showModel 경로) | L | P2 | ← CI |
| **시각 회귀**(toHaveScreenshot, reducedMotion, 반응형 브레이크포인트 매트릭스) | M | P2 | ← E2E |
| **인라인 스타일 제거 → 공유 뷰 컴포넌트 + CSS 토큰** | L | P2 | |
| **접근성 마감**(터치타깃 44px 하한 / `:focus-visible` / 모션 토글 / 명암비) | 각 S~M | P2 | |

### Phase 3 — 확장·플랫폼화 (약 16주+, 트리거 기반 선택)

| 항목 | effort | P | 트리거 / 의존 |
|---|---|---|---|
| **게임 엔진 레지스트리 + 데이터 주도 활동**(`registerGame`, `stage.activities` 선언) | M | P3 | 게임 유형 추가가 잦아질 때. 새 왕국=JSON 1개+게임 1개 |
| **i18n 레이어 + 교습/UI 언어 분리** | L | P3 | 해외 보호자·타언어 학습팩 수요 |
| **헤드리스 CMS/저작 도구**(Decap→Sanity) | XL | P3 | 비개발자 편집 워크플로 필요 규모 |
| **`.ts` + Vite 승격** | M | P3 | **기여자 증가 / 모듈 20개 초과 / JSDoc 유지비 체감** 시. 아니면 @ts-check 유지 |
| **Lighthouse CI + 성능 예산** | L | P3 | ← Vite·자산 |
| **크로스브라우저·접근성 릴리스 게이트**(WebKit 매트릭스, @axe-core) | M | P3 | ← E2E·시각회귀 |

---

## 3. TypeScript 통합 경로

TS를 "언젠가 하는 별도 프로젝트"가 아니라, **테스트·빌드·수명주기 리팩터의 뼈대**로 엮는다. 핵심은 **빌드 없이 타입부터 켜고, 타입 계약이 테스트·리팩터를 끌고 가게** 하는 것.

1. **타입을 무빌드로 켠다** — `jsconfig.json`(checkJs/strict/noEmit) + `typescript` devDep + `tsc --noEmit`. 리프 순수 모듈(hangul→data→store)에 `// @ts-check`부터. 런타임·배포·파일확장자 그대로. → 여기서 `.jpg`/`.png` 부류 드리프트가 CI에서 붉게 뜬다.
2. **타입·테스트가 서로를 강화** — `tsc --noEmit`을 ESLint·Vitest와 **같은 CI 게이트**에 나란히. `data.js`를 `satisfies Record<string, Kingdom>` + `as const`로 선언 → 컴파일타임 계약, 무결성 테스트 → 런타임 계약. 같은 데이터 이중 안전망.
3. **도메인 모델이 리팩터를 지휘** — 판별 유니온·`GameContext{signal}`·**Screen 계약**을 타입으로 정의. 결정적으로 — **수명주기 리팩터(AbortSignal)와 타입 모델링은 물리적으로 같은 작업**이다. Screen을 `{el, onShow(signal), onHide()}` 계약으로 바꾸는 순간 monkey-patch가 사라지고, 그 계약을 **타입으로 먼저 못박아야** TS가 미구현 화면을 잡는다. store는 `Readonly<State>` 반환으로 우회 변이를 컴파일 단계에서 봉인.
4. **빌드는 타입이 아니라 산출물이 부를 때** — Vite는 서비스워커·에셋 최적화·번들 때문에 Phase 2에 온다(타입은 이미 무빌드로 켜져 있음). `.ts` 실파일 전환은 Vite 뒤에 저울질하는 Phase 3 선택 — JSDoc 유지비 체감 또는 기여자/모듈 임계 초과 시만. **규모 3천 줄에선 @ts-check 유지가 합리적일 수 있다.**

**한 줄 경로:** `jsconfig+@ts-check(무빌드)` → `tsc를 CI 게이트로` → `도메인 유니온 + Screen 타입 = AbortSignal 리팩터` → `Vite는 SW/에셋이 부를 때` → `.ts는 트리거 시`.

---

## 4. 첫 2주 안에 할 P0 (콕 집은 4개 + 1 예비)

> "작게 시작해 안전하게 확장" — **전부 dev 의존만 추가, 런타임·배포 산출물 불변, 서로 거의 독립, 즉시 착수 가능.**

1. **정적분석·타입체크 기반** (S) — `eslint.config.js`(flat) + `.prettierrc` + `.editorconfig` + `jsconfig.json`(strict/checkJs/noEmit) + hangul·data·store에 `// @ts-check` + `package.json` scripts(`lint`/`format`/`typecheck`). **왜 지금:** 최저비용으로 자산 드리프트를 런타임 전에 잡고, 나머지 전부의 진입점.
2. **Vitest 하니스 + hangul·data 순수 테스트** (S→M) — `compose/decompose` 왕복 불변식·조사(을/를·이/가) 벡터, data 무결성(자모40·자음19/모음21·TOWER 무받침·자음 예시단어 첫소리 일치·`KINGDOM_ORDER`/stars 길이 일치). **왜 지금:** 유니코드 오프바이원 하나가 전 게임 프롬프트를 비문화하는데 감지 수단이 수동뿐.
3. **CI 게이트** (S) — `.github/workflows/ci.yml`: push/PR → `npm ci` → `typecheck`+`lint`+`test`, 브랜치 보호. **왜 지금:** 테스트·타입은 강제 안 하면 썩는다.
4. **전역 에러 경계 + boot() 폴백** (S) — `window.addEventListener('error'|'unhandledrejection')` + boot try/catch → "다시 시작할까요?" 재시도 카드. **왜 지금:** 모듈 import 하나 실패 = 유아 앞 영구 백지.

**예비 5번:** GH Actions 배포 + concurrency 직렬화 + 커밋 해시 캐시버스팅 (S/M) — Vite 없이 배포 재시도·스테일 캐시를 즉시 종료. 여력 되면 **미참조 68MB 워킹트리 제거**도 함께.

> 이 5개는 전부 **"배포물 0바이트 변경 + dev 의존만"** 이라 승인·리뷰 부담이 가장 낮고, 끝나는 순간 이후 모든 L 리팩터(AbortSignal 전면화·Vite·store 재설계·콘텐츠 JSON화)를 회귀 없이 진행할 안전한 기반이 선다.

---

_이 로드맵은 코드베이스 6개 관점 멀티에이전트 분석(2026-07-05)을 종합한 것이다. 진행하며 갱신한다._
