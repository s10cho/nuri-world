/// <reference types="@capacitor/cli" />
import type { CapacitorConfig } from '@capacitor/cli';

// 앱 스토어 아이덴티티.
// - appId(iOS 번들 ID · Android 패키지명)는 "첫 스토어 제출 후에는 변경 불가".
//   com.sycho.nuri.* 를 "누리" 시리즈 네임스페이스로 두어 앞으로 다른 앱을
//   com.sycho.nuri.<앱>으로 확장. 이 앱은 hangulkingdom.
// - webDir 는 Vite 네이티브 빌드 산출물(dist). `CAP=1 vite build`가 base:'/' 로 만든다.
const config: CapacitorConfig = {
  appId: 'com.sycho.nuri.hangulkingdom',
  appName: '누리의 한글 왕국',
  webDir: 'dist',
  backgroundColor: '#59b8f2ff',
  ios: {
    // 몰입형 전체화면 게임 — 웹뷰를 세이프에어리어까지 확장하고 CSS env(safe-area-inset-*)로 여백 처리
    contentInset: 'never',
  },
};

export default config;
