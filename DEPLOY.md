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
- [ ] Google Play Console ($25 1회)

### 필수 문서/설정 (아동 대상이라 엄격)
- [ ] **개인정보처리방침 URL** (양 스토어 필수) — GitHub Pages에 `privacy.html` 호스팅
- [ ] Google Play: 타겟 연령·콘텐츠 설문 → **Designed for Families**, 데이터 안전 양식
- [ ] Apple: App Privacy 라벨, (선택) Kids 카테고리 — 제3자 분석/광고 금지
- [ ] **폰트 자체 호스팅 검토** — 현재 Google Fonts 런타임 로드가 유일한 외부 요청.
      자체 호스팅 시 "데이터 수집 없음"을 깔끔히 선언 + 완전 오프라인

### 스토어 등록 자산
- [ ] 아이콘: ✅ 생성됨 (원본이 512→1024 업스케일이라 소프트함. 크리스프한 1024+ 마스터로 교체 권장 후 `capacitor-assets` 재실행)
- [ ] 스플래시: ✅ 생성됨
- [ ] 스크린샷: **가로 모드** — iPhone 6.7"/6.5", iPad 12.9", Android 폰/태블릿
- [ ] Google Play 피처 그래픽 1024×500
- [ ] 스토어 설명문(한국어), 연령 등급 설문(IARC)

---

## 6. 버전 올리기

새 릴리스마다 `android/app/build.gradle`의 `versionCode`(정수, 매번 +1)·`versionName`,
그리고 iOS는 Xcode의 Build/Version을 올린다.

---

## 7. TTS(음성) 구성

앱의 한국어 음성은 다음과 같이 **플랫폼별로 분기**한다 (`js/audio.js`):

- **네이티브(iOS/Android)**: `@capacitor-community/text-to-speech` 플러그인 사용.
  `window.Capacitor`로 네이티브를 감지해 **네이티브에서만** 플러그인을 lazy-load하며,
  Android는 OS의 `TextToSpeech` API를 직접 호출해 WebView `speechSynthesis`의 불안정성을 회피한다.
- **웹/PWA(GitHub Pages)**: 기존 `speechSynthesis` 경로 그대로(정교한 cancel 간격·keepalive·onend 폴백 유지).
- 한국어 음성 미지원 기기에서는 앱이 자동으로 **글자를 보여주는 시각 모드**로 전환(`hasKoreanTTS()`).

> ⚠️ **실기기 검증 필요**: 네이티브 TTS는 에뮬레이터/실기기에서 실제 음성 재생을 확인해야 한다.
> 특히 Android는 기기에 한국어 TTS 데이터가 설치돼 있어야 소리가 난다(없으면 시각 모드로 폴백).
> iOS는 기본 한국어 음성(Yuna) 내장이라 잘 동작.
