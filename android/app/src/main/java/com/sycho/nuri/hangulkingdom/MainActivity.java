package com.sycho.nuri.hangulkingdom;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 몰입형 전체화면. 기본 상태로 두면 가로 화면 위쪽에 시계·알림·안테나·배터리가 그대로
        // 남아 그림책 같은 화면이 잘리고, 아이가 상단을 만지다 알림 창을 내려 게임을 벗어난다.
        // BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE 라 어른이 필요하면 가장자리를 쓸어 잠깐 꺼낼 수 있다.
        enterImmersiveMode();

        // Capacitor 에는 뒤로 가기 처리가 없다. 기본 동작은 화면과 무관하게 액티비티 종료라,
        // 아이가 게임 도중 뒤로 가기를 누르면 앱이 그대로 꺼진다.
        //
        // 웹 쪽(js/app.js)이 화면을 옮길 때마다 히스토리에 한 칸을 쌓아 둔다. 남은 칸이 있으면
        // 그것부터 소비해 화면을 되돌리고, 최상위(타이틀)에서만 앱을 끝낸다.
        //
        // targetSdk 36 부터는 예측형 뒤로 가기가 기본이라 onBackPressed() 가 불리지 않는다.
        // 그래서 디스패처에 콜백을 등록한다.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                    return;
                }
                // 되돌아갈 화면이 없다 — 기본 동작(앱 종료)에 넘긴다.
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
            }
        });
    }

    // 시스템 바를 다시 꺼낸 뒤(스와이프·다이얼로그·앱 전환) 포커스를 되찾으면 몰입 모드가 풀린다.
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersiveMode();
    }

    private void enterImmersiveMode() {
        // 웹뷰가 시스템 바 자리까지 차지하게 두고(레이아웃이 바 표시 여부에 따라 튀지 않는다),
        // 상태바·내비게이션 바를 숨긴다.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }
}
