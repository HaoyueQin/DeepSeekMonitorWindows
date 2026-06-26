#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use serde::{Deserialize, Serialize};
    use std::{
        collections::HashMap,
        fs,
        io::Read,
        os::windows::fs::OpenOptionsExt,
        path::{Path, PathBuf},
        process::Command,
        sync::{
            atomic::{AtomicBool, AtomicU16, Ordering},
            Arc, Mutex,
        },
        thread,
        time::Duration,
    };
    use tokio::sync::oneshot;
    use tauri::{
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
        webview::PageLoadEvent,
        Emitter, Manager, PhysicalPosition, Position, WebviewWindow,
    };

    /// In-memory cache for MiMo detail extraction results to avoid repeated slow polling.
    /// Also serves as a concurrency guard to prevent multiple simultaneous extractions.
    struct MimoDetailCache {
        items: Option<(std::time::Instant, Vec<UsageDetailItem>)>,
        in_progress: bool,
    }
    impl MimoDetailCache {
        fn new() -> Self { Self { items: None, in_progress: false } }
        fn get(&self, max_age: std::time::Duration) -> Option<Vec<UsageDetailItem>> {
            if self.in_progress { return Some(vec![]); } // 别重复调用
            self.items.as_ref().and_then(|(ts, items)| {
                if ts.elapsed() < max_age { Some(items.to_vec()) } else { None }
            })
        }
        fn set(&mut self, items: Vec<UsageDetailItem>) {
            self.items = Some((std::time::Instant::now(), items));
            self.in_progress = false;
        }
        fn mark_in_progress(&mut self) -> bool {
            if self.in_progress { return false; } // 已有提取在进行
            self.in_progress = true;
            true
        }
        fn clear_in_progress(&mut self) { self.in_progress = false; }
    }

    #[derive(Debug, Default, Deserialize, Serialize)]
    struct StoredConfig {
        api_key: Option<String>,
        #[serde(default)]
        usage_token: Option<String>,
        #[serde(default)]
        provider: String, // "deepseek" | "mimo"
        #[serde(default)]
        mimo_token: Option<String>,
        #[serde(default)]
        mimo_ph: Option<String>,
        refresh_interval_seconds: u64,
        #[serde(default)]
        auto_refresh_enabled: bool,
        autostart: bool,
    }

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct AppConfig {
        api_key_configured: bool,
        api_key_preview: Option<String>,
        usage_token_configured: bool,
        provider: String,
        mimo_token_configured: bool,
        refresh_interval_seconds: u64,
        auto_refresh_enabled: bool,
        autostart: bool,
        config_path: String,
    }

    fn config_path() -> Result<PathBuf, String> {
        let appdata = std::env::var_os("APPDATA").ok_or("APPDATA is not available")?;
        Ok(PathBuf::from(appdata)
            .join("DeepSeekMonitorWindows")
            .join("config.json"))
    }

    fn read_stored_config() -> Result<StoredConfig, String> {
        let path = config_path()?;
        if !path.exists() {
            return Ok(StoredConfig {
                refresh_interval_seconds: 60,
                ..StoredConfig::default()
            });
        }

        let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
        let mut config: StoredConfig =
            serde_json::from_str(&text).map_err(|error| error.to_string())?;
        config.refresh_interval_seconds =
            normalize_refresh_interval_seconds(config.refresh_interval_seconds);
        Ok(config)
    }

    fn normalize_refresh_interval_seconds(value: u64) -> u64 {
        match value {
            60 | 300 | 1800 | 3600 => value,
            _ => 60,
        }
    }

    /// Get current date in YYYY-MM-DD format using local time
    fn chrono_now_date() -> String {
        let now = std::time::SystemTime::now();
        let duration = now.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
        let secs = duration.as_secs();
        // days since epoch
        let days = (secs / 86400) as i64;
        // convert to y/m/d (civil calendar from days since epoch)
        let (y, m, d) = civil_from_days(days);
        format!("{:04}-{:02}-{:02}", y, m, d)
    }

    fn civil_from_days(days: i64) -> (i64, u32, u32) {
        let z = days + 719468;
        let era = if z >= 0 { z } else { z - 146096 } / 146097;
        let doe = (z - era * 146097) as u32;
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        let y = yoe as i64 + era * 400;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        let y = if m <= 2 { y + 1 } else { y };
        (y, m, d)
    }

    fn write_stored_config(config: &StoredConfig) -> Result<(), String> {
        let path = config_path()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        let text = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
        fs::write(path, text).map_err(|error| error.to_string())
    }

    fn api_key_preview(api_key: &str) -> String {
        let chars: Vec<char> = api_key.chars().collect();
        if chars.len() <= 12 {
            return "已保存".to_string();
        }

        let start: String = chars.iter().take(7).collect();
        let end: String = chars
            .iter()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        format!("{start}...{end}")
    }

    fn to_app_config(config: StoredConfig) -> Result<AppConfig, String> {
        let path = config_path()?;
        let api_key_preview = config
            .api_key
            .as_ref()
            .filter(|value| !value.is_empty())
            .map(|value| api_key_preview(value));

        let usage_token_configured = config
            .usage_token
            .as_ref()
            .map(|value| !value.is_empty())
            .unwrap_or(false);

        let mimo_token_configured = config
            .mimo_token
            .as_ref()
            .map(|value| !value.is_empty())
            .unwrap_or(false);

        Ok(AppConfig {
            api_key_configured: api_key_preview.is_some(),
            api_key_preview,
            usage_token_configured,
            provider: if config.provider.is_empty() {
                "deepseek".to_string()
            } else {
                config.provider.clone()
            },
            mimo_token_configured,
            refresh_interval_seconds: config.refresh_interval_seconds,
            auto_refresh_enabled: config.auto_refresh_enabled,
            autostart: config.autostart,
            config_path: path.to_string_lossy().to_string(),
        })
    }

    fn position_near_tray(window: &WebviewWindow) -> tauri::Result<()> {
        let cursor = window.cursor_position()?;
        let monitor = window
            .monitor_from_point(cursor.x, cursor.y)?
            .or(window.current_monitor()?)
            .or(window.primary_monitor()?)
            .ok_or_else(|| tauri::Error::WindowNotFound)?;

        let work_area = monitor.work_area();
        let scale_factor = monitor.scale_factor();
        let size = window.outer_size()?;
        let margin = (12.0 * scale_factor).round() as i32;
        let width = size.width as i32;
        let height = size.height as i32;
        let right = work_area.position.x + work_area.size.width as i32;
        let bottom = work_area.position.y + work_area.size.height as i32;
        let x = right - width - margin;
        let y = bottom - height - margin;

        window.set_position(Position::Physical(PhysicalPosition::new(
            x.max(work_area.position.x),
            y.max(work_area.position.y),
        )))
    }

    fn show_main_window(window: &WebviewWindow) {
        let _ = position_near_tray(window);
        let _ = window.show();
        let _ = window.set_focus();
    }

    #[tauri::command]
    fn hide_main_window(window: WebviewWindow) -> Result<(), String> {
        window.hide().map_err(|error| error.to_string())
    }

    #[tauri::command]
    fn get_app_config() -> Result<AppConfig, String> {
        to_app_config(read_stored_config()?)
    }

    #[tauri::command]
    fn save_api_key(api_key: String) -> Result<AppConfig, String> {
        let value = api_key.trim().to_string();
        if value.is_empty() {
            return Err("API Key 不能为空".to_string());
        }

        let mut config = read_stored_config()?;
        config.api_key = Some(value);
        write_stored_config(&config)?;
        to_app_config(config)
    }

    #[tauri::command]
    fn clear_api_key() -> Result<AppConfig, String> {
        let mut config = read_stored_config()?;
        config.api_key = None;
        write_stored_config(&config)?;
        to_app_config(config)
    }

    #[tauri::command]
    fn save_refresh_interval(refresh_interval_seconds: u64) -> Result<AppConfig, String> {
        let mut config = read_stored_config()?;
        config.refresh_interval_seconds =
            normalize_refresh_interval_seconds(refresh_interval_seconds);
        write_stored_config(&config)?;
        to_app_config(config)
    }

    #[tauri::command]
    fn save_auto_refresh_enabled(auto_refresh_enabled: bool) -> Result<AppConfig, String> {
        let mut config = read_stored_config()?;
        config.auto_refresh_enabled = auto_refresh_enabled;
        write_stored_config(&config)?;
        to_app_config(config)
    }

    fn apply_autostart(enabled: bool) -> Result<(), String> {
        let run_key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
        let value_name = "DeepSeekMonitorWindows";

        if enabled {
            let exe = std::env::current_exe().map_err(|error| error.to_string())?;
            let exe_arg = exe.to_string_lossy().to_string();
            let status = Command::new("reg")
                .args(["add", run_key, "/v", value_name, "/t", "REG_SZ", "/d"])
                .arg(exe_arg)
                .args(["/f"])
                .status()
                .map_err(|error| format!("写入开机自启失败：{error}"))?;
            if !status.success() {
                return Err("写入开机自启失败".to_string());
            }
            return Ok(());
        }

        let status = Command::new("reg")
            .args(["delete", run_key, "/v", value_name, "/f"])
            .status()
            .map_err(|error| format!("关闭开机自启失败：{error}"))?;
        if !status.success() {
            return Ok(());
        }
        Ok(())
    }

    #[tauri::command]
    fn save_autostart(autostart: bool) -> Result<AppConfig, String> {
        apply_autostart(autostart)?;
        let mut config = read_stored_config()?;
        config.autostart = autostart;
        write_stored_config(&config)?;
        to_app_config(config)
    }

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct BalanceResult {
        is_available: bool,
        currency: String,
        total_balance: String,
        granted_balance: String,
        topped_up_balance: String,
    }

    // 实时查询 DeepSeek 账户余额。DeepSeek 官方仅提供余额接口，无用量接口。
    #[tauri::command]
    async fn fetch_balance() -> Result<BalanceResult, String> {
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

    #[tauri::command]
    fn save_usage_token(usage_token: String) -> Result<AppConfig, String> {
        let value = usage_token.trim().to_string();
        if value.is_empty() {
            return Err("用量 Token 不能为空".to_string());
        }
        let mut config = read_stored_config()?;
        config.usage_token = Some(value);
        write_stored_config(&config)?;
        to_app_config(config)
    }

    #[tauri::command]
    fn clear_usage_token() -> Result<AppConfig, String> {
        let mut config = read_stored_config()?;
        config.usage_token = None;
        write_stored_config(&config)?;
        to_app_config(config)
    }

    const USAGE_TOKEN_TITLE_PREFIX: &str = "DSM_USAGE_TOKEN:";

    fn capture_usage_token(app: &tauri::AppHandle, token: String) -> Result<AppConfig, String> {
        let value = token.trim().to_string();
        if value.is_empty() {
            return Err("用量 Token 为空".to_string());
        }
        let mut config = read_stored_config()?;
        config.usage_token = Some(value);
        write_stored_config(&config)?;
        let app_config = to_app_config(config)?;

        // 标记本次同步已成功，避免 watcher 在窗口关闭后误发"结束等待"事件
        if let Some(flag) = app.try_state::<Arc<AtomicBool>>() {
            flag.store(true, Ordering::SeqCst);
        }

        if let Some(window) = app.get_webview_window("login-sync") {
            let _ = window.close();
        }

        let _ = app.emit("usage-token-captured", &app_config);

        Ok(app_config)
    }

    // 用 token 试调平台用量接口，验证它确实是有效的用量 token。
    async fn verify_usage_token(token: &str, month: u32, year: u32) -> Result<(), String> {
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

    fn read_shared_text(path: &Path) -> Option<String> {
        let mut file = fs::OpenOptions::new()
            .read(true)
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

    fn find_webview_cached_usage_token() -> Option<String> {
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

    fn start_usage_title_watcher(app: tauri::AppHandle) {
        thread::spawn(move || {
            // 登录页加载并触发平台 API 请求需要时间，等待后再开始扫缓存
            thread::sleep(Duration::from_secs(3));
            for _ in 0..1200 {
                if let Some(token) = find_webview_cached_usage_token() {
                    let _ = capture_usage_token(&app, token);
                    return;
                }

                let Some(window) = app.get_webview_window("login-sync") else {
                    // 窗口已关闭：若不是因成功捕获而关闭，才通知前端结束等待
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
                        // 注入脚本写入的格式：{year}:{month}:{token}
                        let mut parts = rest.splitn(3, ':');
                        if let (Some(y), Some(m), Some(tok)) =
                            (parts.next(), parts.next(), parts.next())
                        {
                            if let (Ok(year), Ok(month)) = (y.parse::<u32>(), m.parse::<u32>()) {
                                let token = tok.to_string();
                                // 验证 token 真能调用用量接口，过滤登录中途的临时 token
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
            // 30 分钟超时，若仍未成功则通知前端结束等待
            let captured = app
                .try_state::<Arc<AtomicBool>>()
                .map(|flag| flag.load(Ordering::SeqCst))
                .unwrap_or(false);
            if !captured {
                let _ = app.emit("usage-sync-ended", ());
            }
        });
    }

    // 在登录窗口注入，hook fetch / XMLHttpRequest，主动从平台 API 请求的
    // Authorization 头里抓 Bearer token。登录后页面自动调 API 即可即时捕获，
    // 不再依赖 WebView2 磁盘缓存的延迟落盘。
    const USAGE_SYNC_POLL_JS: &str = r#"
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
        // 主通道：写入 document.title，原生侧 window.title() 读取。
        // 外部网站窗口默认不注入 __TAURI__，此通道不依赖它，最可靠。
        try { document.title = 'DSM_USAGE_TOKEN:' + y + ':' + m + ':' + token; } catch (e) {}
        // 辅通道：若本窗口恰好可用 __TAURI__，直接上报更快
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

    #[tauri::command]
    async fn start_usage_sync(app: tauri::AppHandle) -> Result<bool, String> {
        // 重置本次同步的成功标志
        if let Some(flag) = app.try_state::<Arc<AtomicBool>>() {
            flag.store(false, Ordering::SeqCst);
        }

        // 先扫一次缓存：登录完成后重复点击本命令，缓存落盘后即可命中
        if let Some(token) = find_webview_cached_usage_token() {
            capture_usage_token(&app, token)?;
            return Ok(true);
        }

        // 登录窗口已存在：刷新它，促使用量页重新请求接口、把响应写入缓存，
        // 用户随后再点一次本按钮即可命中。不重复弹新窗口、不死等。
        if app.get_webview_window("login-sync").is_some() {
            if let Some(window) = app.get_webview_window("login-sync") {
                let _ = window.eval("location.reload();");
            }
            return Ok(false);
        }

        let url = tauri::WebviewUrl::External("https://platform.deepseek.com".parse().unwrap());
        tauri::WebviewWindowBuilder::new(
            &app,
            "login-sync",
            url,
        )
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
                // 双保险：万一 initialization_script 未注入，页面加载完再装一次 hook
                let _ = window.eval(USAGE_SYNC_POLL_JS);
            }
        })
        .build()
        .map_err(|error| format!("打开登录窗口失败：{error}"))?;
        start_usage_title_watcher(app);
        Ok(false)
    }

    #[tauri::command]
    async fn usage_token_captured(
        app: tauri::AppHandle,
        token: String,
        month: u32,
        year: u32,
    ) -> Result<AppConfig, String> {
        let value = token.trim().to_string();
        if value.is_empty() {
            return Err("用量 Token 为空".to_string());
        }
        // 先验证再保存：拦截到的 token 可能是登录中途的临时 token，
        // 只有能真正调用用量接口的才接受
        verify_usage_token(&value, month, year).await?;
        capture_usage_token(&app, value)
    }

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct UsageModelSummary {
        key: String,
        name: String,
        total_tokens: u64,
        request_count: u64,
        cache_hit_tokens: u64,
        cache_miss_tokens: u64,
        response_tokens: u64,
        cost: f64,
    }

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct UsageDaySummary {
        date: String,
        flash_tokens: u64,
        flash_cache_hit: u64,
        flash_cache_miss: u64,
        flash_response: u64,
        pro_tokens: u64,
        pro_cache_hit: u64,
        pro_cache_miss: u64,
        pro_response: u64,
        total_tokens: u64,
        total_cost: f64,
    }

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct UsageResult {
        models: Vec<UsageModelSummary>,
        days: Vec<UsageDaySummary>,
        month_cost: f64,
    }

    // 通过 DeepSeek 平台内部接口拉取用量与费用（需网页登录 token，非官方 API Key）。
    #[tauri::command]
    async fn fetch_usage(month: u32, year: u32) -> Result<UsageResult, String> {
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
            // 返回 (总 token, 请求数, 缓存命中, 缓存未命中, 输出 token)
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

    #[tauri::command]
    fn set_provider(provider: String) -> Result<AppConfig, String> {
        if provider != "deepseek" && provider != "mimo" {
            return Err("无效的 provider，仅支持 deepseek 或 mimo".to_string());
        }
        let mut config = read_stored_config()?;
        config.provider = provider;
        write_stored_config(&config)?;
        to_app_config(config)
    }

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct MimoBalanceResult {
        available_balance: String,
        currency: String,
        total_consumption: String,
        monthly_expense: String,
    }

    #[tauri::command]
    fn ensure_mimo_webview_sync(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
        if let Some(window) = app.get_webview_window("mimo-sync") {
            return Ok(window);
        }
        let url = tauri::WebviewUrl::External(
            "https://platform.xiaomimimo.com/console/balance".parse().unwrap(),
        );
        tauri::WebviewWindowBuilder::new(app, "mimo-sync", url)
            .title("小米 MiMo 控制台")
            .inner_size(480.0, 720.0)
            .min_inner_size(360.0, 480.0)
            .resizable(true)
            .center()
            .visible(false)
            // 关键：在每个页面加载时注入 fetch/XHR hook，确保 SPA 的 API 请求被拦截
            .on_page_load(|window, _payload| {
                let _ = window.eval(r#"
                    (function() {
                        if (window.__mimo_hooked) return;
                        window.__mimo_ph = null;
                        window.__mimo_detail = null;
                        const __of = window.fetch;
                        window.fetch = function() {
                            const u = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0]?.url || '');
                            if (u.includes('api-platform_ph=')) {
                                const m = u.match(/api-platform_ph=([^&]+)/);
                                if (m) { window.__mimo_ph = decodeURIComponent(m[1]); try { localStorage.setItem('mimo_platform_ph', window.__mimo_ph); } catch(e) {} }
                                if (u.includes('/usage/detail/list')) {
                                    return __of.apply(this, arguments).then(async r => { try { window.__mimo_detail = await r.clone().text(); } catch(e) {} return r; });
                                }
                            }
                            return __of.apply(this, arguments);
                        };
                        const __oo = XMLHttpRequest.prototype.open;
                        const __os = XMLHttpRequest.prototype.send;
                        XMLHttpRequest.prototype.open = function(m, u) { this.__mu = u; return __oo.apply(this, arguments); };
                        XMLHttpRequest.prototype.send = function() {
                            const u = this.__mu || '';
                            if (u.includes('api-platform_ph=')) {
                                const m = u.match(/api-platform_ph=([^&]+)/);
                                if (m) { window.__mimo_ph = decodeURIComponent(m[1]); try { localStorage.setItem('mimo_platform_ph', window.__mimo_ph); } catch(e) {} }
                                if (u.includes('/usage/detail/list')) this.addEventListener('load', function() { window.__mimo_detail = this.responseText; });
                            }
                            return __os.apply(this, arguments);
                        };
                        window.__mimo_hooked = true;
                    })();
                "#);
            })
            .build()
            .map_err(|error| format!("打开 MiMo 页面失败：{error}"))
    }

    async fn fetch_mimo_api(
        app: &tauri::AppHandle,
        path: &str,
        timeout_secs: u64,
    ) -> Result<String, String> {
        fetch_mimo_api_with_method(app, path, "GET", timeout_secs).await
    }

    async fn fetch_mimo_api_with_method(
        app: &tauri::AppHandle,
        path: &str,
        method: &str,
        timeout_secs: u64,
    ) -> Result<String, String> {
        use tiny_http::{Header, Method, Response, Server};

        // 串行化 webview 访问，防止并发 eval 互相干扰
        let lock_guard = app.state::<Arc<tokio::sync::Mutex<()>>>();
        let _lock = lock_guard.lock().await;

        let window = ensure_mimo_webview_sync(app)?;

        // 生成唯一请求 ID
        let req_id = format!(
            "__mimo_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );

        // 创建 oneshot 通道
        let (tx, rx) = oneshot::channel();
        {
            let state =
                app.state::<Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>>();
            let mut map = state.lock().unwrap();
            map.insert(req_id.clone(), tx);
        }

        // 启动本地 HTTP 服务器线程（接收 JS 回传的数据）
        let port = Arc::new(AtomicU16::new(0));
        let port_clone = Arc::clone(&port);
        let shared_map = {
            let state =
                app.state::<Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>>();
            Arc::clone(&state)
        };
        let _server_thread = std::thread::spawn(move || {
            let server = match Server::http("127.0.0.1:0") {
                Ok(s) => s,
                Err(_) => return,
            };
            if let Some(addr) = server.server_addr().to_ip() {
                port_clone.store(addr.port(), Ordering::SeqCst);
            } else {
                return;
            }

            // 处理 OPTIONS 预检 + POST
            for _ in 0..2 {
                if let Ok(mut request) = server.recv() {
                    if *request.method() == Method::Options {
                        let response = Response::from_string(String::new())
                            .with_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap())
                            .with_header(Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"POST, OPTIONS"[..]).unwrap())
                            .with_header(Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Content-Type"[..]).unwrap());
                        let _ = request.respond(response);
                    } else {
                        let mut body = String::new();
                        let _ = request.as_reader().read_to_string(&mut body);
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&body) {
                            if let (Some(rid), Some(data)) = (
                                parsed.get("reqId").and_then(|v| v.as_str()),
                                parsed.get("data").and_then(|v| v.as_str()),
                            ) {
                                let mut map = shared_map.lock().unwrap();
                                if let Some(tx) = map.remove(rid) {
                                    let _ = tx.send(data.to_string());
                                }
                            }
                        }
                        let response = Response::from_string("OK".to_string())
                            .with_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap());
                        let _ = request.respond(response);
                        break;
                    }
                }
            }
        });

        // 等待服务器启动
        let start = std::time::Instant::now();
        let actual_port = loop {
            let p = port.load(Ordering::SeqCst);
            if p != 0 { break p; }
            if start.elapsed() > std::time::Duration::from_secs(5) {
                return Err("HTTP 服务器启动超时".to_string());
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        };

        // 关键改进：用 JS fetch 直接调用 API（不导航 WebView，利用已有 cookie）
        let api_url = format!("https://platform.xiaomimimo.com{}", path);
        let js = format!(
            r#"(async function() {{
                try {{
                    var r = await fetch('{url}', {{
                        method: '{method}',
                        credentials: 'include',
                        headers: {{ 'Accept': 'application/json' }}
                    }});
                    var t = await r.text();
                    fetch('http://127.0.0.1:{port}/mimo-callback', {{
                        method: 'POST',
                        mode: 'cors',
                        headers: {{ 'Content-Type': 'application/json' }},
                        body: JSON.stringify({{ reqId: '{req_id}', data: t }})
                    }});
                }} catch(e) {{
                    fetch('http://127.0.0.1:{port}/mimo-callback', {{
                        method: 'POST',
                        mode: 'cors',
                        headers: {{ 'Content-Type': 'application/json' }},
                        body: JSON.stringify({{ reqId: '{req_id}', data: 'ERROR:' + e.message }})
                    }});
                }}
            }})()"#,
            url = api_url,
            method = method,
            port = actual_port,
            req_id = req_id,
        );
        window.eval(&js).map_err(|e| format!("注入脚本失败：{e}"))?;

        // 等待数据回传
        let timeout = std::time::Duration::from_secs(timeout_secs);
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(data)) => {
                if data.starts_with("ERROR:") {
                    return Err(format!("MiMo API 请求失败：{}", &data[6..]));
                }
                if data.is_empty() || data.starts_with('<') {
                    return Err("MiMo API 返回为空或 HTML，请确认已登录".to_string());
                }
                // 检查 401 → 显示登录窗口
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&data) {
                    if val.get("code").and_then(|v| v.as_i64()) == Some(401) {
                        // 显示 WebView 窗口让用户登录
                        if let Some(w) = app.get_webview_window("mimo-sync") {
                            let _ = w.show();
                            let _ = w.set_focus();
                            // 导航到登录页
                            let login_url = val.get("loginUrl").and_then(|v| v.as_str())
                                .or_else(|| val.get("data").and_then(|d| d.get("loginUrl")).and_then(|v| v.as_str()));
                            if let Some(url) = login_url {
                                let _ = w.eval(&format!("window.location.href='{}'", url.replace('\'', "\\'")));
                            } else {
                                let _ = w.eval("window.location.href='https://account.xiaomi.com/pass/serviceLogin?sid=platform.xiaomimimo.com'");
                            }
                        }
                        let _ = app.emit("mimo-auth-required", ());
                        return Err("MiMo 未登录，请在弹出的窗口中完成登录后重试".to_string());
                    }
                }
                Ok(data)
            }
            Ok(Err(_)) => Err("数据接收通道关闭".to_string()),
            Err(_) => {
                let state = app.state::<Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>>();
                let mut map = state.lock().unwrap();
                map.remove(&req_id);
                Err("MiMo API 请求超时".to_string())
            }
        }
    }

    fn parse_mimo_api_response<T: serde::de::DeserializeOwned>(json: &str) -> Result<T, String> {
        #[derive(Deserialize)]
        struct ApiEnvelope<T2> {
            code: i32,
            #[serde(default)]
            #[allow(dead_code)]
            message: String,
            data: Option<T2>,
        }
        let envelope: ApiEnvelope<T> =
            serde_json::from_str(json).map_err(|e| format!("解析响应失败：{e}"))?;
        if envelope.code != 0 {
            return Err(format!("MiMo API 返回错误 code={}: {}", envelope.code, envelope.message));
        }
        envelope.data.ok_or_else(|| "MiMo API 返回空数据".to_string())
    }

    #[tauri::command]
    async fn fetch_mimo_balance(app: tauri::AppHandle) -> Result<MimoBalanceResult, String> {
        let json = fetch_mimo_api(&app, "/api/v1/balance", 15).await?;
        log::info!("[MiMo] /api/v1/balance raw: {}", &json[..json.len().min(2000)]);

        // 尝试解析为原始余额格式
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
            log::info!("[MiMo] balance V1 parsed: cash_balance={} currency={}", data.cash_balance, data.currency);
            return Ok(MimoBalanceResult {
                available_balance: data.cash_balance,
                currency: if data.currency.is_empty() { "CNY".to_string() } else { data.currency },
                total_consumption: "—".to_string(),
                monthly_expense: "—".to_string(),
            });
        }
        log::info!("[MiMo] balance V1 parse failed, trying AccountOverview");

        // 新格式：账户概览（包含 costUsage）
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
                log::info!("[MiMo] balance AccountOverview parsed: total_cost={} month_cost={}", cost.total_cost, cost.current_month_cost);
                return Ok(MimoBalanceResult {
                    available_balance: cost.total_cost.clone(),
                    currency: "CNY".to_string(),
                    total_consumption: cost.total_cost,
                    monthly_expense: cost.current_month_cost,
                });
            }
        }
        log::info!("[MiMo] balance AccountOverview parse also failed");

        Err("无法解析 MiMo 余额接口返回的数据".to_string())
    }

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct MimoUsageModel {
        key: String,
        name: String,
        total_tokens: u64,
        request_count: u64,
        cache_hit_tokens: u64,
        cache_miss_tokens: u64,
        response_tokens: u64,
        cost: f64,
    }

    #[derive(Debug, Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct MimoUsageDayModel {
        key: String,
        total_tokens: u64,
        cache_hit_tokens: u64,
        cache_miss_tokens: u64,
        response_tokens: u64,
        total_cost: f64,
    }

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct MimoUsageDay {
        date: String,
        total_tokens: u64,
        total_cost: f64,
        models: Vec<MimoUsageDayModel>,
    }

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct MimoUsageResult {
        models: Vec<MimoUsageModel>,
        days: Vec<MimoUsageDay>,
        month_cost: f64,
    }
    #[tauri::command]
    async fn fetch_mimo_usage(app: tauri::AppHandle, _month: u32, _year: u32) -> Result<MimoUsageResult, String> {
        // 先获取总用量概览
        let overview_json = fetch_mimo_api(&app, "/api/v1/usage", 15).await?;
        log::info!("[MiMo] /api/v1/usage raw: {}", &overview_json[..overview_json.len().min(2000)]);

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
        log::info!("[MiMo] overview parsed: token_usage={:?}, cost_usage={:?}",
            overview.token_usage.as_ref().map(|t| format!("input={} output={} cache={} total={}", t.input_token, t.output_token, t.cache_token, t.total_token)),
            overview.cost_usage.as_ref().map(|c| format!("total={} month={}", c.total_cost, c.current_month_cost)));
        let month_cost = overview.cost_usage.as_ref()
            .and_then(|c| c.current_month_cost.parse::<f64>().ok())
            .unwrap_or(0.0);

        // 尝试获取详细用量（按模型+日期分解）
        // 先检查缓存（5 分钟内有效），避免重复的 8 秒轮询
        let detail_items = {
            let cache = app.state::<Mutex<MimoDetailCache>>();
            let cached = cache.lock().unwrap().get(std::time::Duration::from_secs(300));
            match cached {
                Some(items) if !items.is_empty() => Some(items),
                Some(_) => None, // in_progress 标记，跳过
                None => {
                    // 尝试标记为 in_progress
                    let can_start = cache.lock().unwrap().mark_in_progress();
                    if !can_start {
                        log::info!("[MiMo] detail extraction already in progress, skipping");
                        return Ok(MimoUsageResult { models: vec![], days: vec![], month_cost });
                    }
                    match fetch_mimo_usage_detail(&app).await {
                        Ok(items) if !items.is_empty() => {
                            cache.lock().unwrap().set(items.clone());
                            Some(items)
                        }
                        _ => {
                            cache.lock().unwrap().clear_in_progress();
                            None
                        }
                    }
                }
            }
        };
        log::info!("[MiMo] detail_items count: {}", detail_items.as_ref().map(|v| v.len()).unwrap_or(0));
        if let Some(ref items) = detail_items {
            for (i, item) in items.iter().take(3).enumerate() {
                log::info!("[MiMo] detail[{}]: date={} model={} total_token={} input_hit={} input_miss={} output={} req_count={} cost={}",
                    i, item.date, item.model, item.total_token, item.input_hit_token, item.input_miss_token, item.output_token, item.request_count, item.consumed_amount);
            }
        }
        match detail_items {
            Some(items) if !items.is_empty() => {
                let mut models_map: std::collections::HashMap<String, MimoUsageModel> = std::collections::HashMap::new();
                let mut days_map: std::collections::HashMap<String, (MimoUsageDay, std::collections::HashMap<String, MimoUsageDayModel>)> = std::collections::HashMap::new();
                let mut detail_month_cost: f64 = 0.0;

                for item in &items {
                    let model_entry = models_map.entry(item.model.clone()).or_insert_with(|| MimoUsageModel {
                        key: item.model.clone(),
                        name: item.model.clone(),
                        total_tokens: 0, request_count: 0,
                        cache_hit_tokens: 0, cache_miss_tokens: 0,
                        response_tokens: 0, cost: 0.0,
                    });
                    model_entry.total_tokens += item.total_token;
                    model_entry.request_count += item.request_count;
                    model_entry.cache_hit_tokens += item.input_hit_token;
                    model_entry.cache_miss_tokens += item.input_miss_token;
                    model_entry.response_tokens += item.output_token;
                    model_entry.cost += item.consumed_amount.parse::<f64>().unwrap_or(0.0);

                    let (day_entry, day_models) = days_map.entry(item.date.clone()).or_insert_with(|| {
                        (MimoUsageDay { date: item.date.clone(), total_tokens: 0, total_cost: 0.0, models: vec![] },
                         std::collections::HashMap::new())
                    });
                    day_entry.total_tokens += item.total_token;
                    day_entry.total_cost += item.consumed_amount.parse::<f64>().unwrap_or(0.0);
                    let day_model = day_models.entry(item.model.clone()).or_insert_with(|| MimoUsageDayModel {
                        key: item.model.clone(), total_tokens: 0, cache_hit_tokens: 0, cache_miss_tokens: 0, response_tokens: 0, total_cost: 0.0,
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
                let result = MimoUsageResult { models, days, month_cost: if detail_month_cost > 0.0 { detail_month_cost } else { month_cost } };
                log::info!("[MiMo] usage result (detail): {} models, {} days, month_cost={}", result.models.len(), result.days.len(), result.month_cost);
                for m in &result.models {
                    log::info!("[MiMo]   model: key={} tokens={} cost={}", m.key, m.total_tokens, m.cost);
                }
                for d in &result.days {
                    log::info!("[MiMo]   day: date={} tokens={} cost={} models={}", d.date, d.total_tokens, d.total_cost, d.models.len());
                }
                Ok(result)
            }
            _ => {
                // fallback：总用量概览（detail API 不可用时）
                log::info!("[MiMo] detail API unavailable, using overview fallback");
                let mut models = Vec::new();
                if let Some(tokens) = &overview.token_usage {
                    // 从 overview 中按模型拆分：假设 V2.5 Pro 使用了全部（因为我们不知道真实分布）
                    // 显示两个模型行，V2.5 Pro 有数据，V2.5 为空（与 DeepSeek 的 flash/pro 显示规则一致）
                    if tokens.input_token > 0 {
                        models.push(MimoUsageModel {
                            key: "mimo-v2.5-pro".to_string(), name: "MiMo-V2.5-Pro".to_string(),
                            total_tokens: tokens.input_token + tokens.output_token, request_count: 0,
                            cache_hit_tokens: tokens.cache_token, cache_miss_tokens: tokens.input_token.saturating_sub(tokens.cache_token),
                            response_tokens: tokens.output_token, cost: 0.0,
                        });
                    }
                }
                // 不合成假的当日数据点（避免用月度成本冒充日度成本）
                Ok(MimoUsageResult { models, days: vec![], month_cost })
            }
        }
    }

    #[derive(Debug, Deserialize, Clone)]
    #[serde(rename_all = "camelCase")]
    struct UsageDetailItem {
        #[serde(default)]
        date: String,
        #[serde(default)]
        model: String,
        #[serde(default)]
        total_token: u64,
        #[serde(default)]
        input_hit_token: u64,
        #[serde(default)]
        input_miss_token: u64,
        #[serde(default)]
        output_token: u64,
        #[serde(default)]
        request_count: u64,
        #[serde(default)]
        consumed_amount: String,
    }

    async fn fetch_mimo_usage_detail(app: &tauri::AppHandle) -> Result<Vec<UsageDetailItem>, String> {
        // 1. 先用缓存的 ph 尝试直接调用 API（快速路径）
        {
            let config = read_stored_config()?;
            if let Some(ref ph) = config.mimo_ph {
                log::info!("[MiMo] detail: trying cached ph={}", &ph[..ph.len().min(20)]);
                let api_url = format!("/api/v1/usage/detail/list?api-platform_ph={}", ph);
                if let Ok(json) = fetch_mimo_api_with_method(app, &api_url, "POST", 10).await {
                    log::info!("[MiMo] detail fast-path response (first 500): {}", &json[..json.len().min(500)]);
                    if let Ok(items) = parse_detail_items(&json) {
                        if !items.is_empty() {
                            log::info!("[MiMo] detail fast-path OK: {} items", items.len());
                            return Ok(items);
                        }
                    }
                } else {
                    log::warn!("[MiMo] detail fast-path API call failed");
                }
                log::info!("[MiMo] detail fast-path failed, falling back to page extraction");
            }
        }

        // 2. 缓存的 ph 失效或不存在 → 导航到用量页面
        // on_page_load hook（在 ensure_mimo_webview_sync 中注册）会在 SPA 脚本运行前注入
        // SPA 的 detail API 请求会被 hook 拦截，__mimo_detail 和 __mimo_ph 会被设置
        use tiny_http::{Header, Method, Response, Server};

        let lock_guard = app.state::<Arc<tokio::sync::Mutex<()>>>();
        let _lock = lock_guard.lock().await;

        let window = ensure_mimo_webview_sync(app)?;

        // 启动本地 HTTP 服务器（用于读取 JS 上下文中的值）
        let poll_port = Arc::new(AtomicU16::new(0));
        let poll_port_clone = Arc::clone(&poll_port);
        let poll_map = {
            let state = app.state::<Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>>();
            Arc::clone(&state)
        };
        let _poll_server = std::thread::spawn(move || {
            let server = match Server::http("127.0.0.1:0") { Ok(s) => s, Err(_) => return };
            if let Some(addr) = server.server_addr().to_ip() { poll_port_clone.store(addr.port(), Ordering::SeqCst); } else { return; }
            while let Ok(Some(mut request)) = server.recv_timeout(std::time::Duration::from_secs(20)) {
                if *request.method() == Method::Options {
                    let response = Response::from_string(String::new())
                        .with_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap())
                        .with_header(Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"POST, OPTIONS"[..]).unwrap())
                        .with_header(Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Content-Type"[..]).unwrap());
                    let _ = request.respond(response);
                } else {
                    let mut body = String::new();
                    let _ = request.as_reader().read_to_string(&mut body);
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&body) {
                        if let (Some(rid), Some(data)) = (parsed.get("reqId").and_then(|v| v.as_str()), parsed.get("data").and_then(|v| v.as_str())) {
                            let mut map = poll_map.lock().unwrap();
                            if let Some(tx) = map.remove(rid) { let _ = tx.send(data.to_string()); }
                        }
                    }
                    let response = Response::from_string("OK")
                        .with_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap());
                    let _ = request.respond(response);
                }
            }
        });

        let server_start = std::time::Instant::now();
        let poll_port_val = loop {
            let p = poll_port.load(Ordering::SeqCst);
            if p != 0 { break p; }
            if server_start.elapsed() > std::time::Duration::from_secs(3) { return Err("HTTP 服务器启动超时".to_string()); }
            std::thread::sleep(std::time::Duration::from_millis(10));
        };

        // 导航到用量页面（on_page_load hook 会自动注入）
        log::info!("[MiMo] detail: navigating to usage page (on_page_load hook active)");
        let _ = window.eval("window.__mimo_detail = null; window.__mimo_ph = null;");
        let usage_url: tauri::Url = "https://platform.xiaomimimo.com/console/usage"
            .parse()
            .map_err(|_| "无效 URL".to_string())?;
        let _ = window.navigate(usage_url);

        // 轮询 window.__mimo_detail（hook 在 SPA 发出 detail API 请求时会设置它）
        // 如果 401，会显示窗口让用户登录，然后继续等待
        let start = std::time::Instant::now();
        while start.elapsed() < std::time::Duration::from_secs(120) {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;

            let req_id = format!("__chk_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
            let (tx, rx) = oneshot::channel();
            {
                let state = app.state::<Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>>();
                let mut map = state.lock().unwrap();
                map.insert(req_id.clone(), tx);
            }

            // 检查 __mimo_detail 是否已被 hook 设置
            let check_js = format!(
                r#"try{{(async()=>{{
                    var d=window.__mimo_detail||null;
                    var ph=window.__mimo_ph||localStorage.getItem('mimo_platform_ph')||null;
                    if(d){{
                        fetch('http://127.0.0.1:{port}/mimo-callback',{{method:'POST',mode:'cors',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{reqId:'{req_id}',data:d}})}});
                    }} else if(ph){{
                        // 有 ph 但没有 detail，手动调用
                        try{{var u='https://platform.xiaomimimo.com/api/v1/usage/detail/list?api-platform_ph='+encodeURIComponent(ph);var r=await fetch(u,{{method:'POST',credentials:'include',headers:{{'Accept':'application/json'}}}});var t=await r.text();fetch('http://127.0.0.1:{port}/mimo-callback',{{method:'POST',mode:'cors',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{reqId:'{req_id}',data:t}})}});}}catch(e){{fetch('http://127.0.0.1:{port}/mimo-callback',{{method:'POST',mode:'cors',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{reqId:'{req_id}',data:'ERR:'+e.message}})}});}}
                    }} else {{
                        fetch('http://127.0.0.1:{port}/mimo-callback',{{method:'POST',mode:'cors',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{reqId:'{req_id}',data:'WAITING'}})}});
                    }}
                }})()}}catch(e){{fetch('http://127.0.0.1:{port}/mimo-callback',{{method:'POST',mode:'cors',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{reqId:'{req_id}',data:'EXC:'+e.message}})}});}}"#,
                port = poll_port_val, req_id = req_id,
            );
            let _ = window.eval(&check_js);

            if let Ok(Ok(data)) = tokio::time::timeout(std::time::Duration::from_secs(5), rx).await {
                log::info!("[MiMo] detail check (first 200): {}", &data[..data.len().min(200)]);
                if data == "WAITING" {
                    log::info!("[MiMo] detail: waiting for hook to capture data...");
                    continue;
                } else if data.starts_with("ERR:") || data.starts_with("EXC:") {
                    log::warn!("[MiMo] detail error: {}", data);
                    continue;
                } else if data.contains("\"code\":401") {
                    // 401 → 需要登录。显示窗口让用户登录，SPA 会自动重定向到登录页
                    log::info!("[MiMo] detail: 401 detected, showing login window");
                    if let Some(w) = app.get_webview_window("mimo-sync") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                    let _ = app.emit("mimo-auth-required", ());
                    // 继续轮询 — 用户登录后 SPA 会重定向回用量页面，hook 会捕获数据
                    continue;
                } else if !data.is_empty() && !data.starts_with('<') {
                    if let Ok(items) = parse_detail_items(&data) {
                        if !items.is_empty() {
                            log::info!("[MiMo] detail OK: {} items", items.len());
                            // 缓存 ph
                            let ph_req = format!("__ph_{}", req_id);
                            let (ptx, prx) = oneshot::channel();
                            {
                                let state = app.state::<Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>>();
                                let mut map = state.lock().unwrap();
                                map.insert(ph_req.clone(), ptx);
                            }
                            let _ = window.eval(&format!(
                                r#"try{{var p=window.__mimo_ph||localStorage.getItem('mimo_platform_ph')||'';fetch('http://127.0.0.1:{port}/mimo-callback',{{method:'POST',mode:'cors',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{reqId:'{ph_req}',data:p}})}});}}catch(e){{}}"#,
                                port = poll_port_val, ph_req = ph_req,
                            ));
                            if let Ok(Ok(ph_val)) = tokio::time::timeout(std::time::Duration::from_secs(2), prx).await {
                                if !ph_val.is_empty() {
                                    if let Ok(mut config) = read_stored_config() {
                                        config.mimo_ph = Some(ph_val);
                                        let _ = write_stored_config(&config);
                                    }
                                }
                            }
                            return Ok(items);
                        }
                    }
                }
            }
        }

        Err("无法获取用量详情，请确认已登录 MiMo".to_string())
    }

    fn parse_detail_items(json: &str) -> Result<Vec<UsageDetailItem>, String> {
        // Log the raw JSON for debugging field name mismatches
        log::info!("[MiMo] parse_detail_items raw (first 1000): {}", &json[..json.len().min(1000)]);
        #[derive(Deserialize)]
        struct R { #[serde(default)] code: i32, #[serde(default)] data: Option<Vec<UsageDetailItem>> }
        let r: R = serde_json::from_str(json).map_err(|e| {
            log::warn!("[MiMo] parse_detail_items error: {}", e);
            e.to_string()
        })?;
        if r.code != 0 { return Err(format!("code={}", r.code)); }
        let items = r.data.unwrap_or_default();
        if let Some(first) = items.first() {
            log::info!("[MiMo] parse_detail_items first item: {:?}", first);
        }
        Ok(items)
    }

    // 通过保持 webview 窗口打开，从 SPA 页面的 DOM 提取数据（因为 HttpOnly Cookie 无法从 JS 读取）。
    // Webview 共享同一域名的 cookie，嵌入 JS 通过 fetch + credentials: 'include' 发送请求。

    #[tauri::command]
    async fn start_mimo_sync(app: tauri::AppHandle) -> Result<bool, String> {
        if let Some(window) = app.get_webview_window("mimo-sync") {
            // 窗口已存在（可能隐藏），显示并聚焦
            let _ = window.show();
            let _ = window.set_focus();
            return Ok(true);
        }
        // 创建窗口（默认隐藏），然后显示
        let window = ensure_mimo_webview_sync(&app)?;
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit("mimo-sync-started", ());
        Ok(false)
    }

    #[tauri::command]
    async fn ensure_mimo_webview(app: tauri::AppHandle) -> Result<(), String> {
        ensure_mimo_webview_sync(&app).map(|_| ())
    }

    #[tauri::command]
    fn mimo_api_response(
        app: tauri::AppHandle,
        req_id: String,
        json: String,
    ) -> Result<(), String> {
        let state = app.state::<Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>>();
        let mut map = state.lock().unwrap();
        if let Some(tx) = map.remove(&req_id) {
            let _ = tx.send(json);
        }
        Ok(())
    }

    tauri::Builder::default()
        // 单实例守卫：必须作为第一个注册的插件。
        // 程序已运行时再次启动 exe，第二个进程不会新开窗口，
        // 而是触发此回调把已有主窗口显示并聚焦，随后第二个进程自行退出。
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                show_main_window(&window);
            }
        }))
        .manage(Arc::new(AtomicBool::new(false)))
        .manage(Arc::new(Mutex::new(HashMap::<
            String,
            oneshot::Sender<String>,
        >::new())))
        .manage(Arc::new(tokio::sync::Mutex::new(())))
        .manage(Mutex::new(MimoDetailCache::new()))
        .invoke_handler(tauri::generate_handler![
            hide_main_window,
            get_app_config,
            save_api_key,
            clear_api_key,
            save_refresh_interval,
            save_auto_refresh_enabled,
            save_autostart,
            set_provider,
            fetch_balance,
            save_usage_token,
            clear_usage_token,
            fetch_usage,
            start_usage_sync,
            usage_token_captured,
            fetch_mimo_balance,
            fetch_mimo_usage,
            start_mimo_sync,
            ensure_mimo_webview,
            mimo_api_response
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let show_item = MenuItem::with_id(app, "show", "显示主面板", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            show_main_window(&window);
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // 仅在左键“抬起”时切换；否则按下+抬起各触发一次，窗口会闪现后立即隐藏
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = window.hide();
                            } else {
                                show_main_window(&window);
                            }
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            tray_builder.build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
