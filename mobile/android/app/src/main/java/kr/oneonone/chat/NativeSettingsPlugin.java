package kr.oneonone.chat;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

// 알림 허용 요청과 배터리 최적화 예외 요청: 앱이 꺼져 있어도 선톡 알림이 오게 하는 데 필요하다
@CapacitorPlugin(name = "NativeSettings", permissions = {
    @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
})
public class NativeSettingsPlugin extends Plugin {
    // 알림을 눌러 앱이 열렸을 때 열어야 할 방 (MainActivity가 채워 두고 웹 화면이 가져간다)
    static volatile String openRoom = null;

    /* ───── 구글 로그인: 휴대폰 기본 브라우저에서 로그인하고, 결과는 이 휴대폰 안(127.0.0.1)의 임시 주소로 받는다 ─────
       구글은 앱 안 화면(WebView)에서의 로그인을 막기 때문에 바깥 브라우저를 써야 한다. */
    private ServerSocket loop;

    @PluginMethod
    public void startLoopback(PluginCall call) {
        try {
            if (loop != null) try { loop.close(); } catch (Exception ignored) { }
            loop = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"));
            loop.setSoTimeout(5 * 60 * 1000);
            JSObject r = new JSObject();
            r.put("port", loop.getLocalPort());
            call.resolve(r);
        } catch (Exception e) { call.reject("로그인 준비에 실패했습니다: " + e.getMessage()); }
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(call.getString("url", "")));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) { call.reject("브라우저를 열지 못했습니다: " + e.getMessage()); }
    }

    @PluginMethod
    public void waitLoopback(PluginCall call) {
        final ServerSocket ss = loop;
        if (ss == null) { call.reject("로그인 준비가 되어 있지 않습니다."); return; }
        call.setKeepAlive(true);
        new Thread(() -> {
            try (Socket s = ss.accept()) {
                BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
                String first = in.readLine();
                String path = first != null && first.split(" ").length > 1 ? first.split(" ")[1] : "/";
                JSObject r = new JSObject();
                int q = path.indexOf('?');
                if (q >= 0) for (String kv : path.substring(q + 1).split("&")) {
                    int eq = kv.indexOf('=');
                    if (eq > 0) r.put(URLDecoder.decode(kv.substring(0, eq), "UTF-8"), URLDecoder.decode(kv.substring(eq + 1), "UTF-8"));
                }
                boolean ok = r.has("code");
                String html = "<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><body style=\"font-family:sans-serif;padding:32px;background:#14171f;color:#eee\"><h2>"
                    + (ok ? "로그인했습니다." : "로그인하지 못했습니다.") + "</h2><p>이 창을 닫고 1대1채팅 앱으로 돌아가세요.</p></body>";
                byte[] body = html.getBytes(StandardCharsets.UTF_8);
                OutputStream out = s.getOutputStream();
                out.write(("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: " + body.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                out.write(body); out.flush();
                // 로그인이 끝나면 앱을 다시 앞으로 가져온다
                Intent back = getContext().getPackageManager().getLaunchIntentForPackage(getContext().getPackageName());
                if (back != null) { back.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_NEW_TASK); getContext().startActivity(back); }
                call.resolve(r);
            } catch (Exception e) { call.reject("5분 안에 로그인이 끝나지 않았거나 결과를 받지 못했습니다."); }
            finally { try { ss.close(); } catch (Exception ignored) { } if (loop == ss) loop = null; call.setKeepAlive(false); }
        }).start();
    }

    @PluginMethod
    public void takeOpenRoom(PluginCall call) {
        JSObject r = new JSObject();
        r.put("roomId", openRoom);
        openRoom = null;
        call.resolve(r);
    }

    private JSObject state() {
        Context ctx = getContext();
        JSObject r = new JSObject();
        r.put("notifications", NotificationManagerCompat.from(ctx).areNotificationsEnabled());
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        r.put("battery", pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName()));
        return r;
    }

    @PluginMethod
    public void status(PluginCall call) { call.resolve(state()); }

    @PluginMethod
    public void askNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) { call.resolve(state()); return; }
        requestPermissionForAlias("notifications", call, "afterAsk");
    }

    @PermissionCallback
    private void afterAsk(PluginCall call) { call.resolve(state()); }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Context ctx = getContext();
        Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        i.putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { ctx.startActivity(i); } catch (Exception e) {
            Intent d = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.getPackageName()));
            d.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(d);
        }
        call.resolve();
    }

    @PluginMethod
    public void askBattery(PluginCall call) {
        Context ctx = getContext();
        Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + ctx.getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { ctx.startActivity(i); } catch (Exception e) {
            Intent d = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            d.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { ctx.startActivity(d); } catch (Exception ignored) { }
        }
        call.resolve();
    }
}
