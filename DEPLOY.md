# 앱 스토어 배포 가이드 (iOS · Android)

누리의 한글 왕국을 **하나의 웹 코드베이스**로 웹(GitHub Pages)·iOS·Android에 배포한다.
네이티브 래핑은 **Capacitor**를 쓰며, 가능한 한 **CLI 중심**(Android Studio 불필요)으로 구성했다.

- **appId(번들 ID/패키지명): `com.sycho.nuri.hangulkingdom`** — 첫 스토어 제출 후 변경 불가.
  `com.sycho.nuri.*`가 "누리" 시리즈 네임스페이스.
- 웹 빌드는 `base:'/nuri-world/'`, 네이티브 빌드는 `CAP=1`로 `base:'/'` + 서비스워커 제외.

---

## 1. 사전 설치된 툴체인 (이 맥에 구성 완료)

| 도구 | 용도 | 설치 방법 |
|------|------|-----------|
| Xcode | iOS 빌드 | (이미 설치됨) |
| CocoaPods 1.17 | iOS 의존성 | `brew install cocoapods` |
| Android SDK cmdline-tools | Android 빌드 | `brew install --cask android-commandlinetools` |
| platform 36 · build-tools 36 · platform-tools | Android 빌드 | `sdkmanager` |
| JDK 21 | Gradle | (이미 설치됨) |

CLI 빌드에 필요한 환경변수 (셸 프로필 `~/.zshrc`에 추가 권장):

```sh
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

> `android/local.properties`(gitignore됨)에 `sdk.dir`이 있어 Gradle은 환경변수 없이도 SDK를 찾는다.

---

## 2. CLI 명령 요약

| 목적 | 명령 |
|------|------|
| 웹 개발 서버 | `npm run dev` |
| 웹 배포 빌드(GitHub Pages) | `npm run build` |
| 네이티브 빌드 + 동기화(양 플랫폼) | `npm run sync` |
| Android 디버그 APK | `npm run build:apk` → `android/app/build/outputs/apk/debug/app-debug.apk` |
| Android 릴리스 AAB(스토어 업로드용) | `npm run build:aab` → `android/app/build/outputs/bundle/release/app-release.aab` |
| iOS 동기화 | `npm run sync:ios` (이후 아카이브는 아래 4번) |
| 아이콘/스플래시 재생성 | `npx capacitor-assets generate --iconBackgroundColor '#FFE082' --splashBackgroundColor '#59b8f2' --splashBackgroundColorDark '#285c8c'` |

> 웹 코드/자산을 수정하면 **반드시 `npm run sync`**로 네이티브에 반영해야 한다(네이티브는 `dist`를 앱에 번들함).

---

## 3. Android 릴리스 (완전 CLI)

### 3-1. 서명 키스토어 생성 (최초 1회 — 본인이 직접)

> ⚠️ 키스토어와 비밀번호는 **분실하면 앱 업데이트가 영구 불가**하다. 안전하게 백업할 것.

```sh
cd android
keytool -genkey -v -keystore release.keystore -alias nuri -keyalg RSA -keysize 2048 -validity 10000
```

`android/keystore.properties.example`를 복사해 `android/keystore.properties`(gitignore됨)로 만들고 값 채우기:

```properties
storeFile=release.keystore
storePassword=<키스토어 비밀번호>
keyAlias=nuri
keyPassword=<키 비밀번호>
```

### 3-2. AAB 빌드 & 업로드

```sh
npm run build:aab
# → android/app/build/outputs/bundle/release/app-release.aab (서명됨)
```

이 AAB를 **Google Play Console**에 업로드(웹). CLI 자동 업로드가 필요하면 `fastlane supply` 또는 Play Developer API 사용.

---

## 4. iOS 릴리스 (Xcode 아카이브 — Apple 계정 필요)

iOS는 서명·프로비저닝에 Apple Developer 계정이 필수라 완전 CLI가 어렵다. 순서:

```sh
npm run sync:ios
```

1. Xcode에서 `ios/App/App.xcworkspace` 열기 → Signing & Capabilities에서 팀 선택(자동 서명).
2. 아카이브: Product ▸ Archive (또는 CLI: `xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Release archive -archivePath build/App.xcarchive`).
3. Organizer ▸ Distribute App ▸ App Store Connect 로 업로드 (또는 `xcrun altool`/Transporter).

> 완전 CLI 자동화는 **fastlane**(`fastlane gym` + `fastlane pilot/deliver`)로 가능하나 인증서·프로파일 세팅이 선행돼야 한다.

---

## 5. 스토어 제출 전 남은 체크리스트

### 계정 (유료 — 본인이 발급)
- [ ] Apple Developer Program ($99/년)
- [ ] Google Play Console ($25 1회) — 개인 유형, 소유 계정 `csyull2287@gmail.com`, 개발자명 `s10cho`.
      결제 프로필·$25 결제 단계 진행 중. 개인 계정이라 프로덕션 출시 전 **테스터 12명 × 14일 연속 폐쇄 테스트** 필요.

### 필수 문서/설정 (아동 대상이라 엄격)
- [x] **개인정보처리방침** — `public/privacy.html` 작성 완료(한/영, 데이터 미수집).
      배포 후 URL: `https://s10cho.github.io/nuri-world/privacy.html`.
      문의 이메일은 개인 주소 `csyull2287@gmail.com`으로 통일(Play 개발자 계정과 동일).
- [x] **폰트 자체 호스팅** — Jua·Noto Serif KR을 앱이 쓰는 글자만 서브셋(각 ~160KB)해 `css/fonts/`에 자체 호스팅.
      외부(Google Fonts) 요청 제거 → "데이터 수집 없음" 선언 + 완전 오프라인.
      커리큘럼 글자가 늘면 재생성: 원본 폰트(google/fonts) + `pyftsubset --text-file=<쓰는 글자> --flavor=woff2`
      (Noto는 가변폰트라 `fonttools varLib.instancer ... wght=700` 후 서브셋). @font-face는 `css/style.css` 상단.
- [ ] Google Play: 타겟 연령·콘텐츠 설문 → **Designed for Families**, 데이터 안전 양식("데이터 미수집")
- [ ] Apple: App Privacy 라벨("데이터 미수집"), (선택) Kids 카테고리 — 제3자 분석/광고 금지

### 스토어 등록 자산
- [ ] 아이콘: ✅ 생성됨 (원본이 512→1024 업스케일이라 소프트함. 크리스프한 1024+ 마스터로 교체 권장 후 `capacitor-assets` 재실행)
- [ ] 스플래시: ✅ 생성됨
- [ ] 스크린샷: **가로 모드** — iPhone 6.7"/6.5", iPad 12.9", Android 폰/태블릿
- [ ] Google Play 피처 그래픽 1024×500
- [ ] 스토어 설명문(한국어), 연령 등급 설문(IARC)

---

## 6. 버전 올리기

`versionName` 은 `package.json` 의 `version` 을 읽는다 — 한 곳만 고치면 된다.
`versionCode`(정수, 업로드마다 +1)는 `android/app/build.gradle` 에서 직접 올린다.
iOS 는 Xcode 의 Build/Version 을 올린다.

## 6-1. 빌드가 막아 주는 것

`keystore.properties` 없이 `npm run build:aab` 를 돌리면 **빌드가 실패한다.** 예전에는
BUILD SUCCESSFUL 과 함께 43MB 짜리 *미서명* AAB 가 나왔고, Play 에 올리는 순간에야
거부당했다. 이제 시작 전에 무엇이 없는지 알려 준다(키스토어 파일 경로·빠진 항목까지).

> `storeFile` 경로는 `android/` 기준이다(`keystore.properties` 가 있는 위치).
> 예전에는 `android/app/` 기준으로 풀려서, DEPLOY.md 안내대로 `android/release.keystore` 를
> 만들면 서명 단계에서 "Keystore file not found" 로 실패했다 — 지금은 고쳐졌다.

## 6-2. 뒤로 가기

Capacitor 에는 뒤로 가기 처리가 없어 기본 동작이 '화면과 무관하게 앱 종료'다.
아이가 게임 도중 누르면 그대로 꺼지므로 다음과 같이 처리했다.

- `js/app.js` 가 화면을 옮길 때 히스토리에 한 칸을 쌓는다. 로딩·이야기·게임처럼
  '거쳐 가는' 화면은 쌓지 않는다(되돌아왔을 때 처음부터 다시 시작되면 안 되므로).
- `MainActivity` 가 웹뷰에 남은 칸을 먼저 소비하고, 없을 때에만 앱을 끝낸다.
  targetSdk 36 은 예측형 뒤로 가기가 기본이라 `onBackPressed()` 대신
  `OnBackPressedDispatcher` 에 콜백을 등록한다.

동작: 왕국 → 지도 → 타이틀 → (한 번 더) 종료. 이야기·게임에서는 직전 화면으로 빠져나온다.

## 6-3. INTERNET 권한

`AndroidManifest` 에 `android.permission.INTERNET` 이 선언돼 있다(Capacitor 기본값).
앱은 외부로 통신하지 않지만(코드·빌드 산출물에 외부 URL 0건), Capacitor 는 웹뷰를
`https://localhost` 로 띄우고 요청을 가로채는 구조라 이 권한을 전제로 한다.
**빼려면 실기기에서 확인이 필요하다** — 확인 없이 지우면 흰 화면이 될 수 있다.
데이터 안전 설문은 '수집' 여부를 묻는 것이라 이 권한이 답에 영향을 주지는 않는다.

---

## 7. TTS(음성) 구성

앱의 한국어 음성은 다음과 같이 **플랫폼별로 분기**한다 (`js/audio.js`):

- **네이티브(iOS/Android)**: `@capacitor-community/text-to-speech` 플러그인 사용.
  `window.Capacitor`로 네이티브를 감지해 **네이티브에서만** 플러그인을 lazy-load하며,
  Android는 OS의 `TextToSpeech` API를 직접 호출해 WebView `speechSynthesis`의 불안정성을 회피한다.
- **웹/PWA(GitHub Pages)**: 기존 `speechSynthesis` 경로 그대로(정교한 cancel 간격·keepalive·onend 폴백 유지).
- 한국어 음성 미지원 기기에서는 앱이 자동으로 **글자를 보여주는 시각 모드**로 전환(`hasKoreanTTS()`).

### 육성 녹음이 기본, TTS는 보조

앱이 말하는 **562개 대사 전부에 육성 녹음이 있다**(`assets/audio/ko/`, 매니페스트는 대사 텍스트로 조회).
`speak()`는 녹음을 먼저 재생하므로 **기기에 한국어 TTS가 없어도 앱은 온전히 동작한다.**
TTS 경로는 녹음이 없는 문구(개발 중 추가된 대사 등)를 위한 보조 수단으로만 남아 있다.

목표 글자를 화면에 보여 주는 '시각 대체'는 `canSpeak()`(녹음 or TTS)로 판단한다 —
소리를 낼 방법이 정말 하나도 없을 때만 켜진다. 전 대사 육성화 이전에는 TTS 유무만 봤는데,
한국어 TTS 데이터가 없는 안드로이드 기기에서 녹음이 멀쩡히 재생되는데도 듣기 문제의 정답이
노출되는 문제가 있었다.

> ⚠️ **실기기 검증 필요**: 실기기에서 육성이 실제로 재생되는지 확인할 것(특히 Android 오디오 포커스·볼륨).
