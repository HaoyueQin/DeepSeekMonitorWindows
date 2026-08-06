//! MiMo API 模块
//!
//! 职责：WebView 代理、余额查询、用量查询、detail 提取、ph 管理。
//! 架构：通过 WebView2 的 JS eval 执行 fetch 调用，利用 HttpOnly Cookie 实现认证。

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use serde::Deserialize;
use tokio::sync::oneshot;

const POLL_TIMEOUT_SECS: u64 = 30;
const LOG_TRUNCATE_LEN: usize = 500;
use tauri::{Emitter, Manager};

use crate::modules::types::{
    AppError, CallbackServerPort, MimoBalanceResult, MimoUsageDay, MimoUsageDayModel,
    MimoUsageModel, MimoUsageResult, UsageDetailItem,
};
use crate::modules::config::{read_stored_config, write_stored_config};

// ─── MiMo SPA 拦截脚本 ──────────────────────────────────

/// 在页面脚本运行前注入，捕获 api-platform_ph 和 detail 响应
pub const MIMO_INTERCEPT_JS: &str = r#"
    (function() {
        if (window.__mimo_hooked) return;
        window.__mimo_hooked = true;
        window.__mimo_ph = null;
        window.__mimo_detail = null;
        var ALLOWED = ['platform.xiaomimimo.com'];
        function isAllowed(u) { try { return ALLOWED.indexOf(new URL(u, location.href).hostname) !== -1; } catch(e) { return false; } }
        // 主动扫描 ph
        function __extractPh() {
            if (window.__mimo_ph) return window.__mimo_ph;
            try { var v = localStorage.getItem('mimo_platform_ph'); if (v) { window.__mimo_ph = v; return v; } } catch(e) {}
            try { var c = document.cookie.match(/(?:api-platform_ph|platform_ph)=([^;]+)/); if (c) { window.__mimo_ph = decodeURIComponent(c[1]); return window.__mimo_ph; } } catch(e) {}
            try { var h = document.documentElement ? (document.documentElement.innerHTML || '') : ''; var m = h.match(/api-platform_ph[=:]["']?([^'"&\s,}]+)/); if (m) { window.__mimo_ph = decodeURIComponent(m[1]); return window.__mimo_ph; } } catch(e) {}
            return null;
        }
        __extractPh();
        // Hook fetch
        var __of = window.fetch;
        window.fetch = function() {
            var u = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url ? arguments[0].url : '');
            if (isAllowed(u) && u.indexOf('api-platform_ph=') !== -1) {
                var m = u.match(/api-platform_ph=([^&]+)/);
                if (m) { window.__mimo_ph = decodeURIComponent(m[1]); try { localStorage.setItem('mimo_platform_ph', window.__mimo_ph); } catch(e) {} }
                if (u.indexOf('/usage/detail/list') !== -1) {
                    return __of.apply(this, arguments).then(function(r) { return r.clone().text().then(function(t) { window.__mimo_detail = t; return r; }).catch(function() { return r; }); });
                }
            }
            return __of.apply(this, arguments);
        };
        // Hook XMLHttpRequest
        var __oo = XMLHttpRequest.prototype.open;
        var __os = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(m, u) { this.__mu = u; return __oo.apply(this, arguments); };
        XMLHttpRequest.prototype.send = function() {
            var u = this.__mu || '';
            if (isAllowed(u) && u.indexOf('api-platform_ph=') !== -1) {
                var m = u.match(/api-platform_ph=([^&]+)/);
                if (m) { window.__mimo_ph = decodeURIComponent(m[1]); try { localStorage.setItem('mimo_platform_ph', window.__mimo_ph); } catch(e) {} }
                if (u.indexOf('/usage/detail/list') !== -1) this.addEventListener('load', function() { window.__mimo_detail = this.responseText; });
            }
            return __os.apply(this, arguments);
        };
        // 定期扫描 ph
        setInterval(function() { if (!window.__mimo_ph) __extractPh(); }, 1000);
    })();
"#;

// ─── WebView 管理 ────────────────────────────────────────

use std::sync::Mutex as StdMutex;
static MIMO_WEBVIEW_LOCK: StdMutex<()> = StdMutex::new(());

pub fn ensure_mimo_webview_sync(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, AppError> {
    // 快速路径：窗口已存在，无需持锁
    if let Some(window) = app.get_webview_window("mimo-sync") {
        return Ok(window);
    }
    // 仅在创建窗口时持锁
    let _guard = MIMO_WEBVIEW_LOCK.lock().unwrap();
    // 双重检查：等锁期间可能已被另一线程创建
    if let Some(window) = app.get_webview_window("mimo-sync") {
        return Ok(window);
    }
    let url = tauri::WebviewUrl::External(
        "https://platform.xiaomimimo.com/console/balance"
            .parse()
            .map_err(|_| AppError::Other("无效 URL".to_string()))?,
    );
    tauri::WebviewWindowBuilder::new(app, "mimo-sync", url)
        .title("小米 MiMo 控制台")
        .inner_size(480.0, 720.0)
        .min_inner_size(360.0, 480.0)
        .resizable(true)
        .center()
        .visible(false)
        .on_navigation(|url| {
            url.host_str().is_some_and(|host| {
                host == "platform.xiaomimimo.com"
                    || host == "account.xiaomi.com"
                    || host == "xiaomimimo.com"
            })
        })
        .initialization_script(MIMO_INTERCEPT_JS)
        .build()
        .map_err(|error| AppError::Other(format!("打开 MiMo 页面失败：{error}")))
}

// ─── 通用 API 调用 ──────────────────────────────────────

/// 在 MiMo WebView 中执行一次 fetch，结果经 127.0.0.1 回调服务器回传。
///
/// `method` 取值 "GET"/"POST"，`body` 为已序列化的 JSON 字符串（POST 时使用）。
/// 仅在 eval JS 的瞬间持有全局锁，等待回调时不持锁，允许多个请求并发 pending。
pub async fn fetch_mimo_api(
    app: &tauri::AppHandle,
    path: &str,
    method: &str,
    timeout_secs: u64,
    body: Option<&str>,
) -> Result<String, AppError> {
    let lock_guard = app.state::<Arc<tokio::sync::Mutex<()>>>();

    let window = ensure_mimo_webview_sync(app)?;
    log::info!("[MiMo] fetch_api webview ready, path={} method={}", path, method);

    let cb_port = app
        .state::<Mutex<CallbackServerPort>>()
        .lock()
        .unwrap()
        .0;

    let req_id = format!(
        "__mimo_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );

    let (tx, rx) = oneshot::channel();
    {
        let state = app.state::<Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>>();
        let mut map = state.lock().unwrap();
        map.insert(req_id.clone(), tx);
    }

    let api_url = format!("https://platform.xiaomimimo.com{}", path);
    // Use serde_json::to_string for proper JS string escaping of the URL
    let safe_url = serde_json::to_string(&api_url).unwrap_or_else(|_| "\"\"".to_string());
    let safe_req_id = serde_json::to_string(&req_id).unwrap_or_else(|_| "\"\"".to_string());
    let safe_method = serde_json::to_string(method).unwrap_or_else(|_| "\"GET\"".to_string());
    let safe_body = body
        .map(|b| serde_json::to_string(b).unwrap_or_else(|_| "\"\"".to_string()))
        .unwrap_or_else(|| "null".to_string());
    let js = format!(
        r#"(async function() {{
                try {{
                    var r = await fetch({safe_url}, {{
                        method: {safe_method},
                        credentials: 'include',
                        headers: {{ 'Accept': 'application/json', 'Content-Type': 'application/json' }},
                        body: {safe_body}
                    }});
                    var t = await r.text();
                    fetch('http://127.0.0.1:{port}/mimo-callback', {{
                        method: 'POST',
                        mode: 'cors',
                        headers: {{ 'Content-Type': 'application/json' }},
                        body: JSON.stringify({{ reqId: {safe_req_id}, data: t }})
                    }});
                }} catch(e) {{
                    fetch('http://127.0.0.1:{port}/mimo-callback', {{
                        method: 'POST',
                        mode: 'cors',
                        headers: {{ 'Content-Type': 'application/json' }},
                        body: JSON.stringify({{ reqId: {safe_req_id}, data: 'ERROR:' + e.message }})
                    }});
                }}
            }})()"#,
        port = cb_port,
    );
    // 仅在 eval JS 的瞬间持锁，注入后立即释放，允许并发 fetch
    {
        let _lock = lock_guard.lock().await;
        window
            .eval(&js)
            .map_err(|e| AppError::Other(format!("注入脚本失败：{e}")))?;
    }
    log::info!("[MiMo] fetch_api JS injected ({} chars), waiting for callback on port {} req={}", js.len(), cb_port, &req_id[..req_id.len().min(20)]);

    let timeout = std::time::Duration::from_secs(timeout_secs);
    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(data)) => {
            if data.starts_with("ERROR:") {
                return Err(AppError::Other(format!(
                    "MiMo API 请求失败：{}",
                    data.strip_prefix("ERROR:").unwrap_or("")
                )));
            }
            if data.is_empty() || data.starts_with('<') {
                return Err(AppError::Other("MiMo API 返回为空或 HTML，请确认已登录".to_string()));
            }
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&data) {
                if val.get("code").and_then(|v| v.as_i64()) == Some(401) {
                    let login_url = val
                        .get("loginUrl")
                        .and_then(|v| v.as_str())
                        .or_else(|| {
                            val.get("data")
                                .and_then(|d| d.get("loginUrl"))
                                .and_then(|v| v.as_str())
                        });
                    // 401 需要导航到登录页，持锁避免与其他请求冲突
                    let _lock = lock_guard.lock().await;
                    if let Some(url) = login_url {
                        // Use serde_json::to_string for proper JS string escaping
                        let safe_url = serde_json::to_string(url).unwrap_or_default();
                        let _ = window
                            .eval(format!("window.location.href={}", safe_url));
                    } else {
                        let _ = window.eval("window.location.href='https://account.xiaomi.com/pass/serviceLogin?sid=platform.xiaomimimo.com'");
                    }
                    let _ = app.emit("mimo-auth-required", ());
                    return Err(AppError::Auth(
                        "MiMo 未登录，请在弹出的窗口中完成登录后重试".to_string(),
                    ));
                }
            }
            Ok(data)
        }
        Ok(Err(_)) => Err(AppError::Other("数据接收通道关闭".to_string())),
        Err(_) => {
            log::warn!(
                "[MiMo] fetch_api TIMEOUT after {}s, path={} port={}",
                timeout_secs,
                path,
                cb_port
            );
            let state =
                app.state::<Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>>();
            let mut map = state.lock().unwrap();
            map.remove(&req_id);
            Err(AppError::Timeout)
        }
    }
}

fn parse_mimo_api_response<T: serde::de::DeserializeOwned>(json: &str) -> Result<T, AppError> {
    #[derive(Deserialize)]
    struct ApiEnvelope<T2> {
        code: i32,
        #[serde(default)]
        #[allow(dead_code)]
        message: String,
        data: Option<T2>,
    }
    let envelope: ApiEnvelope<T> =
        serde_json::from_str(json).map_err(|e| AppError::Parse(format!("解析响应失败：{e}")))?;
    if envelope.code != 0 {
        return Err(AppError::Other(format!(
            "MiMo API 返回错误 code={}: {}",
            envelope.code, envelope.message
        )));
    }
    envelope
        .data
        .ok_or_else(|| AppError::Other("MiMo API 返回空数据".to_string()))
}

// ─── 余额查询 ────────────────────────────────────────────

pub async fn do_fetch_mimo_balance(app: &tauri::AppHandle) -> Result<MimoBalanceResult, AppError> {
    let json = fetch_mimo_api(app, "/api/v1/balance", "GET", 15, None).await?;
    log::debug!("[MiMo] /api/v1/balance response received ({} chars)", json.len());

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct BalanceDataV1 {
        #[allow(dead_code)]
        #[serde(default)]
        balance: String,
        #[allow(dead_code)]
        #[serde(default)]
        frozen_balance: String,
        #[serde(default)]
        currency: String,
        #[serde(default)]
        cash_balance: String,
    }
    if let Ok(data) = parse_mimo_api_response::<BalanceDataV1>(&json) {
        log::info!(
            "[MiMo] balance V1 parsed: cash_balance={} currency={}",
            data.cash_balance,
            data.currency
        );
        return Ok(MimoBalanceResult {
            available_balance: data.cash_balance,
            currency: if data.currency.is_empty() {
                "CNY".to_string()
            } else {
                data.currency
            },
            total_consumption: "—".to_string(),
            monthly_expense: "—".to_string(),
        });
    }
    log::warn!("[MiMo] balance V1 parse failed, trying AccountOverview");

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct CostUsageData {
        #[serde(default)]
        total_cost: String,
        #[serde(default)]
        current_month_cost: String,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct AccountOverview {
        #[serde(default)]
        cost_usage: Option<CostUsageData>,
    }
    if let Ok(overview) = parse_mimo_api_response::<AccountOverview>(&json) {
        if let Some(cost) = overview.cost_usage {
            log::info!(
                "[MiMo] balance AccountOverview parsed: total_cost={} month_cost={}",
                cost.total_cost,
                cost.current_month_cost
            );
            return Ok(MimoBalanceResult {
                available_balance: "—".to_string(),
                currency: "CNY".to_string(),
                total_consumption: cost.total_cost,
                monthly_expense: cost.current_month_cost,
            });
        }
    }
    log::warn!("[MiMo] balance AccountOverview parse also failed");

    Err(AppError::Parse("无法解析 MiMo 余额接口返回的数据".to_string()))
}

// ─── 用量查询 ────────────────────────────────────────────

pub async fn do_fetch_mimo_usage(
    app: &tauri::AppHandle,
    month: u32,
    year: u32,
) -> Result<MimoUsageResult, AppError> {
    let overview_json = fetch_mimo_api(app, "/api/v1/usage", "GET", 15, None).await?;
    log::debug!(
        "[MiMo] /api/v1/usage response ({} bytes)",
        overview_json.len()
    );

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct TokenUsageData {
        #[serde(default)]
        input_token: u64,
        #[serde(default)]
        output_token: u64,
        #[serde(default)]
        cache_token: u64,
        #[serde(default)]
        total_token: u64,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct CostUsageData {
        #[serde(default)]
        total_cost: String,
        #[serde(default)]
        current_month_cost: String,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct UsageOverview {
        #[serde(default)]
        token_usage: Option<TokenUsageData>,
        #[serde(default)]
        cost_usage: Option<CostUsageData>,
    }

    let overview = parse_mimo_api_response::<UsageOverview>(&overview_json)?;
    log::info!(
        "[MiMo] overview parsed: token_usage={:?}, cost_usage={:?}",
        overview
            .token_usage
            .as_ref()
            .map(|t| format!(
                "input={} output={} cache={} total={}",
                t.input_token, t.output_token, t.cache_token, t.total_token
            )),
        overview
            .cost_usage
            .as_ref()
            .map(|c| format!("total={} month={}", c.total_cost, c.current_month_cost))
    );
    let month_cost = overview
        .cost_usage
        .as_ref()
        .and_then(|c| c.current_month_cost.parse::<f64>().ok())
        .unwrap_or(0.0);

    // 尝试获取详细用量（按模型+日期分解）
    let month_key = format!("{}-{:02}", year, month);
    let detail_items = {
        let cache = app.state::<Mutex<crate::modules::types::MimoDetailCache>>();
        let cached = cache
            .lock()
            .unwrap()
            .get(std::time::Duration::from_secs(300), &month_key);
        match cached {
            Some(items) if !items.is_empty() => Some(items),
            Some(_) => None,
            None => {
                // 不再在此处加 in_progress 守卫——fast-path（在 fetch_mimo_usage_detail 内）
                // 不需要阻塞其他月份的并发请求。in_progress 守卫已移到 fetch_mimo_usage_detail
                // 内部的页面提取路径之前。
                match fetch_mimo_usage_detail(app, month, year).await {
                    Ok(items) if !items.is_empty() => {
                        cache.lock().unwrap().set(items.clone(), &month_key);
                        Some(items)
                    }
                    _ => None
                }
            }
        }
    };
    log::info!(
        "[MiMo] detail_items count: {}",
        detail_items.as_ref().map(|v| v.len()).unwrap_or(0)
    );

    match detail_items {
        Some(items) if !items.is_empty() => {
            let mut models_map: std::collections::HashMap<String, MimoUsageModel> =
                std::collections::HashMap::new();
            let mut days_map: std::collections::HashMap<
                String,
                (
                    MimoUsageDay,
                    std::collections::HashMap<String, MimoUsageDayModel>,
                ),
            > = std::collections::HashMap::new();
            let mut detail_month_cost: f64 = 0.0;
            let month_prefix = format!("{}-{:02}", year, month);

            for item in &items {
                // 仅统计请求月份的数据，避免把历史总消费当成当月消费
                if !item.date.starts_with(&month_prefix) {
                    continue;
                }
                let model_entry =
                    models_map
                        .entry(item.model.clone())
                        .or_insert_with(|| MimoUsageModel {
                            key: item.model.clone(),
                            name: item.model.clone(),
                            total_tokens: 0,
                            request_count: 0,
                            cache_hit_tokens: 0,
                            cache_miss_tokens: 0,
                            response_tokens: 0,
                            cost: 0.0,
                        });
                model_entry.total_tokens += item.total_token;
                model_entry.request_count += item.request_count;
                model_entry.cache_hit_tokens += item.input_hit_token;
                model_entry.cache_miss_tokens += item.input_miss_token;
                model_entry.response_tokens += item.output_token;
                model_entry.cost += item.consumed_amount.parse::<f64>().unwrap_or(0.0);

                let (day_entry, day_models) =
                    days_map
                        .entry(item.date.clone())
                        .or_insert_with(|| {
                            (
                                MimoUsageDay {
                                    date: item.date.clone(),
                                    total_tokens: 0,
                                    total_cost: 0.0,
                                    models: vec![],
                                },
                                std::collections::HashMap::new(),
                            )
                        });
                day_entry.total_tokens += item.total_token;
                day_entry.total_cost += item.consumed_amount.parse::<f64>().unwrap_or(0.0);
                let day_model =
                    day_models
                        .entry(item.model.clone())
                        .or_insert_with(|| MimoUsageDayModel {
                            key: item.model.clone(),
                            total_tokens: 0,
                            cache_hit_tokens: 0,
                            cache_miss_tokens: 0,
                            response_tokens: 0,
                            total_cost: 0.0,
                        });
                day_model.total_tokens += item.total_token;
                day_model.cache_hit_tokens += item.input_hit_token;
                day_model.cache_miss_tokens += item.input_miss_token;
                day_model.response_tokens += item.output_token;
                day_model.total_cost += item.consumed_amount.parse::<f64>().unwrap_or(0.0);
                detail_month_cost += item.consumed_amount.parse::<f64>().unwrap_or(0.0);
            }

            let mut days: Vec<MimoUsageDay> = Vec::new();
            for (_, (mut day, models_map)) in days_map {
                day.models = models_map.into_values().collect();
                days.push(day);
            }
            days.sort_by(|a, b| a.date.cmp(&b.date));
            let models: Vec<MimoUsageModel> = models_map.into_values().collect();
            let result = MimoUsageResult {
                models,
                days,
                month_cost: if detail_month_cost > 0.0 {
                    detail_month_cost
                } else {
                    month_cost
                },
            };
            log::info!(
                "[MiMo] usage result (detail): {} models, {} days, month_cost={}",
                result.models.len(),
                result.days.len(),
                result.month_cost
            );
            for m in &result.models {
                log::info!(
                    "[MiMo]   model: key={} tokens={} cost={}",
                    m.key,
                    m.total_tokens,
                    m.cost
                );
            }
            for d in &result.days {
                log::info!(
                    "[MiMo]   day: date={} tokens={} cost={} models={}",
                    d.date,
                    d.total_tokens,
                    d.total_cost,
                    d.models.len()
                );
            }
            Ok(result)
        }
        _ => {
            // fallback：detail API 不可用，仅使用 overview 的 month_cost，不伪造模型数据
            log::info!("[MiMo] detail API unavailable, using overview fallback");
            Ok(MimoUsageResult {
                models: vec![],
                days: vec![],
                month_cost,
            })
        }
    }
}

// ─── Detail 提取 ─────────────────────────────────────────

fn parse_detail_items(json: &str) -> Result<Vec<UsageDetailItem>, AppError> {
    log::info!(
        "[MiMo] parse_detail_items raw (first 1000): {}",
        &json[..json.len().min(1000)]
    );
    #[derive(Deserialize)]
    struct R {
        #[serde(default)]
        code: i32,
        #[serde(default)]
        data: Option<Vec<UsageDetailItem>>,
    }
    let r: R = serde_json::from_str(json).map_err(|e| {
        log::warn!("[MiMo] parse_detail_items error: {}", e);
        AppError::Parse(e.to_string())
    })?;
    if r.code != 0 {
        return Err(AppError::Other(format!("code={}", r.code)));
    }
    let items = r.data.unwrap_or_default();
    log::debug!("[MiMo] parse_detail_items: {} items parsed", items.len());
    Ok(items)
}

async fn fetch_mimo_usage_detail(
    app: &tauri::AppHandle,
    month: u32,
    year: u32,
) -> Result<Vec<UsageDetailItem>, AppError> {
    // 1. 先用缓存的 ph 尝试直接调用 API（快速路径，毫秒级返回）
    {
        let config = read_stored_config()?;
        if let Some(ref ph) = config.mimo_ph {
            log::debug!("[MiMo] detail: trying cached ph");
            // 正确构造 JSON body：{"year":2026,"month":6}
            let body_json = format!("{{\"year\":{},\"month\":{}}}", year, month);
            let api_url = format!("/api/v1/usage/detail/list?api-platform_ph={}", ph);
            let json = match fetch_mimo_api(app, &api_url, "POST", 10, Some(&body_json)).await {
                Ok(j) => j,
                Err(AppError::Auth(_)) => {
                    // ph 已失效：清除缓存，静默降级到页面提取（页面提取有独立的 401 处理）
                    log::warn!("[MiMo] detail fast-path 401, clearing cached ph");
                    if let Ok(mut config) = read_stored_config() {
                        config.mimo_ph = None;
                        let _ = write_stored_config(&config);
                    }
                    String::new()
                }
                Err(_) => {
                    // 超时/通道错误 → 回退到页面提取
                    log::info!("[MiMo] detail fast-path timeout/channel error, falling back to page extraction");
                    String::new()
                }
            };
            log::info!(
                "[MiMo] detail fast-path response (first 500): {}",
                &json[..json.len().min(LOG_TRUNCATE_LEN)]
            );
            if !json.is_empty() {
                if let Ok(items) = parse_detail_items(&json) {
                    if !items.is_empty() {
                        log::info!("[MiMo] detail fast-path OK: {} items", items.len());
                        return Ok(items);
                    }
                }
            }
            // fast-path response was empty or parse failed, fall through to page extraction
            log::info!("[MiMo] detail fast-path failed, falling back to page extraction");
        }
    }

    // 2. 缓存的 ph 失效或不存在 → 导航到用量页面（页面提取慢路径）
    // 页面提取需要导航 WebView，同一时间只能一个在进行。
    // fast-path 不受此限制——多个 fast-path 可并发（仅 eval JS fetch）。
    {
        let cache = app.state::<Mutex<crate::modules::types::MimoDetailCache>>();
        let can_start = cache.lock().unwrap().mark_in_progress();
        if !can_start {
            log::info!("[MiMo] detail page extraction already in progress, skipping");
            return Err(AppError::Other("page extraction already in progress".into()));
        }
    }
    let lock_guard = app.state::<Arc<tokio::sync::Mutex<()>>>();
    let window = {
        let _lock = lock_guard.lock().await;
        let w = ensure_mimo_webview_sync(app)?;
        log::info!("[MiMo] detail: navigating to usage page for {}-{:02}", year, month);
        let _ = w.eval("window.__mimo_detail = null; window.__mimo_ph = null;");
        let usage_url: tauri::Url = format!("https://platform.xiaomimimo.com/console/usage?month={}-{:02}", year, month)
            .parse()
            .map_err(|_| AppError::Other("无效 URL".to_string()))?;
        let _ = w.navigate(usage_url);
        w
    }; // 初始化完成后释放锁，避免阻塞并发的余额查询

    // 复用主 CallbackServer 端口，不再创建独立 HTTP 服务器
    let cb_port = app.state::<Mutex<CallbackServerPort>>().lock().unwrap().0;

    let start = std::time::Instant::now();
    let mut auth_401_count = 0u32;
    while start.elapsed() < std::time::Duration::from_secs(POLL_TIMEOUT_SECS) {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;

        let req_id = format!(
            "__chk_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let (tx, rx) = oneshot::channel();
        {
            let state =
                app.state::<Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>>();
            let mut map = state.lock().unwrap();
            map.insert(req_id.clone(), tx);
        }

        let check_js = format!(
            r#"try{{(async()=>{{
                var d=window.__mimo_detail||null;
                var ph=window.__mimo_ph||localStorage.getItem('mimo_platform_ph')||null;
                if(d&&!/"data":\[\]/.test(d)){{
                    fetch('http://127.0.0.1:{port}/mimo-callback',{{method:'POST',mode:'cors',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{reqId:'{req_id}',data:d}})}});
                }} else if(ph){{
                    try{{var u='https://platform.xiaomimimo.com/api/v1/usage/detail/list?api-platform_ph='+encodeURIComponent(ph);var r=await fetch(u,{{method:'POST',credentials:'include',headers:{{'Accept':'application/json','Content-Type':'application/json'}},body:JSON.stringify({{year:{year},month:{month}}})}});var t=await r.text();fetch('http://127.0.0.1:{port}/mimo-callback',{{method:'POST',mode:'cors',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{reqId:'{req_id}',data:t}})}});}}catch(e){{fetch('http://127.0.0.1:{port}/mimo-callback',{{method:'POST',mode:'cors',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{reqId:'{req_id}',data:'ERR:'+e.message}})}});}}
                }} else {{
                    fetch('http://127.0.0.1:{port}/mimo-callback',{{method:'POST',mode:'cors',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{reqId:'{req_id}',data:'WAITING'}})}});
                }}
            }})()}}catch(e){{fetch('http://127.0.0.1:{port}/mimo-callback',{{method:'POST',mode:'cors',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{reqId:'{req_id}',data:'EXC:'+e.message}})}});}}"#,
            port = cb_port, req_id = req_id, year = year, month = month,
        );
        let _ = {
            let _lock = lock_guard.lock().await;
            window.eval(&check_js)
        };

        if let Ok(Ok(data)) =
            tokio::time::timeout(std::time::Duration::from_secs(5), rx).await
        {
            log::info!(
                "[MiMo] detail check (first 200): {}",
                &data[..data.len().min(200)]
            );
            if data == "WAITING" {
                log::info!("[MiMo] detail: waiting for hook to capture data...");
                continue;
            } else if data.starts_with("ERR:") || data.starts_with("EXC:") {
                log::warn!("[MiMo] detail error: {}", data);
                continue;
            } else if data.contains("\"code\":401") {
                auth_401_count += 1;
                if auth_401_count <= 2 {
                    log::info!(
                        "[MiMo] detail: 401 detected ({}/2), showing login window",
                        auth_401_count
                    );
                    if let Some(w) = app.get_webview_window("mimo-sync") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                    let _ = app.emit("mimo-auth-required", ());
                } else {
                    log::info!(
                        "[MiMo] detail: 401 persisted after {} retries, giving up detail extraction",
                        auth_401_count
                    );
                }
                continue;
            } else if !data.is_empty() && !data.starts_with('<') {
                if let Ok(items) = parse_detail_items(&data) {
                    // 无论数据是否为空，API 调用本身已成功 → 尝试缓存 ph
                    // ph 已被 hook 从 API URL 中捕获到 window.__mimo_ph，
                    // 缓存后下次查询即可走 fast-path 毫秒级返回
                    let ph_req = format!("__ph_{}", req_id);
                    let (ptx, prx) = oneshot::channel();
                    {
                        let state = app
                            .state::<Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>>();
                        let mut map = state.lock().unwrap();
                        map.insert(ph_req.clone(), ptx);
                    }
                    let _ = window.eval(format!(
                        r#"try{{var p=window.__mimo_ph||localStorage.getItem('mimo_platform_ph')||'';fetch('http://127.0.0.1:{port}/mimo-callback',{{method:'POST',mode:'cors',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{reqId:'{ph_req}',data:p}})}});}}catch(e){{}}"#,
                        port = cb_port, ph_req = ph_req,
                    ));
                    if let Ok(Ok(ph_val)) =
                        tokio::time::timeout(std::time::Duration::from_secs(2), prx).await
                    {
                        if !ph_val.is_empty() {
                            if let Ok(mut config) = read_stored_config() {
                                config.mimo_ph = Some(ph_val);
                                let _ = write_stored_config(&config);
                                log::info!("[MiMo] ph cached for future fast-path use");
                            }
                        }
                    }

                    if !items.is_empty() {
                        log::info!("[MiMo] detail OK: {} items", items.len());
                        let cache = app.state::<Mutex<crate::modules::types::MimoDetailCache>>();
                        cache.lock().unwrap().clear_in_progress();
                        return Ok(items);
                    }
                    log::info!("[MiMo] detail API returned empty data (no usage this month), ph cached, continuing poll...");
                }
            }
        }
    }

    {
        let cache = app.state::<Mutex<crate::modules::types::MimoDetailCache>>();
        cache.lock().unwrap().clear_in_progress();
    }
    Err(AppError::Other(
        "无法获取用量详情，请确认已登录 MiMo".to_string(),
    ))
}

// ─── Sync ────────────────────────────────────────────────

pub fn do_start_mimo_sync(app: &tauri::AppHandle) -> Result<bool, AppError> {
    if let Some(window) = app.get_webview_window("mimo-sync") {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(true);
    }
    let window = ensure_mimo_webview_sync(app)?;
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit("mimo-sync-started", ());
    Ok(false)
}

pub fn do_ensure_mimo_webview(app: &tauri::AppHandle) -> Result<(), AppError> {
    ensure_mimo_webview_sync(app).map(|_| ())
}

pub fn do_mimo_api_response(
    app: &tauri::AppHandle,
    req_id: String,
    json: String,
) -> Result<(), AppError> {
    let state =
        app.state::<Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>>();
    let mut map = state.lock().unwrap();
    if let Some(tx) = map.remove(&req_id) {
        let _ = tx.send(json);
    }
    Ok(())
}

// ─── 单元测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_detail_items_empty_list() {
        let json = r#"{"code":0,"data":[]}"#;
        let items = parse_detail_items(json).unwrap();
        assert!(items.is_empty());
    }

    #[test]
    fn parse_detail_items_normal() {
        let json = r#"{"code":0,"data":[{"date":"2026-06-01","model":"mimo-v2.5","totalToken":100,"inputHitToken":60,"inputMissToken":20,"outputToken":20,"requestCount":3,"consumedAmount":"0.0123"}]}"#;
        let items = parse_detail_items(json).unwrap();
        assert_eq!(items.len(), 1);
        let item = &items[0];
        assert_eq!(item.date, "2026-06-01");
        assert_eq!(item.model, "mimo-v2.5");
        assert_eq!(item.total_token, 100);
        assert_eq!(item.input_hit_token, 60);
        assert_eq!(item.input_miss_token, 20);
        assert_eq!(item.output_token, 20);
        assert_eq!(item.request_count, 3);
        assert_eq!(item.consumed_amount, "0.0123");
    }

    #[test]
    fn parse_detail_items_nonzero_code() {
        let json = r#"{"code":401,"data":null}"#;
        let err = parse_detail_items(json).unwrap_err();
        assert!(err.to_string().contains("code=401"));
    }

    #[test]
    fn parse_detail_items_invalid_json() {
        let err = parse_detail_items("not json").unwrap_err();
        assert!(matches!(err, AppError::Parse(_)));
    }

    #[test]
    fn parse_detail_items_defaults_missing_fields() {
        let json = r#"{"code":0,"data":[{"date":"2026-06-02"}]}"#;
        let items = parse_detail_items(json).unwrap();
        assert_eq!(items[0].total_token, 0);
        assert_eq!(items[0].model, "");
        assert_eq!(items[0].consumed_amount, "");
    }

    #[test]
    fn parse_envelope_ok() {
        let json = r#"{"code":0,"message":"ok","data":{"total":1}}"#;
        let v: serde_json::Value = parse_mimo_api_response(json).unwrap();
        assert_eq!(v["total"], 1);
    }

    #[test]
    fn parse_envelope_error_code() {
        let json = r#"{"code":500,"message":"boom","data":null}"#;
        let err = parse_mimo_api_response::<serde_json::Value>(json).unwrap_err();
        assert!(err.to_string().contains("code=500"));
        assert!(err.to_string().contains("boom"));
    }

    #[test]
    fn parse_envelope_null_data() {
        let json = r#"{"code":0,"data":null}"#;
        let err = parse_mimo_api_response::<serde_json::Value>(json).unwrap_err();
        assert!(err.to_string().contains("空数据"));
    }

    #[test]
    fn usage_aggregation_filters_other_months() {
        // 模拟 do_fetch_mimo_usage 的聚合逻辑：跨月数据被过滤
        let items = vec![
            UsageDetailItem {
                date: "2026-06-01".into(),
                model: "mimo-v2.5".into(),
                total_token: 100,
                input_hit_token: 60,
                input_miss_token: 20,
                output_token: 20,
                request_count: 3,
                consumed_amount: "0.01".into(),
            },
            UsageDetailItem {
                date: "2026-05-31".into(), // 其他月份 → 忽略
                model: "mimo-v2.5".into(),
                total_token: 999,
                input_hit_token: 999,
                input_miss_token: 0,
                output_token: 0,
                request_count: 1,
                consumed_amount: "9.99".into(),
            },
        ];
        let month_prefix = "2026-06";
        let mut models_map: HashMap<String, MimoUsageModel> = HashMap::new();
        let mut total = 0u64;
        for item in &items {
            if !item.date.starts_with(month_prefix) {
                continue;
            }
            let e = models_map.entry(item.model.clone()).or_insert_with(|| MimoUsageModel {
                key: item.model.clone(),
                name: item.model.clone(),
                total_tokens: 0,
                request_count: 0,
                cache_hit_tokens: 0,
                cache_miss_tokens: 0,
                response_tokens: 0,
                cost: 0.0,
            });
            e.total_tokens += item.total_token;
            total += item.total_token;
        }
        assert_eq!(total, 100);
        assert_eq!(models_map["mimo-v2.5"].total_tokens, 100);
    }
}
