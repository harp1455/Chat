package kr.oneonone.chat;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 캐릭터 목소리를 누르지 않아도 재생할 수 있게
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
            // 휴대폰 글자 크기 설정 때문에 버튼 글자가 넘쳐 화면이 깨지지 않게 고정한다 (대화 글자 크기는 앱 설정에서 고름)
            getBridge().getWebView().getSettings().setTextZoom(100);
        }
    }
}
