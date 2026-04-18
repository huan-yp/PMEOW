# 构建并安装 release APK

移动端当前有两条明确分工的链路：

- 开发调试链路：用于 Windows 模拟器上的 debug 安装、Metro 热刷新和日志回流
- release 构建链路：用于生成可手动安装验证的 release APK

这次链路收缩和构建修复过程中遇到的问题、根因和处理过程，见 [移动端清理与 Release APK 构建问题复盘.md](./移动端清理与%20Release%20APK%20构建问题复盘.md)。

## 前置依赖

构建前需要本机已经具备：

- Node.js >= 20、pnpm
- JDK 17（建议直接用 Android Studio 自带的 JBR）
- Android SDK（含 `platforms/android-35`、`build-tools`、`platform-tools`）
- 环境变量 `JAVA_HOME` 指向 JDK 17，`ANDROID_HOME`（或 `ANDROID_SDK_ROOT`）指向 SDK 根目录

如果不想配 `ANDROID_HOME`，也可以在 [apps/mobile/android](../../../apps/mobile/android) 下创建 `local.properties`：

```properties
sdk.dir=C\:\\Users\\<你的用户名>\\AppData\\Local\\Android\\Sdk
```

## 构建

在仓库根目录执行：

```powershell
pnpm install
pnpm build:apk
```

`pnpm build:apk` 会按顺序：

1. 构建共享协议包 `@monitor/server-contracts`
2. 构建共享应用包 `@monitor/app-common`
3. 进入 [apps/mobile/android](../../../apps/mobile/android) 执行 `gradlew assembleRelease`

产物路径：

- [apps/mobile/android/app/build/outputs/apk/release/app-release.apk](../../../apps/mobile/android/app/build/outputs/apk/release/app-release.apk)

## 开发调试

在仓库根目录执行：

```powershell
pnpm dev:mobile
```

这条命令会按顺序：

1. 构建 `@monitor/server-contracts`
2. 构建 `@monitor/app-common`
3. 在 [apps/mobile](../../../apps/mobile) 启动 Metro
4. 对当前 adb 设备执行 `adb reverse tcp:8081 tcp:8081`
5. 对当前 adb 设备执行 `installDebug`
6. 启动 `com.pmeowmobile/.MainActivity`
7. 在当前终端持续输出 Metro 与 logcat 日志

如果你只想单独看移动端日志，可以执行：

```powershell
pnpm dev:mobile:logs
```

当前调试链路的边界：

- Fast Refresh 只保证 [apps/mobile](../../../apps/mobile) 下的 JS/TS 改动自动反映
- 当前实现使用 Metro API + React Native dev middleware 与 Gradle `installDebug`，不依赖额外 React Native CLI 补丁
- 不负责共享包源码 watch；如果你修改 [apps/common](../../../apps/common) ，需要重新触发对应构建
- `pnpm dev:mobile` 会自动对当前 adb 设备执行 `adb reverse tcp:8081 tcp:8081`
- 原生 Android 代码改动仍需重新安装 debug 包，不能指望 Metro 直接生效

## 安装

把 APK 拷到设备/模拟器上手动安装，或者通过 `adb` 推送：

```powershell
adb install -r apps\mobile\android\app\build\outputs\apk\release\app-release.apk
```

## 边界

- release 变体当前复用 debug keystore 签名，仅用于本地装机验证，**不能上架分发**。
- release APK 不是开发调试链路；改动 [apps/mobile](../../../apps/mobile) 时应优先使用上面的 `pnpm dev:mobile`。
- 当前开发命令只自动处理 Metro 默认端口的 `adb reverse`；其他网络代理设置仍需本地环境自行处理。
- 正式发布需要另行接入独立 release keystore 与签名密钥注入流程。