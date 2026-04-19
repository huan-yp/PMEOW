# 移动端 adb 冲突复盘

## 背景

在 Windows 环境执行根命令 `pnpm dev:mobile` 时，Metro、Gradle 和 APK 构建都能推进，但在安装 debug APK 时失败，典型日志如下：

- `adb server version (40) doesn't match this client (41); killing...`
- `adb.exe: device offline`
- `Command failed with exit code 1: adb install -r ...app-debug.apk`

这次故障最终通过两步恢复：

1. 彻底强杀所有 adb 进程
2. 关闭 VS Code 后重新执行 `pnpm dev:mobile`

这说明问题不能只看 Android 设备状态，还要看本机上是否存在多个 adb 发行版在争抢同一个全局 daemon。

## 静态链路拆解

### 入口

[scripts/workspace-task.mjs](../../../scripts/workspace-task.mjs) 只是把 `dev:mobile` 分发给 [scripts/workspace-task/mobile-tasks.mjs](../../../scripts/workspace-task/mobile-tasks.mjs) 的 `runDevMobile()`。

### `runDevMobile()` 的执行顺序

[scripts/workspace-task/mobile-tasks.mjs](../../../scripts/workspace-task/mobile-tasks.mjs) 中的 `runDevMobile()` 顺序非常直接：

1. 构建 `@pmeow/server-contracts`
2. 构建 `@pmeow/app-common`
3. 启动或复用 Metro
4. 执行 `ensureMetroReverse()`
5. 执行 `installAndLaunchMobileDebugApp()`
6. 进入 `waitForPersistentLogcat()` 持续跟日志

链路上和 adb 直接相关的步骤有三类：

- `ensureAdbServer()`：执行 `kill-server` 和 `start-server`
- `waitForDeviceOnline()`：等待设备状态真正变成 `device`
- `installAndLaunchMobileDebugApp()`：执行 `adb install` 和 `adb shell am start`

### 脚本内部没有“无限重启 adb”的逻辑

从 [scripts/workspace-task/process-utils.mjs](../../../scripts/workspace-task/process-utils.mjs) 可以看到：

- `runCommand()` 只是启动子进程并等待退出
- `captureCommand()` 只是采集输出后退出
- 没有任何后台守护逻辑会周期性拉起 adb server

[scripts/workspace-task/mobile-tasks.mjs](../../../scripts/workspace-task/mobile-tasks.mjs) 里唯一的循环是 `waitForPersistentLogcat()`，它只会在日志流断开时重启 `logcat` 进程，不会反复执行 `adb kill-server` / `adb start-server`。

因此，从仓库代码的静态结构可以排除一种解释：不是 `pnpm dev:mobile` 自己在后台无限重生 adb。

## 根因链条

### 1. 本机存在两个 adb 发行版

现场已经确认 `where.exe adb` 返回的是：

- `C:\Develop\scripts\adb.exe`

与此同时，仓库的 Android SDK 来自 `apps/mobile/android/local.properties` 指向的 SDK 根目录，其标准 adb 路径是：

- `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`

这意味着机器上至少同时存在：

1. Android SDK 自带 adb
2. PATH 中额外暴露的另一个 adb

### 2. adb daemon 是全局单例，不按项目隔离

adb server 默认监听本机 `5037` 端口。无论是哪一个 adb 可执行文件启动的 server，后续所有 adb client 都会去连接这个全局 daemon。

这带来一个关键后果：

- 即使当前项目脚本调用的是 SDK adb
- 只要另一份不同版本的 adb 在后台重新启动了 daemon
- 当前链路就会立刻遭遇协议版本切换和连接重置

所以日志里才会出现：

- 先看到 `server version mismatch`
- 然后 daemon 被 kill 并重启
- 紧接着设备掉进 `offline`
- 最后 `adb install` 失败

### 3. 真正的问题是“外部 adb 被持续重生”

如果只是 PATH 顺序不对，单次 `taskkill /F /IM adb.exe` 后重新执行，问题通常就会结束。

但这次现象不是这样：

- 手动强杀后，`C:\Develop\scripts\adb.exe` 很快再次出现
- 只有在关闭 VS Code 后，这个外部 adb 才停止重生
- 关闭 VS Code 后重新执行 `pnpm dev:mobile` 才成功

这组三条现象能静态排除仓库脚本本身，并把触发器收缩到“VS Code 生命周期绑定的外部进程”。最可能的来源是：

- VS Code 内某个 Android / ADB / React Native 相关扩展
- 或 VS Code 挂着的另一个终端任务、调试会话、设备监控器

仅从仓库代码无法静态定位到具体是哪个扩展，但可以明确一件事：**外部工具持续拉起了另一份 adb，并不断抢占全局 daemon。**

## 为什么会在 `adb install` 处爆炸

`runDevMobile()` 的 adb 关键路径是：

1. `ensureAdbServer()`
2. `waitForDeviceOnline()`
3. `adb reverse`
4. Gradle `assembleDebug`
5. 再次 `ensureAdbServer()`
6. 再次 `waitForDeviceOnline()`
7. `adb install -r`

问题出在第 5 到 7 步之间的时序窗口。

Gradle 构建本身没问题，APK 也已经产出。失败发生在安装阶段，说明不是 APK 构建失败，而是设备连接在安装前后被外部 adb 重新抢占。只要 daemon 在这个窗口内被不同版本 adb 改写，设备状态就会从 `device` 抖回 `offline`，随后 `install` 直接失败。

## 这次代码层面的修复

当前 [scripts/workspace-task/mobile-tasks.mjs](../../../scripts/workspace-task/mobile-tasks.mjs) 已做两类收口：

1. `getAdbPath()` 不再回退到 PATH 中的裸 `adb`
2. 移动端任务现在要求显式解析到 Android SDK 中的 adb 绝对路径；解析不到就直接失败

这次改动的意义不是“消灭所有 adb 冲突”，而是先把仓库自身的语义钉死：

- 本仓库的移动端任务只认 Android SDK 的 adb
- 不再接受 PATH 上碰巧排在前面的其他 adb

另外，链路里也已经用 `waitForDeviceOnline()` 取代了只看 `wait-for-device` 的粗粒度等待，从而避免设备仍是 `offline` 时就继续往下执行。

## 结论

这次故障的根因不是 Metro，也不是 Gradle，更不是 APK 构建本身，而是：

1. Windows 本机同时存在多个 adb 发行版
2. 其中一个外部 adb 由 VS Code 生命周期内的外部进程持续重启
3. 两个不同版本的 adb 争抢全局 5037 daemon
4. 导致设备状态在安装阶段被打断并掉到 `offline`

仓库代码此前的问题在于：虽然已经通过环境变量“倾向于”使用 SDK adb，但语义还不够硬。现在这层语义已经改成显式绑定 SDK adb，从代码层面消除了 PATH 漂移带来的歧义。

## 后续建议

在 Windows 上如果再次遇到同类问题，优先按下面顺序检查：

1. 执行 `where.exe adb`，确认机器上是否有多份 adb
2. 执行 `Get-Process adb | Select-Object Id, Path`，确认当前是谁在拉起 adb
3. 如发现非 SDK adb 持续重生，先关闭 VS Code 及相关 Android 扩展，再强杀 adb
4. 手工 adb 命令优先使用 Android SDK 的绝对路径，不要依赖 PATH 解析
5. 如果确实需要长期并存多套 Android 工具，至少保证它们的 adb 版本一致