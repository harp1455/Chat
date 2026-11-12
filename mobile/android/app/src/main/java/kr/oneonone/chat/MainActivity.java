package kr.oneonone.chat;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeSettingsPlugin.class);
        super.onCreate(savedInstanceState);
        createChatChannel();
        rememberRoom(getIntent());
        if (getBridge() != null && getBridge().getWebView() != null) {
            // 캐릭터 목소리를 누르지 않아도 재생할 수 있게
            getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
            // 휴대폰 글자 크기 설정 때문에 버튼 글자가 넘쳐 화면이 깨지지 않게 고정한다 (대화 글자 크기는 앱 설정에서 고름)
            getBridge().getWebView().getSettings().setTextZoom(100);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        rememberRoom(intent);
    }

    private void rememberRoom(Intent intent) {
        if (intent == null) return;
        String a = intent.getStringExtra("actionTypeId");
        if (a != null && a.startsWith("room:")) NativeSettingsPlugin.openRoom = a.substring(5);
    }

    // 선톡 알림 채널: 메신저처럼 화면 위에 잠깐 떠서 보이도록 중요도를 높게 둔다
    private void createChatChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel("chat_msg") != null) return;
        NotificationChannel ch = new NotificationChannel("chat_msg", "캐릭터 메시지", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("캐릭터가 먼저 보내는 메시지(선톡)");
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[] { 0, 180, 120, 180 });
        ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
            new AudioAttributes.Builder().setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
        nm.createNotificationChannel(ch);
    }
}
