# 移动端清理与 Release APK 构建问题复盘

## 背景

这次工作的目标不是继续修补移动端开发链路，而是主动收缩范围：

1. 删除移动端开发期脚本、调试脚本和调试文档
2. 只保留一条可以稳定执行的链路：在仓库根目录构建 release APK
3. 构建完成后，手动安装 APK 并做人工验证

在真正开始收缩链路之后，问题并没有减少，反而更集中地暴露了出来。此前移动端相关能力散落在多个脚本、多个 workspace 包、React Native 默认约定和 pnpm 的链接行为里，任何一个环节出错，表面症状都只是“脚本跑不通”。这次复盘的核心价值，是把这些失败拆成可以解释、可以复现、可以规避的具体问题。

## 最终结果

- 移动端只保留根脚本 `pnpm build:apk`
- `pnpm build:apk` 已在 Windows 环境下构建成功
- 产物位于 [apps/mobile/android/app/build/outputs/apk/release/app-release.apk](../../../apps/mobile/android/app/build/outputs/apk/release/app-release.apk)
- 移动端开发期脚本、Metro 启动脚本、`run-android` 封装链路和调试文档已移除
- 构建链路当前依赖 monorepo 根 `node_modules` 的 hoisted 布局

## 问题总览

这次过程中遇到的问题可以分成六类：

1. 链路目标不清，调试脚本过多，导致故障点被掩盖
2. TypeScript 在子包构建阶段误吸收了不相关的全局类型定义
3. `workspace-task.mjs` 混用了 npm workspace 运行方式和 pnpm 安装布局
4. React Native Android 工程默认假设 `apps/mobile/node_modules` 完整存在，但 monorepo + pnpm hoisted 下并不成立
5. Metro 在 monorepo 中没有正确解析根 `node_modules`
6. React Native Gradle / Hermes / Autolinking 对路径与依赖声明都有隐式前提，这些前提原工程并不满足

下面按问题链条展开。

## 一、问题起点：移动端开发链路本身已经失效

### 现象

在清理前，以下命令都无法稳定运行：

- `pnpm dev:mobile`
- `pnpm run start --workspace=@pmeow/mobile`
- `pnpm --filter @pmeow/mobile start`
- `node scripts/run-mobile-react-native.mjs start`
- `pnpm run:mobile:android`

这些失败说明一个事实：移动端“开发期体验链路”已经失去可维护性。继续保留这些入口，只会制造一种“理论上还能开发调试”的错觉。

### 根因

- React Native CLI、Metro、Gradle、pnpm workspace、脚本封装层互相叠加
- 多个脚本只是对同一问题做重复包装，并没有消除根因
- 默认路径假设和 monorepo 实际布局长期漂移

### 处理

- 删除根脚本中的 `dev:mobile`、`run:mobile:android`、`build:mobile:apk`、`check:mobile`
- 删除移动端侧 `start`、`android`、`apk:debug` 等开发期脚本
- 删除不再需要的脚本封装和调试文档
- 将目标收缩为一条 release APK 构建链路

### 结论

这是一次有意的“降复杂度”而不是“功能退化”。问题不是少了功能，而是把已经失效的伪能力删掉，只保留真正需要维护的一条链路。

## 二、TypeScript 子包构建失败：误吸收 hoisted 全局类型

### 现象

一开始执行 `pnpm build:apk`，在真正进入 Android 构建前，先失败在两个 TypeScript 子包：

- `@pmeow/server-contracts`
- `@pmeow/app-common`

典型报错：

- `Cannot find type definition file for 'node'`
- `Cannot find type definition file for 'react'`
- `Cannot find type definition file for 'react-dom'`
- `Cannot find type definition file for 'superagent'`
- `Cannot find type definition file for 'supertest'`

### 根因

这两个包的 `tsconfig.json` 没有显式约束 `types`。在 monorepo 根存在 hoisted 依赖时，TypeScript 会尝试自动加载环境中可见的 `@types/*` 包。于是一个本来只编译自身源码的小包，被迫背上了并不属于它的类型依赖集合。

这不是“缺少依赖安装”，而是“类型边界不清”。

### 处理

在以下两个文件中显式设置 `"types": []`：

- [server/contracts/tsconfig.json](../../../server/contracts/tsconfig.json)
- [apps/common/tsconfig.json](../../../apps/common/tsconfig.json)

### 结果

`@pmeow/server-contracts` 和 `@pmeow/app-common` 都能独立完成构建，不再被根目录其他包的类型定义污染。

### 经验

在 monorepo 中，任何“纯协议包”或“纯共享包”都不应依赖 TypeScript 的隐式类型发现。类型边界必须由包自己声明，而不是由工作区环境碰运气决定。

## 三、构建编排层问题：脚本运行器使用了错误的包管理器语义

### 现象

即使 TypeScript 本身可以单独编译，构建编排脚本 [scripts/workspace-task.mjs](../../../scripts/workspace-task.mjs) 仍然可能在子包执行阶段报错，典型形式是：

- 子包脚本找不到本地 `node_modules` 下的 `typescript/bin/tsc`
- 根脚本使用 workspace 方式调用子包时，实际行为和 pnpm 安装结果不匹配

### 根因

原脚本使用 `npm.cmd` 和 npm workspace 风格执行子包脚本，但仓库实际由 pnpm 管理，且最终还引入了 `node-linker=hoisted`。这意味着：

- 安装布局由 pnpm 决定
- 子包脚本解析依赖时应遵循 pnpm 的 workspace 语义
- 再用 npm 去跑子包脚本，会把执行行为和安装结果拆成两套体系

### 处理

在 [scripts/workspace-task.mjs](../../../scripts/workspace-task.mjs) 中做了两类改动：

1. 将子包脚本调用改为 `pnpm --filter <workspace> run <script>`
2. 把 Android 构建统一收口到 `build:apk`，不再保留 mobile 开发期任务

另外，脚本里内联了 `getJavaEnv()`，从仓库根 `.java-home.local` 注入 `JAVA_HOME`，避免 release 构建依赖已经删除的旧脚本。

### 结果

构建编排层终于和实际的包管理器一致，不再出现“包明明装了，但子命令还是找不到”的错位现象。

### 经验

在 monorepo 里，谁负责安装依赖，谁就应该负责调度子包脚本。pnpm 安装出来的 workspace，不应该再用 npm workspace 语义去执行。

## 四、React Native Gradle 插件解析失败

### 现象

在 TypeScript 阶段通过后，Android 构建直接失败于 `settings.gradle`：

- `Plugin [id: 'com.facebook.react.settings'] was not found`
- `Included build ... @react-native/gradle-plugin does not exist`

### 根因

这里有两个问题叠加：

1. `@react-native/gradle-plugin` 不是 `apps/mobile` 的显式依赖，只能依赖传递依赖或 hoisting 碰巧可见
2. Android 工程默认使用相对路径去找 `../node_modules/@react-native/gradle-plugin`，但在当前 monorepo 下，实际稳定位置是仓库根 `node_modules`

只要任一前提不成立，Gradle settings plugin 就会在 very early phase 直接失败，甚至还没开始编译业务代码。

### 处理

1. 在 [apps/mobile/package.json](../../../apps/mobile/package.json) 中显式添加 `@react-native/gradle-plugin`
2. 在仓库根新增 [.npmrc](../../../.npmrc)，设置 `node-linker=hoisted`
3. 修改 [apps/mobile/android/settings.gradle](../../../apps/mobile/android/settings.gradle)，把 `includeBuild` 路径改为指向根 `node_modules`

### 结果

Gradle 可以正确加载 `com.facebook.react.settings`，Android 构建从“启动即失败”推进到后续打包阶段。

### 经验

React Native Android 工程对 Gradle plugin 的假设比普通 JS 包更强。只要插件需要被 Gradle 直接当作 included build 解析，就不应该依赖传递依赖“顺便可见”，必须声明成直接依赖并把路径写实。

## 五、Monorepo 路径漂移：React Native 默认目录假设不成立

### 现象

在继续构建时，又出现了多类路径相关错误：

- `entryFile` 被错误解析到仓库根 `index.js`
- React Native CLI、Codegen、Hermes 默认都从 `apps/mobile/node_modules` 推导路径
- 但当前稳定的依赖位置其实在根 `node_modules`

### 根因

React Native 默认模板假设“应用目录旁边就有完整 node_modules”。这个假设在单包仓库成立，但在 pnpm monorepo 尤其是 hoisted 场景下并不可靠。

### 处理

在 [apps/mobile/android/app/build.gradle](../../../apps/mobile/android/app/build.gradle) 的 `react {}` 中显式指定：

- `reactNativeDir`
- `codegenDir`
- `cliFile`
- `hermesCommand`

同时保留默认 `root`，避免把 entry file 错误地提升到仓库根目录。

### 结果

React Native Android 插件不再依赖错误的默认路径推断，JS 打包、Codegen、Hermes 编译都能从实际存在的位置取到文件。

### 经验

一旦 React Native 应用不是仓库根项目，而是 monorepo 下的子应用，就应该默认检查 `react {}` 里的目录推断是否仍然成立。不能假设模板默认值在 monorepo 中依旧有效。

## 六、Metro 在 monorepo 下无法解析根依赖

### 现象

构建推进到 JS bundle 阶段后，Metro 报错：

- `Unable to resolve module @babel/runtime/helpers/interopRequireDefault`

更麻烦的是，文件其实是存在的，但 Metro 仍然报告找不到。

### 根因

这是 monorepo 下最典型的一类问题：

1. 依赖实际存在于根 `node_modules`
2. Metro 的解析根仍然偏向 `apps/mobile`
3. 如果不显式声明 `watchFolders` 和 `resolver.nodeModulesPaths`，Metro 未必会去工作区根搜依赖

另一个次级问题是，`@babel/runtime` 需要作为移动端直接依赖出现，而不是仅靠其他包间接带入。

### 处理

1. 在 [apps/mobile/package.json](../../../apps/mobile/package.json) 中显式声明 `@babel/runtime`
2. 修改 [apps/mobile/metro.config.cjs](../../../apps/mobile/metro.config.cjs)
3. 为 Metro 增加：
   - `watchFolders: [workspaceRoot]`
   - `resolver.nodeModulesPaths: [workspaceRoot/node_modules]`

### 结果

Metro 成功完成 bundle 输出，Release JS 资源可以写入 Android 构建目录。

### 经验

在 monorepo 中，只要 Metro 要消费根层 hoisted 依赖，就应该显式配置工作区根路径，不要依赖 Metro 对目录结构的猜测。

## 七、Hermes 编译器路径缺失

### 现象

JS bundle 生成后，又出现 Hermes 阶段报错：

- `Couldn't determine Hermesc location`

### 根因

Hermes 位置的默认推导同样依赖 React Native 的默认目录布局。由于当前移动端项目不再使用子目录内的完整 `node_modules`，默认推导失效。

### 处理

在 [apps/mobile/android/app/build.gradle](../../../apps/mobile/android/app/build.gradle) 中显式设置 `hermesCommand` 为根 `node_modules/react-native/sdks/hermesc/%OS-BIN%/hermesc` 的绝对路径。

### 结果

JS bundle 之后的 Hermes 编译可以正常继续，整个 Android release 构建得以闭环。

### 经验

Hermes 的失败通常不是 Hermes 本身的问题，而是“React Native 目录推导失效”的后继症状。

## 八、Java 环境注入与 Windows 本地约束

### 现象

Android 构建在 Windows 上很容易受到本机 JDK 路径影响。原先 release 构建链路没有可靠地把 JDK 17 注入给 Gradle。

### 根因

- 清理旧脚本后，原有 `mobile-java-config.mjs` 不再存在
- 但 release 构建仍然需要稳定拿到 JDK 17
- Windows 机器上全局 `JAVA_HOME` 经常并不可靠，或者和 Android Gradle Plugin 要求的版本不一致

### 处理

在 [scripts/workspace-task.mjs](../../../scripts/workspace-task.mjs) 内联 `getJavaEnv()`：

- 从仓库根 `.java-home.local` 读取 `JAVA_HOME`
- 构造新的 `PATH`
- 在执行 `gradlew assembleRelease` 时显式传入环境变量

### 结果

release 构建不再依赖当前 shell 的偶然环境，而是由仓库局部配置稳定驱动。

### 经验

本地 Android 构建需要的 JDK 版本不应完全交给开发者机器的全局环境。对这类高耦合工具链，局部、显式、可追踪的注入方式更可靠。

## 九、辅助修复：React Native 配置与 Kotlin 兼容细节

除了主链路问题，还做了两项辅助性修复：

### 1. React Native Android project 元数据补齐

新增 [apps/mobile/react-native.config.js](../../../apps/mobile/react-native.config.js)，显式声明 Android `packageName`，减少 Autolinking / CLI 在 monorepo 场景下的猜测空间。

### 2. Kotlin 权限回调签名修正

在 [apps/mobile/android/app/src/main/java/com/pmeowmobile/PmeowNotificationsModule.kt](../../../apps/mobile/android/app/src/main/java/com/pmeowmobile/PmeowNotificationsModule.kt) 中，把 `permissions` 从 `Array<out String>` 调整为 `Array<String>`，使其与当前 React Native / Android 回调签名更一致，避免 Kotlin 编译兼容性问题。

这两项不是导致 `build:apk` 失败的唯一主因，但它们属于“迟早会在后续构建或升级中炸出”的兼容性隐患，因此一并收敛了。

## 十、为什么必须引入 hoisted node_modules

这次修复中最关键、也最值得单独记录的一点，是仓库根 [.npmrc](../../../.npmrc) 中新增的：

```ini
node-linker=hoisted
```

### 原因

React Native Android 这一套工具链，不只是 Node.js 运行时解析 JS 包；它还包括：

- Gradle includeBuild
- Codegen
- Metro
- Hermes
- Android 原生插件和 CLI 的协同

其中有不少环节默认假设“物理目录结构接近 npm/yarn 扁平 node_modules”。pnpm 的隔离链接模式在很多普通前端项目里完全没问题，但对 React Native Android 这类跨 JS / Gradle / CMake 的混合工具链，兼容成本明显更高。

### 结论

在当前仓库结构下，选择 hoisted 不是审美问题，而是为了让 React Native 工具链与 monorepo 物理目录结构达成最低限度的一致。

## 十一、仍然存在的边界和未解决项

虽然 release APK 已成功构建，但下面这些项仍然存在：

1. 构建日志里还有 npm 对 pnpm 配置项的 warning

这是因为子包脚本内部仍会触发 npm 风格生命周期输出，看到 `Unknown env config` / `Unknown project config` 警告并不代表构建失败。它们是噪声，不是 blocker。

2. Windows 上有 CMake 路径过长 warning

`@react-native-async-storage/async-storage` 的 codegen 目录在 Windows 下路径较长，会触发 object file path warning。当前构建成功，说明它不是 blocker，但后续如果路径再变长，仍可能碰到 Windows 路径长度边界。

3. AsyncStorage AndroidManifest 的 package warning 仍然存在

这是上游库的 manifest 写法提示，不影响当前构建成功，但属于依赖升级时应关注的兼容项。

4. 当前 release 仍复用 debug keystore

这保证了“可构建、可安装、可人工验证”，但不等于“可正式分发”。正式发布仍需独立 release keystore、签名配置和密钥注入流程。

5. 当前不再保留移动端开发期脚本

这不是遗漏，而是明确选择。仓库现在只承诺维护 release APK 构建链路，不承诺维护 RN 本地开发体验。

## 十二、最终落地的结构变化

### 保留

- 根脚本 `pnpm build:apk`
- Android release APK 构建链路
- 手动安装与人工验收流程

### 删除

- 移动端开发期根脚本
- 旧的 Gradle / React Native 脚本包装层
- 移动端调试文档和过时 README 内容

### 新增或更新的关键文件

- [package.json](../../../package.json)
- [scripts/workspace-task.mjs](../../../scripts/workspace-task.mjs)
- [apps/mobile/package.json](../../../apps/mobile/package.json)
- [apps/mobile/android/settings.gradle](../../../apps/mobile/android/settings.gradle)
- [apps/mobile/android/app/build.gradle](../../../apps/mobile/android/app/build.gradle)
- [apps/mobile/metro.config.cjs](../../../apps/mobile/metro.config.cjs)
- [apps/mobile/react-native.config.js](../../../apps/mobile/react-native.config.js)
- [server/contracts/tsconfig.json](../../../server/contracts/tsconfig.json)
- [apps/common/tsconfig.json](../../../apps/common/tsconfig.json)
- [.npmrc](../../../.npmrc)
- [docs/developer/build/构建 APK.md](./构建%20APK.md)

## 十三、后续建议

如果后续还要继续维护这条 release APK 链路，建议至少补三件事：

1. 把 `pnpm build:apk` 纳入 CI 或专门的 Windows 构建检查，避免路径漂移再次积累
2. 为正式发布补齐 release keystore 和签名注入方案
3. 如果未来要恢复 RN 开发期链路，建议新开独立任务，不要在当前 release-only 方案上直接追加临时脚本

## 总结

这次问题的根本不是“某个命令写错了”，而是三套默认假设长期漂移后叠在了一起：

- pnpm 的安装布局
- React Native Android 模板的目录假设
- monorepo 下多包构建的执行方式

当目标改成“只保留一条可交付的 release 构建链路”之后，真正的修复方向才清楚起来：

- 明确边界
- 删除伪能力
- 把隐式假设改成显式配置
- 让脚本、依赖布局和原生构建路径重新对齐

最终保留下来的不是一套“看起来很多”的移动端能力，而是一条确实跑通、可以复现、可以交付的 APK 构建路径。