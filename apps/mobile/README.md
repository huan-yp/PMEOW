# PMEOW Mobile

PMEOW Mobile 是仓库内独立维护的 React Native 移动端应用，目录位于 `apps/mobile`。

它不是现有 Web 页面加壳，也不是旧的 Capacitor 外壳。这个包有自己独立的 React Native 入口、Android 原生工程、状态管理和通知桥接，用来提供面向手机的管理员值班视图和普通用户任务视图。

## 当前能力

- 首次连接页，支持保存后端地址并选择管理员或普通用户身份
- 本地恢复会话，保存后端 URL、登录模式和访问令牌
- 通过 `@pmeow/app-common` 调用 PMEOW Web 后端 REST API
- 通过 Socket.IO 接收节点状态、任务、告警和安全事件实时更新
- 管理员视图：集群摘要、活动告警、未解决安全事件、机器详情
- 普通用户视图：我的任务、可见机器、机器空闲订阅、通知收件箱
- Android 本地通知桥接，支持任务、告警、安全事件和机器空闲提醒

## 当前边界

- 当前只包含 Android 原生工程，没有 iOS 原生工程
- 通知是应用内本地通知，不是推送服务；需要应用进程仍然存活
- 没有前台服务、后台常驻同步或 FCM 推送链路
- Release 构建仍使用 debug signing，不适合直接作为生产发布配置

## 架构概览

### 1. 共享协议层

移动端不单独维护接口定义，而是直接依赖 `@pmeow/app-common`。

- API 路径常量
- Socket 事件名
- Server、Task、Alert、SecurityEvent、AuthSession 等共享类型

这保证了移动端和 Web 后端使用同一套协议定义，避免手写重复 DTO。

### 2. React Native 入口

- `index.js` 注册根组件
- `src/App.tsx` 负责顶层装配和登录态分支

应用启动后，`App.tsx` 会调用 Zustand store 的 `hydrate`，先恢复本地会话，再决定进入连接页还是已登录壳层。

### 3. 状态与数据流

核心状态集中在 `src/store/useAppStore.ts`。

启动阶段的数据流如下：

1. 从 AsyncStorage 恢复 `baseUrl`、`mode`、`authToken`
2. 如果存在 token，调用 `/api/session/me` 校验会话
3. 并发拉取 overview 数据，包括服务器、状态、最新指标、告警、安全事件、个人任务
4. 使用 Socket.IO 建立实时连接，继续接收增量事件
5. 按当前角色和通知偏好决定是否触发本地通知

对应模块：

- `src/lib/api.ts`：REST API 客户端
- `src/store/overview.ts`：首屏快照加载
- `src/lib/realtime.ts`：Socket.IO 客户端
- `src/store/realtime.ts`：实时事件写入 store
- `src/lib/storage.ts`：会话持久化
- `src/store/notifications.ts`：通知规则和收件箱持久化

### 4. UI 装配

当前 UI 不是单文件硬编码，已经拆成壳层、通用组件和 screen 组件：

- `src/App.tsx`：顶层状态判断、管理员/普通用户分流、机器详情切换
- `src/components/common.tsx`：通用卡片、底部 tab、列表行、已登录壳层
- `src/screens/ConnectionScreen.tsx`：连接和认证输入
- `src/screens/AdminScreens.tsx`：管理员首页和告警页
- `src/screens/PersonScreens.tsx`：普通用户首页和任务页
- `src/screens/ServerDetailScreen.tsx`：机器详情和空闲订阅
- `src/screens/SettingsScreen.tsx`：通知偏好、收件箱、退出登录

### 5. Android 原生桥接

Android 原生工程位于 `android/`。

- `android/app/src/main/java/com/pmeowmobile/MainApplication.kt` 注册自定义 React Package
- `android/app/src/main/java/com/pmeowmobile/PmeowNotificationsModule.kt` 实现通知权限申请、通知渠道创建和系统通知发送
- `src/lib/native-notifications.ts` 是 JS 侧桥接封装

当前本地通知只覆盖 Android，并且由 JS 侧业务逻辑触发，不会在应用完全退出后继续独立运行。

## 目录结构

```text
apps/mobile/
  index.js                  React Native 入口
  src/App.tsx               顶层应用装配
  src/app/                  常量、格式化、样式
  src/components/           通用 UI 组件
  src/lib/                  API、实时连接、存储、通知桥接
  src/screens/              页面级组件
  src/store/                Zustand 状态和业务逻辑
  android/                  Android 原生工程
```

## 开发前提

- Node.js 20 或更高版本
- 已在仓库根目录安装依赖
- 可用的 Android SDK、adb、JDK 17 和本地模拟器或真机
- PMEOW Web 后端已启动，并且你知道管理员密码或人员令牌

如果本机默认 `JAVA_HOME` 不是 JDK 17，可以在仓库根目录创建 `.java-home.local`，内容写 JDK 17 的绝对路径。根目录的 `npm run build:apk` 会优先使用这个路径。

## 本地开发

### 1. 安装依赖

在仓库根目录执行依赖安装。

```bash
pnpm install
```

### 2. 启动 PMEOW Web 后端

移动端依赖现有 PMEOW Web API 和 Socket 服务，先在仓库根目录启动后端：

```bash
pnpm build:web
pnpm run:web
```

这里的 `build:web` 会在根目录统一编排 `apps/web` 和 `server/runtime` 所需依赖，`run:web` 会启动后端并托管生产静态资源。

如果你只是连接一个已经部署好的 PMEOW 服务端，也可以跳过这一步，直接在移动端连接页填入对应基础 URL。

### 3. 当前仓库入口

```bash
pnpm build:apk
```

当前根 `package.json` 公开的移动端入口只有这个 APK 构建命令。它会：

1. 构建 `@pmeow/server-contracts`
2. 构建 `@pmeow/app-common`
3. 在 `apps/mobile/android` 执行 Release APK 构建

如果你要做 React Native / Android 本地联调，请直接使用仓库根目录的 `pnpm dev:mobile`，它走的是原始 Metro + Gradle debug 安装链路，不再依赖额外 CLI 补丁。

## Android 构建

### 调试构建

如果你只想在 Android 工程内直接出调试包，可以进入 `apps/mobile/android` 后执行：

```bash
.\gradlew.bat assembleDebug
```

如果你使用仓库根目录脚本，`.java-home.local` 同样会自动生效。

默认输出位于：

- `android/app/build/outputs/apk/debug/`

如果你要启动原始 Metro 服务，也可以在仓库根目录执行：

```bash
node ./node_modules/metro/src/cli.js serve --config ./apps/mobile/metro.config.cjs --port 8081 --host localhost
```

再在 `apps/mobile/android` 目录执行：

```bash
.\gradlew.bat installDebug
adb shell am start -n com.pmeowmobile/.MainActivity
adb logcat -v time ReactNative:V ReactNativeJS:V AndroidRuntime:E System.err:V *:S
```

### Release 构建

当前 `android/app/build.gradle` 中的 release 仍然复用 debug signing：

- 适合本地验证构建链是否可用
- 不适合作为正式发布配置

如果要发布正式 APK，需要先改为自己的签名文件和签名参数。

## 认证方式

连接页支持两种模式：

- 管理员模式：使用管理员密码调用登录接口，拿到 Bearer token
- 普通用户模式：使用人员令牌调用同一套登录入口，拿到 Bearer token

登录成功后，移动端会把 token 持久化到本地，并在下次启动时尝试恢复会话。

## 通知行为

通知逻辑分两层：

- 业务层决定什么事件值得通知
- Android 原生层负责真正显示系统通知

当前支持的通知类别：

- 管理员：任务事件、活动告警、未解决安全事件
- 普通用户：我的任务变更、订阅机器空闲提醒

收件箱只展示本机真正发送成功的系统通知，不是服务端通知历史。

## 常见问题

### 连接失败

- 确认输入的是 PMEOW Web 服务端基础 URL，而不是单个页面地址
- 确认 Android 设备能访问该地址
- 如果服务端使用自签名证书，Android 可能会直接拒绝连接

### 登录后没有数据

- 管理员和普通用户能看到的数据范围不同
- 普通用户依赖人员绑定关系和 token 所对应的访问范围
- 如果实时连接未建立，先尝试手动刷新确认 REST 接口是否正常

### 没有收到通知

- Android 13 及以上需要授予通知权限
- 应用被彻底杀死后，当前实现不会继续在后台主动拉取事件
- 只有满足当前角色和通知偏好的事件才会真正发送本地通知

## 相关文档

- 仓库总览：`../../README.md`
- 用户文档：`../../docs/user/mobile-app.md`
- 人员与令牌：`../../docs/user/people-and-access.md`

如果你要继续扩展移动端，建议先从 `src/store/useAppStore.ts`、`src/store/realtime.ts` 和 `src/screens/` 开始读。
