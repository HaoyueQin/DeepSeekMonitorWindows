# DeepSeek / MiMo Monitor Windows

DeepSeek / MiMo Monitor Windows 是一个面向 Windows 的 DeepSeek & MiMo API 用量监控桌面应用，用于查看账户余额、当月消费、模型 Token 用量和最近用量趋势。

本项目基于 [JayHome137/deepseek-monitor](https://github.com/JayHome137/DeepSeekMonitor) 的开源项目思路做 Windows 系统适配，**感谢原作者 JayHome137 的开源工作**。原项目是 Python Web Dashboard，用于追踪 DeepSeek 平台多类公开变化，原项目当前仅支持mac版本。本项目开发目标是 Windows 桌面端监控工具，技术栈和使用方式已经按 Windows 平台重构实现。

郑重声明：本项目不是 DeepSeek 官方产品，也不是 MiMo 官方产品。

## About

DeepSeek / MiMo Monitor Windows: Windows desktop adaptation of felikschu/deepseek-monitor, built with Tauri, React and Rust for DeepSeek and MiMo balance and usage monitoring.

## 当前能力

- 查询 DeepSeek API 账户余额，使用 DeepSeek 官方余额接口。
- 查询 DeepSeek 平台用量数据，包括当月消费、模型 Token 总量、请求数、缓存命中、缓存未命中和输出 Token。
- 支持 V4 Flash 与 V4 Pro 两类模型用量展示。
- 支持最近 7 天消费趋势图，可按周翻页浏览历史数据。
- 支持模型详情页，按日 Token 消耗柱状图，同样支持周翻页。
- 支持 Windows 托盘入口，主窗口默认不进入任务栏。
- 支持 API Key 保存、清除和余额验证。
- 支持用量 Token 自动同步和手动粘贴兜底。
- **MiMo 平台完整支持**：通过顶部按钮在 DeepSeek 与 MiMo 之间切换。
  - MiMo 余额查询：通过 WebView2 + JavaScript Fetch 方式获取，支持 HttpOnly Cookie 登录态透传。
  - MiMo 用量明细：按模型（V2.5 / V2.5 Pro）和日期分解的用量数据，包括 Token 总量、缓存命中/未命中、输出 Token。
  - MiMo 每日趋势图：按日期聚合的用量数据，支持缓存命中明细展示。
  - MiMo 静默查询：WebView 默认隐藏，仅在需要登录时弹出窗口。
  - MiMo 401 自动跳转登录：检测到未登录时自动显示登录窗口。
- 液态玻璃质感 UI：基于 `backdrop-filter: blur()` 实现动态高斯模糊，叠加半透明渐变层模拟 Vibrance 效果，边缘内高光+半透明描边模拟玻璃厚度与折射，支持深色/浅色主题。
- UI 复用原 macOS 版本的视觉方向，并按 Windows Tauri 窗口做适配。

## 与原项目的关系

| 项目 | 原项目 deepseek-monitor | 本项目 DeepSeekMonitorWindows |
| --- | --- | --- |
| 目标平台 | macOS / Web Dashboard | Windows 桌面端 |
| 核心技术 | Python, Web Server, HTML Dashboard | Tauri 2, React 18, TypeScript, Rust |
| 主要用途 | 追踪 DeepSeek 网页端、Feature Flags、API 端点、法律文档、GitHub 等公开变化 | 查看 DeepSeek/MiMo API 余额、消费、Token 用量和趋势 |
| 启动方式 | Python 服务 + 浏览器访问 | Windows 桌面应用 |
| 本项目是否复用原事件追踪内容 | 不复用 | 不写入 README，不作为本项目能力声明 |

## 系统要求

- Windows 10 或 Windows 11。
- Microsoft Edge WebView2 Runtime。Windows 11 通常已内置，Windows 10 如缺失需单独安装。
- Node.js 18+ 和 npm。
- Rust 1.77.2+，建议使用 MSVC 工具链。
- Visual Studio Build Tools，需包含 Desktop development with C++ 相关组件。

## 安装与开发

```powershell
git clone <your-repo-url>
cd DeepSeekMonitorWindows
npm install
npm run tauri:dev
```

开发检查：

```powershell
npm run tauri:check
```

构建安装包：

```powershell
npm run build
```

Tauri 打包目标当前配置为 NSIS 安装包，产物位于 `src-tauri/target/release/bundle/nsis/`。

## 使用方式

打开应用后进入设置页，先配置 DeepSeek API Key。API Key 用于查询账户余额，来自 DeepSeek 开放平台的 API Keys 页面。

因为DeepSeek 官方未提供相应的API接口，因此用量统计需要网页登录 Token。这个 Token 与 API Key 不同，用于访问 DeepSeek 平台的用量接口。

方式一，网页登录自动同步：

- 点击 `方式一：网页登录自动同步`。
- 在弹出的 DeepSeek 登录窗口完成登录。
- 登录成功后，应用会从 WebView2 缓存中尝试提取平台用量 Token。
- 同步成功后会自动刷新本月消费和 Token 统计。

方式二，手动粘贴 token：

- 点击 `方式二：手动粘贴 token`。
- 按页面提示从浏览器控制台获取 `JSON.parse(localStorage.userToken).value`。
- 粘贴后保存，作为自动同步失败时的兜底方案。

**Token 可能过期。用量查询失败时，重新执行网页登录同步或手动粘贴即可。**

### MiMo 平台使用说明

主面板顶部可切换至 MiMo 平台。首次切换时会自动弹出小米账号登录窗口，登录成功后即可查看账户余额和用量数据。

MiMo 平台通过 WebView2 代理机制获取数据，利用 HttpOnly Cookie 实现登录态透传。用量明细通过 `api-platform_ph` 动态参数调用 detail API 获取，支持按模型（V2.5 / V2.5 Pro）和日期分解。

WebView 默认隐藏运行，仅在需要登录时弹出窗口。登录完成后窗口自动隐藏。

## 数据存储

应用配置默认存储在：

```text
%APPDATA%\DeepSeekMonitorWindows\config.json
```

其中包含 API Key 和用量 Token。**请不要提交该文件，也不要把截图、日志或配置文件中的密钥内容公开。**

WebView2 登录缓存通常位于：

```text
%LOCALAPPDATA%\com.deepseek.monitor.windows\EBWebView
```

该目录属于本机运行数据，不应提交到仓库。

## 项目结构

```text
DeepSeekMonitorWindows/
├── src/                         # React + TypeScript 前端
│   ├── main.tsx                 # App 入口、全局状态、路由
│   ├── types.ts                 # TypeScript 类型定义
│   ├── utils.ts                 # 工具函数（格式化、日期）
│   ├── i18n.ts                  # 中英双语国际化
│   ├── styles.css               # Windows 桌面 UI 样式
│   └── components/
│       ├── DashboardPanel.tsx   # 主面板（余额、用量、图表）
│       ├── SettingsPanel.tsx    # 设置面板（手风琴分类）
│       └── ModelDetailPanel.tsx # 模型详情页
├── src-tauri/                   # Tauri + Rust 后端
│   ├── src/
│   │   ├── lib.rs               # Tauri commands、窗口管理、回调服务器
│   │   └── modules/
│   │       ├── types.rs         # 共享数据结构
│   │       ├── config.rs        # DPAPI 加密配置、读写
│   │       ├── deepseek.rs      # DeepSeek API 调用
│   │       ├── mimo.rs          # MiMo API 调用（WebView 代理）
│   │       └── tray.rs          # 系统托盘与窗口定位
│   ├── tauri.conf.json          # Tauri 窗口、打包和安全配置
│   ├── Cargo.toml               # Rust 依赖与包信息
│   └── capabilities/            # Tauri 权限配置
├── public/assets/               # DeepSeek 图标与静态资源
├── scripts/                     # Windows 开发脚本
├── package.json                 # 前端依赖与脚本
└── README.md                    # 项目说明
```

## 不应提交的文件

仓库已通过 `.gitignore` 忽略以下内容：

- `node_modules/`
- `dist/`
- `src-tauri/target/`
- `.env`, `.env.local`, `.env.*.local`
- `.npmrc`
- `*.log`, `*.err.log`, `*.out.log`
- `test-output/`
- 根目录临时截图 `dashboard-mvp.png`, `settings-mvp.png`, `detail-mvp.png`
- WebView2 缓存和本地运行配置
- IDE 配置和系统临时文件

## 依赖

前端运行依赖：

- React 18
- React DOM 18
- Tauri JavaScript API 2
- lucide-react

前端开发依赖：

- Vite 5
- TypeScript 5
- Tauri CLI 2
- React 类型定义

Rust 后端依赖：

- tauri 2.11，启用 tray-icon
- tauri-plugin-log
- tauri-plugin-single-instance，单实例守卫，防止应用重复多开
- reqwest 0.12，启用 json
- serde
- serde_json
- log

## 更新日志

完整发布记录见 GitHub Releases。

### v2.5.4

- **新增窗口置顶**：设置→通用→窗口置顶开关，应用窗口保持在其他窗口之上。
- **新增按月份缓存**：用量数据按 `YYYY-MM` 独立缓存，首次启动加载过去 12 个月，后续自动刷新仅更新当月，历史数据不再重复请求。
- **新增缓存清理**：设置→数据→自动清理超过一年缓存的开关（默认开启），关闭后缓存持续累积可导出。
- **修复 MiMo API 超时**：回调服务器 CORS `Access-Control-Allow-Origin` 从 `null` 改为 `*`，解决 WebView2 中跨域请求被静默拦截。
- **修复 MiMo 锁竞争**：`fetch_mimo_usage_detail` 轮询期间释放全局锁，余额查询不再被 30 秒 detail 提取阻塞。
- **修复 MiMo 详情跨月查询**：POST body 传入 `{year,month}` 数字参数，MiMoDetailCache 加 `month_key` 避免跨月复用。
- **修复 MiMo 数据显示**：fallback 不再用全历史 token 伪造当月模型；主面板模型行只显示当月数据（与 DeepSeek 对齐）；`monthCost` 正确取当前月。
- **修复 MiMo 图标**：mimo-v2.5 使用闪电图标，mimo-v2.5-pro 使用大脑图标。
- **修复图表翻页**：周期翻页限制为 52 周，主页和详情页同步。
- **优化图表布局**：stats 移至左下，图例移至右下，周导航固定右上，不再因数据长度变化而跳动。
- **优化默认值**：自动清理过期缓存默认开启；窗口置顶默认关闭。
- **依赖与版本**：package-lock.json 同步更新至 v2.5.4。

### v2.5.3

- **稳定性修复**：DeepSeek 用量查询恢复为组件内 `invoke` 调用，修复 v2.5.0 中提取公用函数导致的生产环境数据加载失败。
- **安全加固**：回调服务器启动失败不再 panic，改为优雅降级；CSP 白名单新增 `open.er-api.com`，修复汇率 API 在生产环境被拦截。
- **代码清理**：去除 main.tsx 冗余 import 和 `MimoBalanceData` 重复导入。
- **文档更新**：README 中 i18n 相关描述同步更新为 zh/en 双语。

### v2.5.2

- **模型详情页增强**：标题下方新增该模型的平均命中率和平均单价；每日柱状图悬浮 tooltip 新增缓存命中率和平均单价。
- **主页面 tooltip 文案**：「单价」统一改为「平均单价」，与详情页一致。

### v2.5.1

- **修复更新日志无法加载**：生产环境 CSP `connect-src` 白名单缺少 `https://api.github.com`，已添加。

### v2.5.0

- **设置页UI增强**：字体透明度和玻璃透明度独立调优，设置页视觉效果更清晰。
- **更新日志**：设置页新增"查看更新日志"功能，通过 GitHub API 分页拉取全部版本记录，marked 渲染 Markdown，默认折叠按版本展开。
- **MiMo 颜色**：设置页 MiMo 区域标识色从绿色改为小米品牌橙色 `#FF6900`。
- **手风琴动画优化**：展开/折叠过渡从 0.3s 微调到 0.35s，更流畅自然。
- **下载进度条修复**：消除点击下载时进度条先跳到 30% 再回 0% 的视觉跳动。
- **图表增强**：缓存命中明细右上角新增效率指标（MT/¥ 或 ¥/MT）；悬浮 tooltip 增加每日命中率和单价显示。
- **Bug 修复**：自定义刷新间隔不再被静默重置为 60 秒；MimoDetailCache 空缓存状态修正；Mutex 双检锁优化、去中毒绕过；独立 poll server 改为复用主 CallbackServer，消除线程泄漏；`start_usage_title_watcher` 超时从 30 分钟缩短到 15 分钟。
- **代码质量**：i18n 精简为 zh/en 双语；消除重复动态 import；`modelIcon` 支持 MiMo 模型；`:not()` 选择器改为白名单；`.detail-bar-column` 三重定义合并。
- **错误处理**：关键 Tauri 命令失败时添加 `console.warn`；`url.parse().unwrap()` 替换为 `map_err`。

### v2.4.5

- **MiMo 切换稳定性**：修复从 DeepSeek 切换到 MiMo 时窗口消失的偶发崩溃（去除重复 loadBalance/loadUsage 调用、ensure_mimo_webview_sync 添加 Mutex 防竞态、阻塞 sleep 改为异步）。
- **设置页标题**：设置页左上角改为静态文本 `DeepSeek / MiMo Monitor`，主页面保留原有的点击切换功能。

### v2.4.4

- **检查更新修复**：检查更新失败时显示具体错误信息，不再误导性地显示"已是最新版本"。
- **latest.json 文件名修复**：上传到 GitHub Release 的文件名从 `latest-vX.Y.Z.json` 修正为 `latest.json`，确保 updater 端点 `/releases/latest/download/latest.json` 能正确访问。

### v2.4.3

- **安全加固**：f64→u64 溢出防护、unsafe 块 SAFETY 注释、敏感数据日志降级为 debug!、解析失败添加 warn! 日志。
- **代码质量**：UA 字符串提取为 `USER_AGENT` 常量、魔术数字提取为命名常量、`fetchWithCache` 工具函数消除重复缓存逻辑、`mimoDefaultModels` 提取为模块级常量。
- **输入验证**：`lowBalanceThreshold` 服务端添加 `is_finite()` + `>= 0` 校验。
- **编译缓存清理**：删除 8.5GB target 目录，仅保留 release 产物。

### v2.4.2

- **设置 UI 统一**：所有分段按钮改为内联样式按钮组或下拉框，移除死代码 `.segmented` CSS。
- **下拉框自定义输入**：刷新间隔和通知冷却支持"自定义"选项，选择后出现输入框。
- **Bug 修复**：`export_config_json`/`import_config_json` 未注册到 invoke_handler、CSS `var(--text)` 未定义、默认汇率 7.25→0.137、通知冷却预设增加 30 分钟、自定义状态从配置初始化。
- **死代码清理**：移除 main.tsx/SettingsPanel 中未使用的 imports 和变量。

### v2.4.1

- **汇率修复**：修正汇率计算方向（`n * rate` 而非 `n / rate`），更新缓存 key 丢弃旧反向值，修正 sanity check。
- **手风琴动画优化**：从 `max-height` 改为 CSS Grid `grid-template-rows`，过渡更流畅。

### v2.4.0

- **设置页面重构**：从平铺式改为手风琴展开式分类导航（账户、通用、显示、通知、关于）。
- **货币单位设置**：支持人民币(¥) / 美元($) 切换，实时汇率转换（`open.er-api.com`，24h 缓存）。
- **效率指标**：统一使用 MT 单位（MT/¥ 或 ¥/MT，美元时自动切换为 MT/$ 或 $/MT）。
- **主题设置**：浅色 / 深色 / 跟随系统，实时切换，支持系统偏好监听。
- **新 Rust 命令**：`save_currency`、`save_efficiency_unit`、`save_theme`。
- **货币 prop 贯穿全链路**：main.tsx → DashboardPanel → BalanceCard/UsageRow，ModelDetailPanel。

### v2.3.4

- **安全加固**：修复 `method` 参数 JS 注入、poll server CORS `*` → `null`、`mimo_ph` DPAPI 加密。
- **代码质量**：删除孤立 `config_tests.rs`、修复 `Cargo.toml` 版本号、修复未使用变量警告。

### v2.3.3

- **安全加固**：`loginUrl` 和 `ph` JS 注入修复（`serde_json::to_string`）、`login-sync` WebView `on_navigation` 守卫、DPAPI `encrypt_credential` 返回 `Result`。

### v2.3.0

- **i18n 国际化**：支持 17 种语言。v2.5.0 起精简为 zh/en 双语，其余语言已移除。
- **Windows 余额通知**：余额低于阈值时弹出 Windows toast 通知（默认关闭，可设置阈值）。
- **Tauri 自动更新**：集成 `tauri-plugin-updater`，支持签名验证的自动更新。
- **窗口状态记忆**：保存窗口大小和位置，下次启动自动恢复。
- **Rust 单元测试**：9 个测试覆盖配置模块。
- **代码拆分**：SettingsPanel 和 ModelDetailPanel 提取为独立组件。
- **MiMo 查询稳定性**：修复 `api-platform_ph` 缓存过期不被清除的问题，401 重试限制（最多 2 次），`initialization_script` 替代 `on_page_load`。

### v2.2.1

- **MiMo 查询性能优化**：`initialization_script` 替代 `on_page_load`，hook 在 SPA 脚本运行前注入，detail API 请求被即时拦截，查询速度大幅提升。
- **默认主题改为浅色**：首次安装启动即为浅色蓝色主题，不再显示深色棕色主题。
- **窗口首次定位**：应用首次启动时自动定位到屏幕右下角，不再出现在左上角。
- **免责声明更新**：补充 MiMo 平台相关风险说明。

### v2.2.0

- **Rust 后端模块化重构**：`lib.rs`（1894 行）拆分为 6 个模块：`types.rs`、`config.rs`、`deepseek.rs`、`mimo.rs`、`tray.rs`，遵循高内聚低耦合原则。
- **DPAPI 凭据加密**：API Key、Usage Token 使用 Windows DPAPI 加密存储（`enc1:` 前缀），向后兼容明文。
- **持久化回调服务器**：tiny_http 回调服务器启动时创建一次，所有 API 调用复用同一端口，消除每次调用的线程创建开销。
- **窗口可拉伸 + 预设**：支持拖拽窗口边缘自由调整大小（min 340×500，max 700×1200），设置中提供 4 个预设尺寸（紧凑/标准/宽屏/大屏），锚定右下角。
- **安全加固**：CSP 强制执行、`withGlobalTauri: false`、注入脚本域名白名单、MiMo 窗口导航白名单、输入长度验证。
- **离线数据缓存**：余额和用量数据自动缓存到 localStorage，API 失败时自动加载缓存数据。
- **前端模块化**：拆分 `types.ts`、`utils.ts`、`DashboardPanel.tsx`；配置 Vitest 单元测试框架（16 个测试）。
- **UI 改进**：默认主题改为浅色、刷新按钮添加 hover/active 反馈、紧凑预设高度优化、MiMo 平台设置界面适配。
- **窗口大小修复**：CSS 面板改用 100% 填充窗口，`resize_window` 使用纯物理像素避免 DPI 问题。
- **Detail API 修复**：从 GET 改为 POST（MiMo API 要求）。
- **MiMo 查询稳定性**：`initialization_script` 替代 `on_page_load`、ph 缓存过期自动清除、401 重试限制、并发防护。

### v2.1.1

- **MiMo 查询稳定性修复**：修复 `api-platform_ph` 缓存过期后不被清除导致 detail API 持续 401 的问题。fast-path 失败时自动清除旧 ph，让 `initialization_script` hook 重新捕获。
- **401 重试限制**：detail 提取遇到 401 时最多显示 2 次登录窗口，之后静默降级到概览数据，避免反复弹窗。
- **Provider 切换修复**：修复从 MiMo 切换到 DeepSeek（或反向）时卡在"查询中"的问题。`setProvider` 现在直接触发数据加载。
- **轮询超时优化**：detail 提取轮询从 120 秒缩短到 30 秒，减少无效等待。

### v2.1.0

- **MiMo 查询速度优化**：使用 `initialization_script` 替代 `on_page_load`，hook 在 SPA 脚本运行前注入，detail API 请求被即时拦截，查询速度大幅提升。
- **DPAPI 凭据加密**：API Key、Usage Token 等敏感凭据使用 Windows DPAPI 加密存储（`enc1:` 前缀），向后兼容明文。
- **持久化回调服务器**：tiny_http 回调服务器启动时创建一次，所有 API 调用复用同一端口，消除每次调用的线程创建开销。
- **窗口可拉伸**：支持拖拽窗口边缘自由调整大小（min 340×500，max 700×1200），设置中提供 4 个预设尺寸。
- **窗口大小锚定**：调整窗口大小时保持右下角位置固定。
- **离线数据缓存**：余额和用量数据自动缓存到 localStorage，API 失败时自动加载缓存数据。
- **安全加固**：CSP 强制执行、`withGlobalTauri: false`、注入脚本域名白名单、MiMo 窗口导航白名单、输入长度验证。
- **代码架构改进**：拆分 types.ts、utils.ts、DashboardPanel.tsx 模块；配置 Vitest 单元测试框架（16 个测试）。
- **MiMo 查询稳定性**：修复 CallbackServer 状态注册导致的 panic、detail API 401 循环弹窗等问题。

### v2.0.0

- **MiMo 平台完整支持**：MiMo 从 Beta 升级为正式支持，用量明细、每日趋势图、缓存命中明细全部打通。
- **MiMo 静默查询**：WebView 默认隐藏运行，仅在需要登录时弹出窗口，不再强制保持窗口打开。
- **MiMo 用量明细**：通过 `on_page_load` hook 自动拦截 SPA 的 detail API 请求，提取 `api-platform_ph` 参数并缓存。支持按模型（V2.5 / V2.5 Pro）和日期分解的完整用量数据。
- **MiMo 缓存命中明细**：图表展示每日缓存命中/未命中/输出 Token 分布，与 DeepSeek 统一显示规则。
- **7 天窗口 + 周导航**：缓存命中明细和按日 Token 消耗图表默认显示最近 7 天，支持左右翻页浏览历史周数据，无数据天以 0 填充。
- **悬停区域优化**：柱状图整列可悬停，解决矮柱子难以触发提示的问题。
- **设置界面适配**：API Key、开机自启、自动刷新等设置项根据当前平台动态显示文案。MiMo 模式下隐藏 DeepSeek 专属的 API Key 和用量 Token 配置。
- **并发防护**：detail 提取添加 `in_progress` 标记，防止多个提取同时运行导致的 cascade。
- **Detail API 修复**：从 GET 改为 POST 方法（MiMo API 要求）。
- **版本号升级**：v1.2.0 → v2.0.0。

### v1.2.0

> **开发中版本，MiMo 用量明细功能尚未完成。**

- **MiMo 平台支持（Beta）**：新增 MiMo 平台切换能力，通过顶部按钮在 DeepSeek 与 MiMo 之间切换。
- **MiMo 余额查询**：通过 WebView2 内嵌 HTTP 服务器 + JavaScript Fetch 方式获取 MiMo API 数据，支持 HttpOnly Cookie 登录态透传。
- **MiMo 用量明细（开发中）**：后端已实现 `/api/v1/usage/detail/list` 接口调用，支持按模型（V2.5 / V2.5 Pro）和日期分解的用量数据。自动提取 `api-platform_ph` 参数的逻辑尚不稳定，首次使用需手动触发页面加载。
- **MiMo 模型展示**：主面板始终显示 V2.5 和 V2.5 Pro 两行模型占位，无论是否有数据。
- **MiMo 每日趋势图**：后端已实现按日期聚合的用量数据，前端趋势图已对接，待 `api-platform_ph` 提取打通后可正常显示。
- **MiMo 401 自动跳转登录**：检测到 MiMo API 返回 401 时，自动跳转小米账号登录页面。
- **MiMo 配置缓存**：`api-platform_ph` 参数缓存至本地配置文件，避免重复提取。
- **Provider 持久化**：当前选择的平台（DeepSeek/MiMo）存入配置文件，重启自动恢复。
- **串行化 WebView 访问**：解决并发导航竞争导致的接口请求失败。
- **Rust 依赖新增**：`tiny_http` 0.12 用于本地 HTTP 回调；`tokio::sync::Mutex` 用于 WebView 访问串行化。
- **已知问题**：`api-platform_ph` 动态参数的自动提取逻辑不稳定，可能导致用量明细无法显示；401 登录跳转在某些场景下不生效。
- **液态玻璃 UI 增强**：Provider 切换按钮适配两种平台名称显示。

### v1.1.1

- **液态玻璃 UI**：全面升级为 `backdrop-filter: blur(42px)` 动态高斯模糊质感，叠加半透明渐变层实现 Vibrance 色彩浸透效果，边缘内高光+多层阴影模拟玻璃厚度与折射。支持深色/浅色主题统一变量体系。
- **界面尺寸调整**：主面板加宽 30%（356px→463px）、加高 10%（600px→660px），设置页同步缩放，提供更充裕的展示空间。
- **Token 显示修复**：解决用量行 Token 文本因空间不足被截断的问题，左侧展示区增加约 5 字符宽度。
- **价格单位变更**：右侧 `T/¥` 改为 `¥/MT`（元/百万 Token），保留三位小数，精度更高且符合行业惯例。
- **缓存命中精度**：模型用量行与趋势图的缓存命中率统一精确到小数点后三位。
- **窗口尺寸同步**：Tauri 窗口 `tauri.conf.json` 同步调整至 463×660。

### v1.1.0

- 支持缓存命中、缓存未命中与输出 Token 的明细显示。
- 增加亮色 UI 皮肤，支持在主面板一键切换并记住用户选择。
- 设置页增加当前版本号显示。
- 当前 GitHub Release `v1.1.0` 已标记为 Latest，安装包为 `DeepSeekMonitorWindows_1.1.0_x64-setup.exe`。
- 安装包 SHA256：`B13EF28BB7E803D923E1A00BCE4A873B4EB7F2F592AFF690173C2E9291F1D13F`。
- 历史 Release `v1.0.1` 和旧安装包继续保留，便于回退和版本追溯。

### v1.0.1

- 修复应用单实例缺失导致的重复多开问题，感谢抖音粉丝群烛阴兄弟提出的bug。此前在程序已运行的情况下再次点击图标或 exe，会不断启动新的进程；现在再次启动时不再新开窗口，而是将已有主面板唤到前台。通过接入 `tauri-plugin-single-instance` 单实例守卫实现。

### v1.0.0

- 首个正式发布版本，提供 DeepSeek API 余额查询、平台用量统计、消费趋势、Windows 托盘入口、API Key 与用量 Token 管理等能力。

## 许可证

本项目使用 MIT License，与原项目 README 中声明的许可证保持一致。详见 [LICENSE](LICENSE)。

## 免责声明

本项目仅用于学习和研究目的。请遵守 DeepSeek 和 MiMo 的使用条款，合理使用相关接口，避免频繁请求。

DeepSeek 和 MiMo 平台页面结构、登录状态、WebView2 缓存和内部用量接口都可能变化，本项目不保证长期可用。**API Key、用量 Token 和小米账号凭据属于敏感凭据，使用者需自行承担本机存储、账号安全、网络请求和数据展示带来的风险。**
