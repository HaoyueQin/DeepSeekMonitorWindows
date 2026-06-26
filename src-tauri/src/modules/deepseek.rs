//! DeepSeek API 模块
//!
//! 职责：余额查询、用量查询、Token 同步（WebView 登录 + 磁盘缓存扫描）。

use std::{
    fs,
    io::Read,
    os::windows::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

use serde::Deserialize;
use tauri::{Emitter, Manager};
use tauri::webview::PageLoadEvent;

use crate::modules::types::{BalanceResult, UsageDaySummary, UsageModelSummary, UsageResult};
use crate::modules::config::{read_stored_config, write_stored_config, to_app_config};
use crate::modules::types::AppConfig;

// ─── 余额查询 ────────────────────────────────────────────

pub async fn do_fetch_balance() -> Result<BalanceResult, String> {
    let config = read_stored_config()?;
    let api_key = config
        .api_key
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "未配置 API Key".to_string())?;

    let client = reqwest::Client::new();
    let response = client
        .get("https://api.deepseek.com/user/balance")
        .bearer_auth(&api_key)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|error| format!("网络请求失败：{error}"))?;

    match response.status().as_u16() {
        200 => {}
        401 => return Err("API Key 无效或已过期".to_string()),
        429 => return Err("请求过于频繁，请稍后再试".to_string()),
        code if code >= 500 => return Err(format!("DeepSeek 服务器错误：{code}")),
        code => return Err(format!("请求失败：HTTP {code}")),
    }

    #[derive(Deserialize)]
    struct BalanceInfo {
        currency: String,
        total_balance: String,
        granted_balance: String,
        topped_up_balance: String,
    }
    #[derive(Deserialize)]
    struct BalanceResponse {
        is_available: bool,
        balance_infos: Vec<BalanceInfo>,
    }

    let data: BalanceResponse = response
        .json()
        .await
        .map_err(|error| format!("解析余额数据失败：{error}"))?;

    let info = data
        .balance_infos
        .into_iter()
        .next()
        .ok_or_else(|| "余额信息为空".to_string())?;

    Ok(BalanceResult {
        is_available: data.is_available,
        currency: info.currency,
        total_balance: info.total_balance,
        granted_balance: info.granted_balance,
        topped_up_balance: info.topped_up_balance,
    })
}

// ─── Token 管理 ──────────────────────────────────────────

pub fn do_save_usage_token(usage_token: String) -> Result<AppConfig, String> {
    let value = usage_token.trim().to_string();
    if value.is_empty() {
        return Err("用量 Token 不能为空".to_string());
    }
    let mut config = read_stored_config()?;
    config.usage_token = Some(value);
    write_stored_config(&config)?;
    to_app_config(config)
}

pub fn do_clear_usage_token() -> Result<AppConfig, String> {
    let mut config = read_stored_config()?;
    config.usage_token = None;
    write_stored_config(&config)?;
    to_app_config(config)
}

const USAGE_TOKEN_TITLE_PREFIX: &str = "DSM_USAGE_TOKEN:";

pub fn capture_usage_token(app: &tauri::AppHandle, token: String) -> Result<AppConfig, String> {
    let value = token.trim().to_string();
    if value.is_empty() {
        return Err("用量 Token 为空".to_string());
    }
    let mut config = read_stored_config()?;
    config.usage_token = Some(value);
    write_stored_config(&config)?;
    let app_config = to_app_config(config)?;

    if let Some(flag) = app.try_state::<Arc<AtomicBool>>() {
        flag.store(true, Ordering::SeqCst);
    }

    if let Some(window) = app.get_webview_window("login-sync") {
        let _ = window.close();
    }

    let _ = app.emit("usage-token-captured", &app_config);
    Ok(app_config)
}

pub async fn verify_usage_token(token: &str, month: u32, year: u32) -> Result<(), String> {
    let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
              (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
    let url =
        format!("https://platform.deepseek.com/api/v0/usage/amount?month={month}&year={year}");
    let resp = reqwest::Client::new()
        .get(&url)
        .bearer_auth(token)
        .header("x-app-version", "1.0.0")
        .header("Accept", "*/*")
        .header("User-Agent", ua)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|error| format!("验证 token 失败：{error}"))?;
    if resp.status().as_u16() == 200 {
        Ok(())
    } else {
        Err(format!("token 无效：HTTP {}", resp.status().as_u16()))
    }
}

// ─── WebView 缓存扫描 ────────────────────────────────────

fn read_shared_text(path: &Path) -> Option<String> {
    let mut file = fs::OpenOptions::new()
        .read(true)
        // SHARE_READ | SHARE_WRITE | SHARE_DELETE
        .share_mode(0x1 | 0x2 | 0x4)
        .open(path)
        .ok()?;
    let metadata = file.metadata().ok()?;
    if metadata.len() == 0 || metadata.len() > 20 * 1024 * 1024 {
        return None;
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).replace('\0', ""))
}

fn extract_user_api_token(text: &str) -> Option<String> {
    let mut search_from = 0;
    let marker = "\"token\":\"";
    while let Some(relative_index) = text[search_from..].find(marker) {
        let token_start = search_from + relative_index + marker.len();
        let token_end = token_start + text[token_start..].find('"')?;
        let token = &text[token_start..token_end];
        let context_end = (token_end + 1800).min(text.len());
        let context = &text[token_end..context_end];
        if token.len() > 20
            && context.contains("\"id_profile\"")
            && context.contains("\"feature_gates\"")
        {
            return Some(token.to_string());
        }
        search_from = token_end + 1;
    }
    None
}

pub fn find_webview_cached_usage_token() -> Option<String> {
    let local_app_data = std::env::var_os("LOCALAPPDATA")?;
    let cache_dir = PathBuf::from(local_app_data)
        .join("com.deepseek.monitor.windows")
        .join("EBWebView")
        .join("Default")
        .join("Cache")
        .join("Cache_Data");
    let entries = fs::read_dir(cache_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if let Some(text) = read_shared_text(&path) {
            if let Some(token) = extract_user_api_token(&text) {
                return Some(token);
            }
        }
    }
    None
}

// ─── WebView Token 同步 ──────────────────────────────────

pub fn start_usage_title_watcher(app: tauri::AppHandle) {
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(3));
        for _ in 0..1200 {
            if let Some(token) = find_webview_cached_usage_token() {
                let _ = capture_usage_token(&app, token);
                return;
            }

            let Some(window) = app.get_webview_window("login-sync") else {
                let captured = app
                    .try_state::<Arc<AtomicBool>>()
                    .map(|flag| flag.load(Ordering::SeqCst))
                    .unwrap_or(false);
                if !captured {
                    let _ = app.emit("usage-sync-ended", ());
                }
                return;
            };

            if let Ok(title) = window.title() {
                if let Some(rest) = title.strip_prefix(USAGE_TOKEN_TITLE_PREFIX) {
                    let mut parts = rest.splitn(3, ':');
                    if let (Some(y), Some(m), Some(tok)) =
                        (parts.next(), parts.next(), parts.next())
                    {
                        if let (Ok(year), Ok(month)) = (y.parse::<u32>(), m.parse::<u32>()) {
                            let token = tok.to_string();
                            let verified = tauri::async_runtime::block_on(
                                verify_usage_token(&token, month, year),
                            );
                            if verified.is_ok() {
                                let _ = capture_usage_token(&app, token);
                                return;
                            }
                        }
                    }
                }
            }

            thread::sleep(Duration::from_millis(1500));
        }
        let captured = app
            .try_state::<Arc<AtomicBool>>()
            .map(|flag| flag.load(Ordering::SeqCst))
            .unwrap_or(false);
        if !captured {
            let _ = app.emit("usage-sync-ended", ());
        }
    });
}

/// 在登录窗口注入的 JS：hook fetch / XMLHttpRequest，从 Authorization 头抓 Bearer token。
pub const USAGE_SYNC_POLL_JS: &str = r#"
(function() {
  if (window.__dsm_token_hook__) return;
  window.__dsm_token_hook__ = true;
  var done = false;
  var pending = false;

  function deliver(token) {
    if (done) return;
    if (!token || typeof token !== 'string') return;
    token = token.trim();
    if (token.length < 20) return;
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth() + 1;
    try { document.title = 'DSM_USAGE_TOKEN:' + y + ':' + m + ':' + token; } catch (e) {}
    try {
      if (!pending && window.__TAURI__ && window.__TAURI__.core) {
        pending = true;
        window.__TAURI__.core.invoke('usage_token_captured', {
          token: token, month: m, year: y
        }).then(function() { done = true; }).catch(function() { pending = false; });
      }
    } catch (e) {}
  }

  function fromAuth(value) {
    if (!value) return;
    var m = /Bearer\s+(\S+)/i.exec(String(value));
    if (m && m[1]) deliver(m[1]);
  }

  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function(input, init) {
      try {
        var headers = (init && init.headers) || (input && input.headers);
        if (headers) {
          if (typeof Headers !== 'undefined' && headers instanceof Headers) {
            fromAuth(headers.get('authorization'));
          } else if (Array.isArray(headers)) {
            for (var i = 0; i < headers.length; i++) {
              if (headers[i] && String(headers[i][0]).toLowerCase() === 'authorization') {
                fromAuth(headers[i][1]);
              }
            }
          } else if (typeof headers === 'object') {
            for (var k in headers) {
              if (k.toLowerCase() === 'authorization') fromAuth(headers[k]);
            }
          }
        }
      } catch (e) {}
      return origFetch.apply(this, arguments);
    };
  }

  var origSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    try {
      if (name && String(name).toLowerCase() === 'authorization') fromAuth(value);
    } catch (e) {}
    return origSet.apply(this, arguments);
  };
})();
"#;

pub fn start_usage_sync(app: &tauri::AppHandle) -> Result<bool, String> {
    if let Some(flag) = app.try_state::<Arc<AtomicBool>>() {
        flag.store(false, Ordering::SeqCst);
    }

    if let Some(token) = find_webview_cached_usage_token() {
        capture_usage_token(app, token)?;
        return Ok(true);
    }

    if app.get_webview_window("login-sync").is_some() {
        if let Some(window) = app.get_webview_window("login-sync") {
            let _ = window.eval("location.reload();");
        }
        return Ok(false);
    }

    let url = tauri::WebviewUrl::External("https://platform.deepseek.com".parse().unwrap());
    tauri::WebviewWindowBuilder::new(app, "login-sync", url)
        .title("DeepSeek 账号登录")
        .inner_size(480.0, 720.0)
        .min_inner_size(360.0, 480.0)
        .resizable(true)
        .center()
        .visible(true)
        .initialization_script(USAGE_SYNC_POLL_JS)
        .on_page_load(|window, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished)
                && payload
                    .url()
                    .host_str()
                    .is_some_and(|host| host == "platform.deepseek.com")
            {
                let _ = window.eval(USAGE_SYNC_POLL_JS);
            }
        })
        .build()
        .map_err(|error| format!("打开登录窗口失败：{error}"))?;
    start_usage_title_watcher(app.clone());
    Ok(false)
}

pub async fn do_usage_token_captured(
    app: &tauri::AppHandle,
    token: String,
    month: u32,
    year: u32,
) -> Result<AppConfig, String> {
    let value = token.trim().to_string();
    if value.is_empty() {
        return Err("用量 Token 为空".to_string());
    }
    verify_usage_token(&value, month, year).await?;
    capture_usage_token(app, value)
}

// ─── 用量查询 ────────────────────────────────────────────

pub async fn do_fetch_usage(month: u32, year: u32) -> Result<UsageResult, String> {
    let config = read_stored_config()?;
    let token = config
        .usage_token
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "未配置用量 Token".to_string())?;

    #[derive(Deserialize)]
    struct Entry {
        #[serde(rename = "type")]
        kind: String,
        amount: String,
    }
    #[derive(Deserialize)]
    struct ModelUsage {
        model: String,
        usage: Vec<Entry>,
    }
    #[derive(Deserialize)]
    struct DayUsage {
        date: String,
        data: Vec<ModelUsage>,
    }
    #[derive(Deserialize)]
    struct AmountBiz {
        total: Vec<ModelUsage>,
        days: Vec<DayUsage>,
    }
    #[derive(Deserialize)]
    struct AmountData {
        biz_data: AmountBiz,
    }
    #[derive(Deserialize)]
    struct AmountResp {
        data: AmountData,
    }
    #[derive(Deserialize)]
    struct CostBiz {
        total: Vec<ModelUsage>,
        days: Vec<DayUsage>,
    }
    #[derive(Deserialize)]
    struct CostData {
        biz_data: Vec<CostBiz>,
    }
    #[derive(Deserialize)]
    struct CostResp {
        data: CostData,
    }

    async fn get_json<T: serde::de::DeserializeOwned>(
        client: &reqwest::Client,
        url: &str,
        token: &str,
    ) -> Result<T, String> {
        let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                  (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
        let resp = client
            .get(url)
            .bearer_auth(token)
            .header("x-app-version", "1.0.0")
            .header("Accept", "*/*")
            .header("User-Agent", ua)
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await
            .map_err(|error| format!("用量请求失败：{error}"))?;
        match resp.status().as_u16() {
            200 => {}
            401 => return Err("用量 Token 无效或已过期，请重新获取".to_string()),
            429 => return Err("请求过于频繁，请稍后再试".to_string()),
            code => return Err(format!("用量接口错误：HTTP {code}")),
        }
        resp.json::<T>()
            .await
            .map_err(|error| format!("解析用量数据失败：{error}"))
    }

    fn token_breakdown(usage: &[Entry]) -> (u64, u64, u64, u64, u64) {
        let mut total = 0u64;
        let mut request = 0u64;
        let mut hit = 0u64;
        let mut miss = 0u64;
        let mut response = 0u64;
        for entry in usage {
            let value = entry.amount.parse::<f64>().unwrap_or(0.0).round() as u64;
            match entry.kind.as_str() {
                "REQUEST" => request = value,
                "PROMPT_CACHE_HIT_TOKEN" => {
                    hit = value;
                    total += value;
                }
                "PROMPT_CACHE_MISS_TOKEN" => {
                    miss = value;
                    total += value;
                }
                "RESPONSE_TOKEN" => {
                    response = value;
                    total += value;
                }
                "PROMPT_TOKEN" => total += value,
                _ => {}
            }
        }
        (total, request, hit, miss, response)
    }

    fn cost_sum(usage: &[Entry]) -> f64 {
        usage
            .iter()
            .filter(|entry| entry.kind != "REQUEST")
            .map(|entry| entry.amount.parse::<f64>().unwrap_or(0.0))
            .sum()
    }

    let client = reqwest::Client::new();
    let amount_url =
        format!("https://platform.deepseek.com/api/v0/usage/amount?month={month}&year={year}");
    let cost_url =
        format!("https://platform.deepseek.com/api/v0/usage/cost?month={month}&year={year}");

    let amount: AmountResp = get_json(&client, &amount_url, &token).await?;
    let cost: CostResp = get_json(&client, &cost_url, &token).await?;

    let cost_total = cost.data.biz_data.first();
    let cost_for_model = |model: &str| -> f64 {
        cost_total
            .and_then(|item| item.total.iter().find(|m| m.model == model))
            .map(|m| cost_sum(&m.usage))
            .unwrap_or(0.0)
    };

    let mut models = Vec::new();
    for model_usage in &amount.data.biz_data.total {
        let label = match model_usage.model.as_str() {
            "deepseek-v4-flash" => Some(("flash", "V4 Flash")),
            "deepseek-v4-pro" => Some(("pro", "V4 Pro")),
            _ => None,
        };
        if let Some((key, name)) = label {
            let (total, request, hit, miss, response) = token_breakdown(&model_usage.usage);
            models.push(UsageModelSummary {
                key: key.to_string(),
                name: name.to_string(),
                total_tokens: total,
                request_count: request,
                cache_hit_tokens: hit,
                cache_miss_tokens: miss,
                response_tokens: response,
                cost: cost_for_model(&model_usage.model),
            });
        }
    }

    let mut cost_by_date: std::collections::HashMap<String, f64> =
        std::collections::HashMap::new();
    if let Some(item) = cost_total {
        for day in &item.days {
            let day_cost: f64 = day.data.iter().map(|m| cost_sum(&m.usage)).sum();
            cost_by_date.insert(day.date.clone(), day_cost);
        }
    }

    let mut days = Vec::new();
    for day in &amount.data.biz_data.days {
        let mut flash = 0u64;
        let mut flash_hit = 0u64;
        let mut flash_miss = 0u64;
        let mut flash_resp = 0u64;
        let mut pro = 0u64;
        let mut pro_hit = 0u64;
        let mut pro_miss = 0u64;
        let mut pro_resp = 0u64;
        let mut total = 0u64;
        for model_usage in &day.data {
            let (tokens, _, hit, miss, response) = token_breakdown(&model_usage.usage);
            total += tokens;
            match model_usage.model.as_str() {
                "deepseek-v4-flash" => {
                    flash += tokens;
                    flash_hit += hit;
                    flash_miss += miss;
                    flash_resp += response;
                }
                "deepseek-v4-pro" => {
                    pro += tokens;
                    pro_hit += hit;
                    pro_miss += miss;
                    pro_resp += response;
                }
                _ => {}
            }
        }
        days.push(UsageDaySummary {
            date: day.date.clone(),
            flash_tokens: flash,
            flash_cache_hit: flash_hit,
            flash_cache_miss: flash_miss,
            flash_response: flash_resp,
            pro_tokens: pro,
            pro_cache_hit: pro_hit,
            pro_cache_miss: pro_miss,
            pro_response: pro_resp,
            total_tokens: total,
            total_cost: cost_by_date.get(&day.date).copied().unwrap_or(0.0),
        });
    }

    let month_cost: f64 = cost_total
        .map(|item| item.total.iter().map(|m| cost_sum(&m.usage)).sum())
        .unwrap_or(0.0);

    Ok(UsageResult {
        models,
        days,
        month_cost,
    })
}
