# 함정 모음

진단에 오래 걸렸고 다시 만날 법한 것들. 증상 → 원인 → 확인법 순으로 적는다.
절차 자체는 [DEPLOY.md](DEPLOY.md)에 있다.

---

## 소리

### 웹에서는 나는데 앱에서만 안 난다

무엇이 안 나는지부터 가른다. **효과음은 코드로 합성(WebAudio)하고, 음성은 파일을 재생**한다.

| 증상 | 의심할 곳 |
|---|---|
| 효과음도 음성도 안 남 | 오디오 컨텍스트 · 기기 미디어 볼륨 |
| 효과음은 나는데 음성만 안 남 | 파일 경로 · MIME · 매니페스트 |

**Android 에는 소리 재생 권한이 없다.** 오디오 관련 권한은 `RECORD_AUDIO`(마이크)뿐이고 이 앱은 쓰지 않는다.
권한을 의심하는 데 시간을 쓰지 말 것.

### 무음으로 켠 뒤 볼륨을 올려도 계속 무음 (v1.0.1에서 수정)

무음 상태로 앱을 켜면 웹뷰가 오디오를 내주지 않아 `AudioContext` 가 **suspended 로 남는다.**
정지된 컨텍스트는 **볼륨을 아무리 올려도 소리를 내지 않는다** — 껐다 켜야만 풀렸다.

잠금 해제를 첫 제스처 한 번만 시도하고 리스너를 떼어 내면(`{ once: true }`) 그 한 번이 실패한 세션은
끝까지 무음이 된다. 지금은 `audioUnlocked()` 가 참이 될 때까지 탭마다 다시 시도한다(`js/app.js`).

### 음성 파일만 재생되지 않는다면 (아직 겪지 않음, 1순위 의심)

Capacitor 의 내부 서버(`WebViewLocalServer.getMimeType`)는 MIME 을
`URLConnection.guessContentTypeFromName()` 으로 추측하고, 실패하면 바이트 스니핑으로 넘어간다.
그런데 **스니핑은 MP4/M4A 를 인식하지 못한다.** MIME 없이 내려간 음성을 웹뷰가 재생 거부하면
"웹은 되는데 앱만 무음"이 된다(웹 서버는 `audio/mp4` 를 제대로 붙여 준다).

확인: APK 안에 파일이 있는지부터 본다.

```bash
python3 - <<'PY'
import zipfile
z = zipfile.ZipFile('android/app/build/outputs/apk/release/app-release.apk')
print(len([n for n in z.namelist() if '/audio/' in n]), '개')
PY
```

파일이 멀쩡한데도 안 나면 `new Audio(src)` 대신 fetch → WebAudio `decodeAudioData` 로 우회하면
MIME 을 타지 않는다.

### 백그라운드로 나가도 소리가 계속 난다 (v1.0.1에서 수정)

화면이 돌아올 때 재개하는 코드만 있고 숨겨질 때 멈추는 처리가 없었다.
`visibilitychange` 로 끊되, **일부 안드로이드 웹뷰는 화면을 끌 때 `pagehide` 만 준다** — 둘 다 듣는다.

---

## 레이아웃

### 버튼이 화면 밖으로 밀려 못 누른다

`html, body { overflow: hidden }` 이라 넘치는 내용은 **스크롤되지 않고 잘린다.**
스크롤되는 조상(`overflow-y: auto`)이 없는 요소가 뷰포트를 벗어나면 영영 못 누른다.

회귀 검사:

```bash
npm run audit:layout      # 화면 9개 × 해상도 6종
```

### 미디어쿼리 사이 사각지대

압축은 `max-height`, 확대는 `min-height` 조건이라 **두 구간 사이 높이가 확대 쪽을 받아 넘칠 수 있다.**
실제로 1024×600 에서 '다음 글자' 버튼이 68px 화면 밖으로 밀렸다(압축 560 / 확대 600 이던 시절).
지금은 압축 640 / 확대 700 이라 사이가 비지 않는다. **경계를 바꿀 때는 반드시 검사를 다시 돌릴 것.**

### 짧은 화면에서 `vh` 는 생각보다 작다

`1vh` 는 360px 가로 화면에서 **3.6px** 다. 여백에 `vh` 만 쓰면 작은 기기에서 사라진다.
`max(2.6vh, 14px)` 처럼 하한을 둔다.

---

## Play Console 조작

브라우저 자동화로 다룰 때 걸린 것들.

- **"다음" 이 "저장" 후에야 활성화되는 화면이 있다**(IARC 설문 2단계). 답을 다 채웠는데 비활성이면 저장부터.
- **스크립트 `.click()` 은 모델에 반영되지 않는다.** 화면만 선택된 것처럼 보이고 값은 안 들어간다. 실제 마우스 클릭이 필요하다.
- **애셋 라이브러리의 선택 버튼은 썸네일에 hover 해야 렌더된다.** hover 없이 좌표를 누르면 아무 일도 일어나지 않는다. 새로 업로드하면 자동 선택되므로 그 편이 빠르다.
- **검토 중에 변경사항을 다시 제출하면 검토가 취소되고 재시작된다.** 사전 검사 단계(수 분)면 손해가 적지만, 진행된 뒤라면 기다렸다 제출한다.
- **선언에 순서 의존이 있다**: 콘텐츠 등급 → 타겟층(만 13세 미만은 등급이 있어야 열림) → 데이터 보안 최종 저장.
- **계정 인덱스(`/u/0`, `/u/1`)는 브라우저 프로필마다 다르다.** URL 을 복사해 다른 브라우저에 붙이면 엉뚱한 계정이나 약관 화면이 뜬다.

---

## 배포

### Firebase 로 받은 앱과 Play 로 받은 앱의 서명이 다르다

Firebase 에 올리는 APK 는 **업로드 키**로 서명된다. Play 는 앱 서명(Play App Signing)으로 다시 서명해
배포하므로 서명이 다르고, 테스터가 Play 버전으로 갈아탈 때는 **먼저 삭제**해야 설치된다.

### `version-code.txt` 를 커밋하지 않으면 번호가 되돌아간다

`npm run release:firebase` 가 배포 전에 이 파일을 +1 한다. 커밋하지 않고 두면 다음 배포가 같은 번호를
다시 쓰고, 어떤 빌드였는지 추적이 끊긴다. 배포 후 커밋에 포함할 것.

### Aside 브라우저로는 큰 파일을 첨부할 수 없다

`setInputFiles` 가 `Path escapes Project and session roots` 로 거부한다. Aside 는 자기 세션/프로젝트
루트 안의 파일만 첨부할 수 있다. Play 업로드는 `fastlane supply` 를 쓴다(DEPLOY.md 3-2).

## iOS 에서 앱이 켜지자마자 "앗, 잠깐 문제가 생겼어요!" 화면

**증상** — 시뮬레이터/기기에서 실행하면 로딩 화면 대신 곧바로 에러 화면. 콘솔에는
`[nuri] unhandledrejection: {"code":"UNIMPLEMENTED"}` 가 두 번 찍힌다.

**원인** — Capacitor 플러그인 객체는 **프록시**다. 모든 속성 접근을 네이티브 메서드 호출로
바꾼다(`@capacitor/core` 8.4.1 의 `registerPlugin` 프록시에는 `then` 예외 처리가 없다).
그래서 이 객체를 `async` 함수에서 그대로 반환하면 — 즉 Promise 에 담아 넘기면 — JS 가
thenable 인지 확인하려고 `.then` 을 읽고, 프록시가 그것마저 네이티브 호출로 만들어
`"TextToSpeech.then()" is not implemented on ios` 로 거절한다.

이 거절은 **아무도 받지 못한다.** 바깥 Promise 는 영영 미결로 남고(그래서 체인 끝의
`.catch()` 도 안 걸린다) 거절만 `unhandledrejection` 으로 새어 나가, 부팅 중이면
에러 경계(`maybeFatal`)가 에러 화면을 띄운다.

**고친 방법** — 프록시를 객체에 담아 넘긴다(`js/audio.js`):

```js
// 나쁨: async 함수가 프록시를 그대로 반환 → JS 가 .then 을 읽는다
async function ensureNativeTTS() { return mod.TextToSpeech; }

// 좋음: 객체로 감싸면 프록시가 Promise 해소 경로에 노출되지 않는다
async function ensureNativeTTS() { return { tts: mod.TextToSpeech }; }
```

**주의** — 플랫폼 무관한 버그다. 안드로이드는 로딩 화면이 먼저 그려져
(`maybeFatal` 이 `.screen` 유무를 보므로) 우연히 가려졌을 뿐, 타이밍이 바뀌면 똑같이 터진다.

**재발 방지** — `npm run build:ios:sim` 이 웹뷰 콘솔을 지켜보다 오류가 찍히면 실패로 끝낸다.
네이티브 브리지 문제는 웹에서도 안드로이드에서도 안 잡히므로 이 검사가 유일한 그물이다.

## iOS 첫 TestFlight 업로드 — 서명이 네 번 막힌다

새로 만든 Apple 계정 + CLI 전용(맥에 Xcode GUI 로그인 없음) 조합에서 순서대로 터진다.
넷 다 `fastlane/Fastfile` 에 대응이 들어가 있으므로 지금은 그냥 `npm run release:ios` 로 된다.
아래는 왜 그렇게 짰는지에 대한 기록이다.

### 1. `Unable to locate Xcode`
`xcode-select` 가 CommandLineTools 를 가리키면 `xcodebuild` 가 없다고 나온다.
Fastfile 이 `DEVELOPER_DIR` 을 채워 우회한다. 영구 수정은 `sudo xcode-select -s /Applications/Xcode.app`.

### 2. `Your team has no devices from which to generate a provisioning profile`
자동 서명(`CODE_SIGN_STYLE = Automatic`)은 아카이브를 **개발용**으로 서명하려 든다.
그런데 개발용 프로파일은 팀에 등록된 기기가 최소 하나 있어야 Apple 이 발급한다 —
갓 만든 계정에는 기기가 없다.

Capacitor 템플릿이 프로젝트에 `CODE_SIGN_IDENTITY = "iPhone Developer"` (폐기된 옛 표기)를
박아 두는 것도 여기에 한몫한다. 현행 이름인 `"Apple Development"` 로 고쳤다.

### 3. `App has conflicting provisioning settings`
2번을 피하려고 `CODE_SIGN_IDENTITY="Apple Distribution"` 로 덮으면 이번엔 이게 나온다.
**자동 서명 상태에서는 서명 ID 를 수동 지정할 수 없다.** 즉 자동 서명으로는 이 계정에서
빠져나갈 길이 없다.

→ **수동 서명으로 간다.** App Store 배포용 프로파일은 기기 등록이 필요 없다.
`get_certificates(development: false)` 로 배포용 인증서를, `get_provisioning_profile` 로
App Store 프로파일을 만들어 `CODE_SIGN_STYLE=Manual` 로 아카이브한다.

> `get_provisioning_profile` 에 `app_store:` 옵션은 **없다.**
> `adhoc` / `development` / `developer_id` 중 아무것도 주지 않으면 App Store 가 기본값이다.
> 프로파일 이름도 `lane_context` 가 아니라 환경변수
> `sigh_<번들ID>_appstore_profile-name` 로 넘어온다.

### 4. codesign 이 GUI 승인 팝업에서 멈춘다 (가장 고약함)
인증서 개인키를 로그인 키체인에 넣으면 codesign 이 그 키를 쓸 때 macOS 가 승인 팝업을
띄운다. 자동 빌드는 거기서 **영영 멈춘다** — 로그에 아무 오류도 안 남아서 "그냥 느린 것"과
구분되지 않는다. fastlane 은 이때 이렇게만 경고한다:

```
Could not configure imported keychain item (certificate) to prevent UI permission popup
```

확인법(추측하지 말 것) — 더미 파일을 서명해 보고 시간 안에 안 끝나면 팝업이다:

```sh
codesign --force -s "<식별자>" /tmp/cstest &   # 12초 넘게 안 끝나면 팝업
```

팝업을 없애려면 키체인 비밀번호로 partition list 를 설정해야 하는데, 로그인 키체인이면
**사용자의 로그인 비밀번호**가 필요하다. 그래서 빌드 때마다 **전용 임시 키체인**을 만들어
(비밀번호는 `SecureRandom` 으로 생성) 거기에 인증서를 넣고, 끝나면 지운다.
사용자 비밀번호를 만질 일이 없다.
