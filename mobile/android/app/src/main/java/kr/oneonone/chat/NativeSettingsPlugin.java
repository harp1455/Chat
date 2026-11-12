package kr.oneonone.chat;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
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
