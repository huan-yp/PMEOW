# 构建并安装 release APK

移动端目前只保留一条最短链路：构建一个 release APK，再手动安装到设备使用。
开发期间的 Metro 热更新、`run-android`、模拟器联调等流程已全部移除。

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

## 安装

把 APK 拷到设备/模拟器上手动安装，或者通过 `adb` 推送：

```powershell
adb install -r apps\mobile\android\app\build\outputs\apk\release\app-release.apk
```

## 边界

- release 变体当前复用 debug keystore 签名，仅用于本地装机验证，**不能上架分发**。
- 没有 Metro / 热更新，改动 RN 代码必须重新执行 `pnpm build:apk` 并重新安装。
- 不再提供开发期的 mobile 调试脚本；环境问题请按上面的前置依赖手动核对。
- 正式发布需要另行接入独立 release keystore 与签名密钥注入流程。