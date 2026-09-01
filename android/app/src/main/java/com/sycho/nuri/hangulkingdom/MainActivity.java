package com.sycho.nuri.hangulkingdom;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

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
}
