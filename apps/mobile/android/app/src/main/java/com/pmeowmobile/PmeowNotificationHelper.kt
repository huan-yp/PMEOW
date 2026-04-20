package com.pmeowmobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

object PmeowNotificationHelper {
  const val EVENT_CHANNEL_ID = "pmeow-mobile-events"
  private const val EVENT_CHANNEL_NAME = "PMEOW 事件通知"
  private const val EVENT_CHANNEL_DESCRIPTION = "PMEOW 移动端任务、告警与安全事件通知"

  const val GUARD_CHANNEL_ID = "pmeow-mobile-guard"
  private const val GUARD_CHANNEL_NAME = "PMEOW 后台值守"
  private const val GUARD_CHANNEL_DESCRIPTION = "PMEOW 移动端后台实时连接保活通知"

  const val GUARD_NOTIFICATION_ID = 4101

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }

    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    if (manager.getNotificationChannel(EVENT_CHANNEL_ID) == null) {
      manager.createNotificationChannel(
        NotificationChannel(
          EVENT_CHANNEL_ID,
          EVENT_CHANNEL_NAME,
          NotificationManager.IMPORTANCE_HIGH,
        ).apply {
          description = EVENT_CHANNEL_DESCRIPTION
          enableVibration(true)
          lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        },
      )
    }

    if (manager.getNotificationChannel(GUARD_CHANNEL_ID) == null) {
      manager.createNotificationChannel(
        NotificationChannel(
          GUARD_CHANNEL_ID,
          GUARD_CHANNEL_NAME,
          NotificationManager.IMPORTANCE_LOW,
        ).apply {
          description = GUARD_CHANNEL_DESCRIPTION
          setShowBadge(false)
        },
      )
    }
  }

  fun buildEventNotification(
    context: Context,
    title: String,
    body: String,
    subText: String? = null,
  ): Notification {
    val builder = NotificationCompat.Builder(context, EVENT_CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setContentIntent(createLaunchPendingIntent(context))
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setDefaults(NotificationCompat.DEFAULT_ALL)
      .setVibrate(longArrayOf(0, 220, 180, 220))
      .setAutoCancel(true)

    if (!subText.isNullOrBlank()) {
      builder.setSubText(subText)
    }

    return builder.build()
  }

  fun showEventNotification(
    context: Context,
    title: String,
    body: String,
    subText: String? = null,
  ) {
    ensureChannels(context)
    NotificationManagerCompat.from(context).notify(nextNotificationId(), buildEventNotification(context, title, body, subText))
  }

  fun buildGuardNotification(context: Context, contentText: String): Notification {
    return NotificationCompat.Builder(context, GUARD_CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("PMEOW 正在值守")
      .setContentText(contentText)
      .setContentIntent(createLaunchPendingIntent(context))
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .build()
  }

  fun updateGuardNotification(context: Context, contentText: String) {
    ensureChannels(context)
    NotificationManagerCompat.from(context).notify(GUARD_NOTIFICATION_ID, buildGuardNotification(context, contentText))
  }

  private fun createLaunchPendingIntent(context: Context): PendingIntent {
    val intent = Intent(context, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }

    val flags = PendingIntent.FLAG_UPDATE_CURRENT or if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      PendingIntent.FLAG_IMMUTABLE
    } else {
      0
    }

    return PendingIntent.getActivity(context, 1101, intent, flags)
  }

  private fun nextNotificationId(): Int {
    return (System.currentTimeMillis() % Int.MAX_VALUE).toInt()
  }
}