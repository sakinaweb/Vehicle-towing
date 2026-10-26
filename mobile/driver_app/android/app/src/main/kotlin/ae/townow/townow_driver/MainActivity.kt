package ae.townow.townow_driver

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "ae.townow.driver/notifications")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    // Android 13+: ask for notification permission so the location-sharing notification shows.
                    "request" -> {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                        ) {
                            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7301)
                        }
                        result.success(null)
                    }
                    // Battery optimisation lets the system (and OEM skins like MIUI) stop the app in the
                    // background, which stops GPS. Shows the system "allow in background" prompt once
                    // per go-online while the app is still optimised; true when the prompt was shown.
                    "battery" -> {
                        val power = getSystemService(PowerManager::class.java)
                        if (power.isIgnoringBatteryOptimizations(packageName)) {
                            result.success(false)
                        } else {
                            result.success(openBatterySettings())
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }

    /** MIUI swallows the standard prompt (opens a resolver), so Xiaomi goes to its own battery-saver page. */
    private fun openBatterySettings(): Boolean {
        val pkg = Uri.parse("package:$packageName")
        val candidates = mutableListOf<Intent>()
        if (Build.MANUFACTURER.equals("Xiaomi", ignoreCase = true)) {
            candidates += Intent()
                .setClassName("com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsConfigActivity")
                .putExtra("package_name", packageName)
                .putExtra("package_label", applicationInfo.loadLabel(packageManager).toString())
            candidates += Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(pkg)
        } else {
            candidates += Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).setData(pkg)
        }
        for (intent in candidates) {
            try {
                startActivity(intent)
                return true
            } catch (e: Exception) {
                // not available on this phone: try the next
            }
        }
        return false
    }
}
