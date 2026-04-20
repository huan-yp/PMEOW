package com.pmeowmobile

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.net.Uri
import androidx.core.content.ContextCompat
import androidx.core.content.ContextCompat.startForegroundService
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener

class PmeowNotificationsModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val REQUEST_CODE_POST_NOTIFICATIONS = 9105
  }

  override fun getName(): String = "PmeowNotifications"

  @ReactMethod
  fun requestPermission(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      promise.resolve(true)
      return
    }

    val granted = ContextCompat.checkSelfPermission(
      reactApplicationContext,
      Manifest.permission.POST_NOTIFICATIONS,
    ) == PackageManager.PERMISSION_GRANTED
    if (granted) {
      promise.resolve(true)
      return
    }

    val activity = currentActivity as? PermissionAwareActivity
    if (activity == null) {
      promise.resolve(false)
      return
    }

    activity.requestPermissions(
      arrayOf(Manifest.permission.POST_NOTIFICATIONS),
      REQUEST_CODE_POST_NOTIFICATIONS,
      object : PermissionListener {
        override fun onRequestPermissionsResult(
          requestCode: Int,
          permissions: Array<String>,
          grantResults: IntArray,
        ): Boolean {
          if (requestCode != REQUEST_CODE_POST_NOTIFICATIONS) {
            return false
          }

          val permissionGranted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
          promise.resolve(permissionGranted)
          return true
        }
      },
    )
  }

  @ReactMethod
  fun createDefaultChannel(promise: Promise) {
    PmeowNotificationHelper.ensureChannels(reactApplicationContext)
    promise.resolve(null)
  }

  @ReactMethod
  fun showNotification(title: String, body: String, data: ReadableMap?, promise: Promise) {
    if (!notificationsAllowed()) {
      promise.resolve(false)
      return
    }

    PmeowNotificationHelper.showEventNotification(
      reactApplicationContext,
      title,
      body,
      if (data != null && data.hasKey("serverId")) data.getString("serverId") else null,
    )
    promise.resolve(true)
  }

  @ReactMethod
  fun startGuardService(
    baseUrl: String,
    token: String,
    principalKind: String,
    adminAlertsEnabled: Boolean,
    adminSecurityEnabled: Boolean,
    taskEventsEnabled: Boolean,
    promise: Promise,
  ) {
    if (!notificationsAllowed()) {
      promise.resolve(false)
      return
    }

    val config = PmeowGuardServiceConfig(
      baseUrl = baseUrl,
      token = token,
      principalKind = principalKind,
      adminAlertsEnabled = adminAlertsEnabled,
      adminSecurityEnabled = adminSecurityEnabled,
      taskEventsEnabled = taskEventsEnabled,
    )

    if (!config.isValid()) {
      promise.resolve(false)
      return
    }

    PmeowNotificationHelper.ensureChannels(reactApplicationContext)
    PmeowGuardConfigStore.saveConfig(reactApplicationContext, config)
    startForegroundService(
      reactApplicationContext,
      PmeowGuardService.createStartIntent(reactApplicationContext, config),
    )
    promise.resolve(true)
  }

  @ReactMethod
  fun stopGuardService(promise: Promise) {
    PmeowGuardConfigStore.clearConfig(reactApplicationContext)
    reactApplicationContext.startService(PmeowGuardService.createStopIntent(reactApplicationContext))
    promise.resolve(null)
  }

  @ReactMethod
  fun isGuardServiceRunning(promise: Promise) {
    val manager = reactApplicationContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val running = manager.getRunningServices(Int.MAX_VALUE).any { serviceInfo ->
      serviceInfo.service.className == PmeowGuardService::class.java.name
    }
    promise.resolve(running)
  }

  @ReactMethod
  fun setAppInForeground(inForeground: Boolean, promise: Promise) {
    PmeowGuardConfigStore.setAppInForeground(reactApplicationContext, inForeground)
    promise.resolve(null)
  }

  @ReactMethod
  fun isIgnoringBatteryOptimizations(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      promise.resolve(true)
      return
    }

    val manager = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
    promise.resolve(manager.isIgnoringBatteryOptimizations(reactApplicationContext.packageName))
  }

  @ReactMethod
  fun openBatteryOptimizationSettings(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      promise.resolve(false)
      return
    }

    val intent = Intent(
      Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
      Uri.parse("package:${reactApplicationContext.packageName}"),
    ).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    reactApplicationContext.startActivity(intent)
    promise.resolve(true)
  }

  private fun notificationsAllowed(): Boolean {
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || ContextCompat.checkSelfPermission(
      reactApplicationContext,
      Manifest.permission.POST_NOTIFICATIONS,
    ) == PackageManager.PERMISSION_GRANTED
  }
}