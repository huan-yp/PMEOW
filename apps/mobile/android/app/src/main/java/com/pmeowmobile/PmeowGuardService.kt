package com.pmeowmobile

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log
import io.socket.client.IO
import io.socket.client.Socket
import io.socket.emitter.Emitter
import io.socket.engineio.client.transports.WebSocket
import org.json.JSONObject
import java.net.URI

class PmeowGuardService : Service() {

  companion object {
    private const val LOG_TAG = "PmeowGuardService"

    private const val ACTION_START_OR_UPDATE = "com.pmeowmobile.action.START_GUARD_SERVICE"
    private const val ACTION_STOP = "com.pmeowmobile.action.STOP_GUARD_SERVICE"

    private const val EXTRA_BASE_URL = "baseUrl"
    private const val EXTRA_TOKEN = "token"
    private const val EXTRA_PRINCIPAL_KIND = "principalKind"
    private const val EXTRA_ADMIN_ALERTS_ENABLED = "adminAlertsEnabled"
    private const val EXTRA_ADMIN_SECURITY_ENABLED = "adminSecurityEnabled"
    private const val EXTRA_TASK_EVENTS_ENABLED = "taskEventsEnabled"

    fun createStartIntent(context: Context, config: PmeowGuardServiceConfig): Intent {
      return Intent(context, PmeowGuardService::class.java).apply {
        action = ACTION_START_OR_UPDATE
        putExtra(EXTRA_BASE_URL, config.baseUrl)
        putExtra(EXTRA_TOKEN, config.token)
        putExtra(EXTRA_PRINCIPAL_KIND, config.principalKind)
        putExtra(EXTRA_ADMIN_ALERTS_ENABLED, config.adminAlertsEnabled)
        putExtra(EXTRA_ADMIN_SECURITY_ENABLED, config.adminSecurityEnabled)
        putExtra(EXTRA_TASK_EVENTS_ENABLED, config.taskEventsEnabled)
      }
    }

    fun createStopIntent(context: Context): Intent {
      return Intent(context, PmeowGuardService::class.java).apply {
        action = ACTION_STOP
      }
    }
  }

  private var socket: Socket? = null
  private var activeConfig: PmeowGuardServiceConfig? = null

  override fun onCreate() {
    super.onCreate()
    PmeowNotificationHelper.ensureChannels(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      Log.i(LOG_TAG, "received stop request")
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }

    val config = extractConfig(intent) ?: PmeowGuardConfigStore.loadConfig(this)
    if (config == null || !config.isValid()) {
      Log.w(LOG_TAG, "guard service missing valid config, stopping")
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }

    Log.i(
      LOG_TAG,
      "startOrUpdate config principal=${config.principalKind} alerts=${config.adminAlertsEnabled} security=${config.adminSecurityEnabled} taskEvents=${config.taskEventsEnabled}",
    )

    PmeowGuardConfigStore.saveConfig(this, config)
    startForeground(
      PmeowNotificationHelper.GUARD_NOTIFICATION_ID,
      PmeowNotificationHelper.buildGuardNotification(this, "保障实时通知，正在建立连接..."),
    )

    if (config != activeConfig) {
      reconnectSocket(config)
    } else {
      PmeowNotificationHelper.updateGuardNotification(this, "保障实时通知，后台值守中")
    }

    return START_STICKY
  }

  override fun onDestroy() {
    Log.i(LOG_TAG, "service destroyed")
    disconnectSocket()
    activeConfig = null
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun extractConfig(intent: Intent?): PmeowGuardServiceConfig? {
    if (intent == null || intent.action != ACTION_START_OR_UPDATE) {
      return null
    }

    return PmeowGuardServiceConfig(
      baseUrl = intent.getStringExtra(EXTRA_BASE_URL) ?: "",
      token = intent.getStringExtra(EXTRA_TOKEN) ?: "",
      principalKind = intent.getStringExtra(EXTRA_PRINCIPAL_KIND) ?: "",
      adminAlertsEnabled = intent.getBooleanExtra(EXTRA_ADMIN_ALERTS_ENABLED, true),
      adminSecurityEnabled = intent.getBooleanExtra(EXTRA_ADMIN_SECURITY_ENABLED, true),
      taskEventsEnabled = intent.getBooleanExtra(EXTRA_TASK_EVENTS_ENABLED, true),
    ).takeIf { it.isValid() }
  }

  private fun reconnectSocket(config: PmeowGuardServiceConfig) {
    disconnectSocket()
    activeConfig = config
    PmeowNotificationHelper.updateGuardNotification(this, "正在连接 PMEOW 实时通道...")
    Log.i(LOG_TAG, "connecting realtime socket baseUrl=${config.baseUrl}")

    try {
      val options = IO.Options().apply {
        forceNew = true
        reconnection = true
        timeout = 10000
        transports = arrayOf(WebSocket.NAME)
        auth = mapOf("token" to config.token)
      }

      val createdSocket = IO.socket(URI.create(config.baseUrl), options)

      createdSocket.on(Socket.EVENT_CONNECT, onConnect)
      createdSocket.on(Socket.EVENT_DISCONNECT, onDisconnect)
      createdSocket.on(Socket.EVENT_CONNECT_ERROR, onConnectError)
      createdSocket.on("taskEvent", onTaskEvent)
      createdSocket.on("alertStateChange", onAlertStateChange)
      createdSocket.on("securityEvent", onSecurityEvent)
      createdSocket.connect()
      socket = createdSocket
    } catch (error: Throwable) {
      Log.w(LOG_TAG, "socket bootstrap failed: ${error.message}", error)
      PmeowNotificationHelper.updateGuardNotification(this, "实时连接启动失败，稍后将重试")
    }
  }

  private fun disconnectSocket() {
    socket?.off(Socket.EVENT_CONNECT, onConnect)
    socket?.off(Socket.EVENT_DISCONNECT, onDisconnect)
    socket?.off(Socket.EVENT_CONNECT_ERROR, onConnectError)
    socket?.off("taskEvent", onTaskEvent)
    socket?.off("alertStateChange", onAlertStateChange)
    socket?.off("securityEvent", onSecurityEvent)
    socket?.disconnect()
    socket?.close()
    socket = null
    Log.i(LOG_TAG, "socket disconnected and cleared")
  }

  private val onConnect = Emitter.Listener {
    Log.i(LOG_TAG, "socket connected socketId=${socket?.id() ?: "unknown"}")
    PmeowNotificationHelper.updateGuardNotification(this, "保障实时通知，后台值守中")
  }

  private val onDisconnect = Emitter.Listener { args ->
    val reason = args.firstOrNull()?.toString() ?: "unknown"
    Log.i(LOG_TAG, "socket disconnected reason=$reason")
    PmeowNotificationHelper.updateGuardNotification(this, "实时连接已断开，正在尝试重连")
  }

  private val onConnectError = Emitter.Listener { args ->
    val message = args.firstOrNull()?.toString() ?: "unknown"
    Log.w(LOG_TAG, "socket connect error=$message")
    PmeowNotificationHelper.updateGuardNotification(this, "实时连接失败，正在重试")
  }

  private val onTaskEvent = Emitter.Listener { args ->
    val config = activeConfig ?: return@Listener
    if (!config.taskEventsEnabled) {
      return@Listener
    }

    val payload = toJsonObject(args.firstOrNull()) ?: return@Listener
  Log.i(LOG_TAG, "received taskEvent payloadKeys=${payload.keys().asSequence().toList()}")
    val task = payload.optJSONObject("task") ?: return@Listener
    val serverId = payload.optString("serverId").ifBlank { task.optString("serverId") }
    val eventType = payload.optString("eventType")
    val command = task.optString("command").ifBlank { "任务变更" }
    val user = task.optString("user").ifBlank { "未知用户" }
    val title = if (config.principalKind == "admin") {
      "任务${formatTaskEventType(eventType)} · ${serverId.ifBlank { "未知节点" }}"
    } else {
      "我的任务${formatPersonTaskEventType(eventType)}"
    }

    showRealtimeNotification(title, "$command · $user", serverId.ifBlank { null })
  }

  private val onAlertStateChange = Emitter.Listener { args ->
    val config = activeConfig ?: return@Listener
    if (config.principalKind != "admin" || !config.adminAlertsEnabled) {
      return@Listener
    }

    val payload = toJsonObject(args.firstOrNull()) ?: return@Listener
    Log.i(LOG_TAG, "received alertStateChange toStatus=${payload.optString("toStatus")}")
    if (payload.optString("toStatus") != "active") {
      return@Listener
    }

    val alert = payload.optJSONObject("alert") ?: return@Listener
    val serverId = alert.optString("serverId").ifBlank { "未知节点" }
    val alertType = alert.optString("alertType")
    val title = "${formatAlertType(alertType)}告警 · $serverId"
    showRealtimeNotification(title, formatAlertValue(alertType, alert.opt("value")), serverId)
  }

  private val onSecurityEvent = Emitter.Listener { args ->
    val config = activeConfig ?: return@Listener
    if (config.principalKind != "admin" || !config.adminSecurityEnabled) {
      return@Listener
    }

    val payload = toJsonObject(args.firstOrNull()) ?: return@Listener
    Log.i(LOG_TAG, "received securityEvent type=${payload.optString("eventType")}")
    if (payload.optBoolean("resolved", false)) {
      return@Listener
    }

    val serverId = payload.optString("serverId").ifBlank { "未知节点" }
    val eventType = payload.optString("eventType")
    showRealtimeNotification("安全事件 · $serverId", formatSecurityEventType(eventType), serverId)
  }

  private fun showRealtimeNotification(title: String, body: String, subText: String?) {
    val foregroundState = PmeowGuardConfigStore.getAppForegroundState(this)
    if (foregroundState.isFresh && foregroundState.inForeground) {
      Log.i(
        LOG_TAG,
        "suppress notification while app foreground title=$title updatedAt=${foregroundState.updatedAt}",
      )
      return
    }

    if (foregroundState.inForeground && !foregroundState.isFresh) {
      Log.w(
        LOG_TAG,
        "foreground marker stale, allowing background notification title=$title updatedAt=${foregroundState.updatedAt}",
      )
    }

    PmeowNotificationHelper.showEventNotification(this, title, body, subText)
    Log.i(LOG_TAG, "posted realtime notification title=$title subText=${subText ?: ""}")
  }

  private fun toJsonObject(value: Any?): JSONObject? {
    return when (value) {
      is JSONObject -> value
      is Map<*, *> -> JSONObject(value)
      is String -> runCatching { JSONObject(value) }.getOrNull()
      else -> null
    }
  }

  private fun formatTaskEventType(eventType: String): String {
    return when (eventType) {
      "submitted" -> "提交"
      "started" -> "启动"
      "ended" -> "结束"
      else -> "变更"
    }
  }

  private fun formatPersonTaskEventType(eventType: String): String {
    return when (eventType) {
      "submitted" -> "已提交"
      "started" -> "已启动"
      "ended" -> "已结束"
      else -> "有更新"
    }
  }

  private fun formatAlertType(alertType: String): String {
    return when (alertType) {
      "cpu" -> "CPU "
      "memory" -> "内存 "
      "disk" -> "磁盘 "
      "gpu_temp" -> "GPU 温度 "
      "offline" -> "离线 "
      "gpu_idle_memory" -> "GPU 空闲 "
      else -> ""
    }
  }

  private fun formatAlertValue(alertType: String, value: Any?): String {
    if (alertType == "offline" && value is Number) {
      return "节点已离线 ${value.toLong()} 秒"
    }
    if (alertType == "gpu_temp" && value is Number) {
      return String.format("GPU 温度 %.1f°C", value.toDouble())
    }
    if (value is Number) {
      return String.format("阈值 %.1f%%", value.toDouble())
    }
    return "告警阈值触发"
  }

  private fun formatSecurityEventType(eventType: String): String {
    return when (eventType) {
      "suspicious_process" -> "发现可疑进程"
      "unowned_gpu" -> "发现未归属 GPU"
      "high_gpu_utilization" -> "发现高 GPU 利用率"
      "marked_safe" -> "已标记为安全"
      "unresolve" -> "事件已重新打开"
      else -> "发现新的安全事件"
    }
  }
}