package com.pmeowmobile

import android.content.Context

data class PmeowForegroundState(
  val inForeground: Boolean,
  val updatedAt: Long,
  val isFresh: Boolean,
)

data class PmeowGuardServiceConfig(
  val baseUrl: String,
  val token: String,
  val principalKind: String,
  val adminAlertsEnabled: Boolean,
  val adminSecurityEnabled: Boolean,
  val taskEventsEnabled: Boolean,
) {
  fun isValid(): Boolean {
    return baseUrl.isNotBlank()
      && token.isNotBlank()
      && (principalKind == "admin" || principalKind == "person")
  }
}

object PmeowGuardConfigStore {
  private const val PREFS_NAME = "pmeow.mobile.guard"
  private const val KEY_BASE_URL = "base_url"
  private const val KEY_TOKEN = "token"
  private const val KEY_PRINCIPAL_KIND = "principal_kind"
  private const val KEY_ADMIN_ALERTS_ENABLED = "admin_alerts_enabled"
  private const val KEY_ADMIN_SECURITY_ENABLED = "admin_security_enabled"
  private const val KEY_TASK_EVENTS_ENABLED = "task_events_enabled"
  private const val KEY_APP_IN_FOREGROUND = "app_in_foreground"
  private const val KEY_APP_STATE_UPDATED_AT = "app_state_updated_at"
  private const val FOREGROUND_STATE_MAX_AGE_MS = 15_000L

  fun saveConfig(context: Context, config: PmeowGuardServiceConfig) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_BASE_URL, config.baseUrl)
      .putString(KEY_TOKEN, config.token)
      .putString(KEY_PRINCIPAL_KIND, config.principalKind)
      .putBoolean(KEY_ADMIN_ALERTS_ENABLED, config.adminAlertsEnabled)
      .putBoolean(KEY_ADMIN_SECURITY_ENABLED, config.adminSecurityEnabled)
      .putBoolean(KEY_TASK_EVENTS_ENABLED, config.taskEventsEnabled)
      .apply()
  }

  fun loadConfig(context: Context): PmeowGuardServiceConfig? {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val config = PmeowGuardServiceConfig(
      baseUrl = prefs.getString(KEY_BASE_URL, "") ?: "",
      token = prefs.getString(KEY_TOKEN, "") ?: "",
      principalKind = prefs.getString(KEY_PRINCIPAL_KIND, "") ?: "",
      adminAlertsEnabled = prefs.getBoolean(KEY_ADMIN_ALERTS_ENABLED, true),
      adminSecurityEnabled = prefs.getBoolean(KEY_ADMIN_SECURITY_ENABLED, true),
      taskEventsEnabled = prefs.getBoolean(KEY_TASK_EVENTS_ENABLED, true),
    )

    return config.takeIf { it.isValid() }
  }

  fun clearConfig(context: Context) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .remove(KEY_BASE_URL)
      .remove(KEY_TOKEN)
      .remove(KEY_PRINCIPAL_KIND)
      .remove(KEY_ADMIN_ALERTS_ENABLED)
      .remove(KEY_ADMIN_SECURITY_ENABLED)
      .remove(KEY_TASK_EVENTS_ENABLED)
      .apply()
  }

  fun setAppInForeground(context: Context, inForeground: Boolean) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(KEY_APP_IN_FOREGROUND, inForeground)
      .putLong(KEY_APP_STATE_UPDATED_AT, System.currentTimeMillis())
      .apply()
  }

  fun getAppForegroundState(context: Context): PmeowForegroundState {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val updatedAt = prefs.getLong(KEY_APP_STATE_UPDATED_AT, 0L)
    val inForeground = prefs.getBoolean(KEY_APP_IN_FOREGROUND, false)
    val isFresh = updatedAt > 0L && System.currentTimeMillis() - updatedAt <= FOREGROUND_STATE_MAX_AGE_MS
    return PmeowForegroundState(
      inForeground = inForeground,
      updatedAt = updatedAt,
      isFresh = isFresh,
    )
  }

  fun isAppInForeground(context: Context): Boolean {
    val state = getAppForegroundState(context)
    return state.isFresh && state.inForeground
  }
}