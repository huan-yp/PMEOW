package com.pmeowmobile

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
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
    private const val CHANNEL_ID = "pmeow-mobile-events"
    private const val CHANNEL_NAME = "PMEOW 通知"
    private const val CHANNEL_DESCRIPTION = "PMEOW 移动端值班通知"
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
          permissions: Array<out String>,
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
    ensureNotificationChannel()
    promise.resolve(null)
  }

  @ReactMethod
  fun showNotification(title: String, body: String, data: ReadableMap?, promise: Promise) {
    if (!notificationsAllowed()) {
      promise.resolve(false)
      return
    }

    ensureNotificationChannel()

    val builder = NotificationCompat.Builder(reactApplicationContext, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setAutoCancel(true)

    if (data != null && data.hasKey("serverId") && data.getString("serverId") != null) {
      builder.setSubText(data.getString("serverId"))
    }

    NotificationManagerCompat.from(reactApplicationContext).notify(nextNotificationId(), builder.build())
    promise.resolve(true)
  }

  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }

    val manager = reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val existingChannel = manager.getNotificationChannel(CHANNEL_ID)
    if (existingChannel != null) {
      return
    }

    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_ID,
        CHANNEL_NAME,
        NotificationManager.IMPORTANCE_DEFAULT,
      ).apply {
        description = CHANNEL_DESCRIPTION
      },
    )
  }

  private fun notificationsAllowed(): Boolean {
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || ContextCompat.checkSelfPermission(
      reactApplicationContext,
      Manifest.permission.POST_NOTIFICATIONS,
    ) == PackageManager.PERMISSION_GRANTED
  }

  private fun nextNotificationId(): Int {
    return (System.currentTimeMillis() % Int.MAX_VALUE).toInt()
  }
}