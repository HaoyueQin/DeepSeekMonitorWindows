# DeepSeekMonitorWindows — 交接文档

> 更新日期：2026-07-15
> 当前版本：v2.6.0
> 远端仓库：https://github.com/HaoyueQin/DeepSeekMonitorWindows.git
> 上游仓库：https://github.com/Joyi-code/DeepSeekMonitorWindows.git

---

## 一、项目概况

### 定位
基于 Tauri 2 + React 18 + TypeScript + Rust 的 Windows 桌面应用，监控 **DeepSeek** 和 **MiMo（小米）** 两个平台的 API 余额、用量、趋势。

### 技术栈
| 层 | 技术 |
|----|------|
| 前端 | React 18, Vite 5, TypeScript 5, lucide-react, marked |
| 后端 | Rust, tauri 2.11, reqwest 0.12, serde, tiny_http, tokio |
| 安全 | Windows DPAPI 凭据加密, CSP 策略, WebView 导航白名单 |
| 打包 | NSIS 安装包, tauri-plugin-updater（自动更新） |
| 签名 | Tauri updater 密钥对，私钥位于 `~/.tauri/deepseek-monitor.key` |

### 代码规模
| 模块 | 约行数 |
|------|--------|
| 前端入口 main.tsx | ~370 |
| DashboardPanel.tsx | ~310 |
| SettingsPanel.tsx | ~720 |
| ModelDetailPanel.tsx | ~180 |
| styles.css | ~1,400 |
| i18n.ts | ~160 |
| utils.ts + types.ts | ~180 |
| 后端 lib.rs | ~580 |
| 后端 config.rs | ~430 |
| 后端 deepseek.rs | ~620 |
| 后端 mimo.rs | ~840 |
| 后端 types.rs | ~280 |
| 后端 tray.rs | ~85 |

---

## 二、架构概览

### 前端组件树
```
App (main.tsx)
├── DashboardPanel
│   ├── BalanceCard       — 余额 + 当日消耗 + 本月消费
│   ├── UsageRow          — 模型用量行（点击进详情）
│   └── UsageChart        — 7天缓存命中柱状图 + 周翻页
├── SettingsPanel         — 6 分类手风琴：账户/通用/显示/通知/数据/关于
└── ModelDetailPanel      — 单模型按日 Token 消耗
```

### 后端模块
```
lib.rs          — Tauri 命令注册 + 回调服务器 + 启动逻辑
config.rs       — 配置读写 + DPAPI 加密 + 开机自启注册表
deepseek.rs     — DeepSeek 余额 API (reqwest) + 用量 API (reqwest) + Token 同步 (WebView)
mimo.rs         — MiMo 余额 (WebView JS) + 用量概览 + 详情提取 (WebView 代理+轮询)
tray.rs         — 系统托盘 + 窗口定位
types.rs        — 共享数据结构 + MimoDetailCache
```

### 数据流
```
DeepSeek: 前端 invoke → Rust reqwest → api.deepseek.com / platform.deepseek.com → 返回
MiMo:     前端 invoke → Rust → ensure_mimo_webview → JS eval fetch → 
          platform.xiaomimimo.com → 回调 → 127.0.0.1:{port}/mimo-callback → oneshot → 返回
```

---

## 三、MiMo 机制详解（重要）

### 3.1 WebView 代理
MiMo 没有公开 API Key，使用**隐藏 WebView2** 窗口（`mimo-sync`）登录小米账号后，通过 JS `eval()` 注入 fetch 请求调用 MiMo API，利用 WebView 的 HttpOnly Cookie 实现认证。

### 3.2 回调服务器
`CallbackServer`（tiny_http）在 `127.0.0.1` 随机端口监听。WebView 中 JS fetch 的结果通过 POST 到 `/mimo-callback` 回传 Rust。CORS 设置为 `Access-Control-Allow-Origin: *`。

### 3.3 余额查询
- 路径：`GET /api/v1/balance`
- V1 解析返回 `cash_balance`（余额）、`currency`
- V1 失败时降级 AccountOverview（不常触发）

### 3.4 用量查询（概览）
- 路径：`GET /api/v1/usage`
- 返回 `token_usage`（总 token 量）和 `cost_usage.current_month_cost`（当月消耗）
- ⚠️ `current_month_cost` 永远是当前月，不受 month/year 参数影响

### 3.5 用量详情（关键）
- 路径：`POST /api/v1/usage/detail/list?api-platform_ph={ph}`
- 需要 body：`{"year":2026,"month":6}`（Integer 类型）
- ph 从 WebView 页面拦截获取，缓存在 `config.mimo_ph`
- 详情提取分两步：
  1. **快速路径**：用缓存 ph 直接 POST API（带 body）。成功则毫秒级返回
  2. **页面提取**：导航到 `usage?month=YYYY-MM` 页面，拦截页面自己的 API 调用，30s 轮询

### 3.6 MimoDetailCache
- 结构：`items: Option<(Instant, Vec<UsageDetailItem>)>, month_key: Option<String>, in_progress: bool`
- 5 分钟 TTL，按 `month_key` 隔离不同月份
- `in_progress` 标记防止并发提取

### 3.7 全局锁
`tokio::sync::Mutex<()>` 序列化所有 MiMo API 调用，确保同一时间只有一个请求使用 WebView。初始化导航后锁释放，轮询中仅在 `eval` 时刻短暂持锁。

---

## 四、DeepSeek 机制

### 4.1 余额
`GET https://api.deepseek.com/user/balance`，Bearer Token 认证

### 4.2 用量
- Amount：`GET https://platform.deepseek.com/api/v0/usage/amount?month=X&year=Y`
- Cost：`GET https://platform.deepseek.com/api/v0/usage/cost?month=X&year=Y`
- 都是直接 HTTP 调用，快速可靠

---

## 五、前端缓存架构（v2.5.5 设计，v2.6.0 支持可配置历史深度）

### 5.1 存储格式
每月独立缓存：`dsm-usage-{provider}-{YYYY-MM}`（如 `dsm-usage-mimo-2026-06`）

### 5.2 加载策略
1. **首次 loadUsage**：检查过去 N 个月缓存（N = 历史数据深度，设置→数据可配 12/24/36，默认 12），补齐缺失，合并所有月份
2. **auto-refresh**：只刷新余额 + 当月用量（不重拉历史）
3. **reloadCache**：忽略缓存，重取 N 个月，JSON 比对后覆盖（历史深度变更后自动触发）
4. **fetchingRef**：防重集合，每次 loadUsage 重置，失败后移除标记

### 5.3 合并逻辑
- `mergeDS(months)` / `mergeMimo(months)`：合并 days（所有月份），models 和 monthCost 取当前月
- 当前月 = `months[0]` = `yearMonths(historyMonths)` 第一个元素

### 5.4 缓存清理
- 设置→数据→「自动清理过期缓存」开关，默认开启
- 开启时每次启动删除超过历史深度（默认 12 个月）的缓存 key
- 关闭时缓存持续累积（可导出），但主页面仅加载近 N 个月

---

## 六、当前已知问题

### 6.1 MiMo 首次启动 TIMEOUT
- 应用启动后第一次 MiMo 余额查询可能超时（WebView 尚未登录）
- 30 秒后重试通常恢复
- 可考虑：启动时静默预热 WebView

### 6.2 构建签名
- Release 构建需要 `TAURI_SIGNING_PRIVATE_KEY` 环境变量
- 私钥路径：`~/.tauri/deepseek-monitor.key`
- 构建命令：`TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/deepseek-monitor.key) TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" npx tauri build`

---

## 七、未来工作（v2.6.0 已全部完成 ✅）

### 7.1 功能增强（已全部完成）
- [x] MiMo 支持更早历史月份 → 设置→数据「历史数据深度」（12/24/36 个月，config.usage_history_months）
- [x] 用量数据导出支持日期范围筛选 → 设置→数据 导出区「日期范围」起止月份，CSV 按日期行展开
- [x] ~~图表支持柱状图/折线图切换~~ → **不做**（2026-08-06 用户确认不在需求内，已移除）
- [x] ~~余额走势图~~ → **不做**（2026-08-06 用户确认不在需求内，已移除）
- [x] ~~多账户切换~~ → **不做**（2026-08-06 用户确认不在需求内，已移除）

### 7.3 技术债务（已全部完成）
- [x] `mergeDS` / `mergeMimo` 清理 → grep 确认 modelMap 无残留（已自然完成）
- [x] `fetch_mimo_api_with_method` 和 `_and_body` 冗余 → 合并为单一 `fetch_mimo_api(app, path, method, timeout, body)`，fast-path 复用统一调用，删除 ~60 行重复 JS 构造
- [x] 错误处理统一化 → 新增 `AppError`（thiserror：NoApiKey/Network/Http/Parse/Auth/Timeout/Config/Io/Crypto/Other），`From<AppError> for String` 保持命令层兼容
- [x] 前端状态管理引入 useReducer → main.tsx 的 balance/usage 6 个状态收敛为 dataReducer（BALANCE_*/USAGE_*/RESET）
- [x] 国际化覆盖所有硬编码中文 → DashboardPanel/ModelDetailPanel/SettingsPanel/main.tsx 全部静态文本走 t()/tpl()

### 7.4 质量保障（已全部完成）
- [x] Rust 后端单元测试 → 35 个（config 迁移/历史/凭据、deepseek token_breakdown/cost_sum/extract_token、mimo parse_detail_items/parse_mimo_api_response/聚合过滤）
- [x] 前端组件测试 → Vitest 26 个（utils 16 + DashboardPanel 5 + ModelDetailPanel 2 + App 集成 3，vi.hoisted mock Tauri IPC）
- [x] E2E 测试 → jsdom 集成测试覆盖「启动→加载配置→余额→用量→渲染 UI」完整流程（App.test.tsx）；真实 Tauri E2E 保留 HANDOVER 十一节人工检查清单（需登录凭据，不适合 CI）

### CI（v2.6.0 新增）
- [x] `.github/workflows/ci.yml`：frontend（npm ci → tsc → vitest → vite build）+ backend（cargo check → clippy -D warnings → cargo test）+ verify_mimo_perf.cjs

---

## 八、构建与发布

### 开发模式
```powershell
npm run tauri:dev
# 或直接：npx tauri dev
# 需要 cargo 在 PATH 中
```

### 签名构建
```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content ~/.tauri/deepseek-monitor.key -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npx tauri build
# 产物：src-tauri/target/release/bundle/nsis/DeepSeekMonitorWindows_{version}_x64-setup.exe
# 签名：同目录 .sig 文件
```

### 发布流程
1. `cargo check && npx tsc --noEmit` 验证编译
2. 更新 `package.json` / `tauri.conf.json` / `Cargo.toml` 版本号
3. 更新 `README.md` 更新日志
4. `git commit` + `git push`
5. `npx tauri build`（带签名）
6. `gh release create v{version}` 上传 exe + sig + latest.json
7. latest.json 中的 signature 来自 `.sig` 文件内容

### 自动更新
- Tauri updater 指向 `https://github.com/HaoyueQin/DeepSeekMonitorWindows/releases/latest/download/latest.json`
- 旧版本客户端通过公钥验证 `.sig` 签名后自动下载安装

---

## 九、环境信息

- 开发机器：16GB RAM + 6GB VRAM，Windows 笔记本
- Rust：`C:\Users\DF4B-9326.LAPTOP-KHNMRDVI\.cargo\bin\cargo.exe`
- Node：系统全局安装
- Tauri 签名密钥：`C:\Users\DF4B-9326.LAPTOP-KHNMRDVI\.tauri\deepseek-monitor.key`（348 字节）
- 上游 remote：`upstream` → https://github.com/Joyi-code/DeepSeekMonitorWindows.git
- 本地上次 fetch 上游：2026-06-30 前后

---

## 十、与上游项目的关系

| 项目 | 上游 Joyi-code | 本 Fork HaoyueQin |
|------|---------------|-------------------|
| 支持平台 | 仅 DeepSeek | DeepSeek + MiMo |
| MiMo 实现 | 无 | 完整（WebView 代理方案） |
| 前端缓存 | 无（每次请求 2 个月） | 按月份缓存，历史深度可配（默认 12 个月） |
| 设置功能 | 基础 | 窗口置顶/缓存管理/主题/货币/效率单位/通知冷却 |
| 国际化 | 无 | zh/en 双语 |
| 自动更新 | 无 | Tauri updater + GitHub Releases |
| 版本号 | v2.5.3 | v2.6.0 |
| 关系 | — | 独立开发，不定期同步上游 |

**注意**：本 Fork 已大幅偏离上游，合并上游变更时需要仔细处理冲突。

---

## 十一、快速上手检查清单

新会话开始后，按此顺序恢复工作：

1. `git status` — 确认在 master，无未提交变更
2. `git log --oneline -5` — 确认最新 commit
3. `npm run tauri:dev` — 启动应用验证功能
4. 检查 MiMo 余额是否正常（可能需要登录）
5. 检查 MiMo 6 月用量是否有数据（如无，点重新加载缓存）
6. 检查 DeepSeek 余额 + 用量是否正常
7. 查看 `bash_output` 日志确认 MiMo API 无 TIMEOUT
