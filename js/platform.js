// 실행 환경 구분. window.Capacitor 는 네이티브 런타임에서만 주입되므로
// 정적 import 없이 감지한다(웹 번들에 네이티브 코드가 딸려오지 않게).
//
// 웹(GitHub Pages·PWA)과 네이티브 앱은 같은 코드에서 돌지만 맞는 안내와 기능이 다르다.
// 예: 전체화면 토글은 브라우저에서만 뜻이 있고, 앱은 이미 몰입형 전체화면이다.

export const NATIVE = typeof window !== 'undefined'
  && /** @type {any} */ (window).Capacitor?.isNativePlatform?.() === true;
