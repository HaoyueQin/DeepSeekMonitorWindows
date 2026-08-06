//! DeepSeek / MiMo Monitor Windows — Tauri 入口
//!
//! 职责：模块声明、Tauri 命令注册、Builder 配置。
//! 具体业务逻辑分散在 modules/ 子模块中。

mod modules;
use modules::{
    config, deepseek, mimo, tray,
    types::{
        AppConfig, BalanceHistoryEntry, BalanceResult, CallbackServerPort, MimoBalanceResult,
        MimoDetailCache, MimoUsageResult, UsageResult,
    },
};

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tokio::sync::oneshot;

use tauri::{Manager, WebviewWindow};

// ─── Callback Server（持久化 tiny_http）───────────────────

struct CallbackServer {
    port: u16,
}

impl CallbackServer {
    fn start(shared_map: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>) -> std::io::Result<Self> {
        use tiny_http::{Header, Method, Response, Server};
        let server = Server::http("127.0.0.1:0").map_err(|e| std::io::Error::new(std::io::ErrorKind::AddrNotAvailable, format!("无法启动回调服务器：{e}")))?;
        let port = server.server_addr().to_ip().ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "回调服务器地址无效"))?.port();
        std::thread::spawn(move || {
            while let Ok(Some(mut request)) =
                server.recv_timeout(std::time::Duration::from_secs(3600))
            {
                if *request.method() == Method::Options {
                    let response = Response::from_string(String::new())
                        .with_header(
                            Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..])
                                .unwrap(),
                        )
                        .with_header(
                            Header::from_bytes(
                                &b"Access-Control-Allow-Methods"[..],
                                &b"POST, OPTIONS"[..],
                            )
                            .unwrap(),
                        )
                        .with_header(
                            Header::from_bytes(
                                &b"Access-Control-Allow-Headers"[..],
                                &b"Content-Type"[..],
                            )
                            .unwrap(),
                        );
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
                    let response = Response::from_string("OK").with_header(
                        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
                    );
                    let _ = request.respond(response);
                }
            }
        });
        Ok(CallbackServer { port })
    }
}

// ─── Tauri 命令 ──────────────────────────────────────────

#[tauri::command]
fn hide_main_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn resize_window(window: WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    use tauri::{LogicalSize, PhysicalPosition};

    // 当前右下角（物理像素）
    let old_pos = window.outer_position().map_err(|e| e.to_string())?;
    let old_size = window.outer_size().map_err(|e| e.to_string())?;
    let old_right = old_pos.x + old_size.width as i32;
    let old_bottom = old_pos.y + old_size.height as i32;

    // 逻辑像素设置大小
    window.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())?;

    // 读取新物理尺寸，锚定右下角
    let new_size = window.outer_size().map_err(|e| e.to_string())?;
    let new_x = (old_right - new_size.width as i32).max(0);
    let new_y = (old_bottom - new_size.height as i32).max(0);
    window.set_position(PhysicalPosition::new(new_x, new_y)).map_err(|e| e.to_string())?;

    // 保存窗口状态
    let _ = save_window_state(&window);
    Ok(())
}

/// 保存窗口大小和位置到配置
fn save_window_state(window: &WebviewWindow) -> Result<(), String> {
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let scale = window.current_monitor().ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
    // 转为逻辑像素保存
    let logical_w = size.width as f64 / scale;
    let logical_h = size.height as f64 / scale;

    let mut config = config::read_stored_config()?;
    config.window_width = Some(logical_w);
    config.window_height = Some(logical_h);
    config.window_x = Some(pos.x);
    config.window_y = Some(pos.y);
    Ok(config::write_stored_config(&config)?)
}

#[tauri::command]
fn get_app_config() -> Result<AppConfig, String> {
    Ok(config::to_app_config(config::read_stored_config()?)?)
}

#[tauri::command]
fn save_api_key(api_key: String) -> Result<AppConfig, String> {
    Ok(deepseek::do_save_api_key(api_key)?)
}

#[tauri::command]
fn clear_api_key() -> Result<AppConfig, String> {
    Ok(deepseek::do_clear_api_key()?)
}

#[tauri::command]
fn save_refresh_interval(refresh_interval_seconds: u64) -> Result<AppConfig, String> {
    let mut config = config::read_stored_config()?;
    config.refresh_interval_seconds = refresh_interval_seconds;
    config::write_stored_config(&config)?;
    Ok(config::to_app_config(config)?)
}

#[tauri::command]
fn save_auto_refresh_enabled(auto_refresh_enabled: bool) -> Result<AppConfig, String> {
    let mut config = config::read_stored_config()?;
    config.auto_refresh_enabled = auto_refresh_enabled;
    config::write_stored_config(&config)?;
    Ok(config::to_app_config(config)?)
}

#[tauri::command]
fn save_autostart(autostart: bool) -> Result<AppConfig, String> {
    config::apply_autostart(autostart)?;
    let mut config = config::read_stored_config()?;
    config.autostart = autostart;
    config::write_stored_config(&config)?;
    Ok(config::to_app_config(config)?)
}

#[tauri::command]
fn save_low_balance_notify(enabled: bool) -> Result<AppConfig, String> {
    let mut config = config::read_stored_config()?;
    config.low_balance_notify = enabled;
    config::write_stored_config(&config)?;
    Ok(config::to_app_config(config)?)
}

#[tauri::command]
fn save_low_balance_threshold(threshold: f64) -> Result<AppConfig, String> {
    if !threshold.is_finite() || threshold < 0.0 {
        return Err("阈值必须为非负数".to_string());
    }
    let mut config = config::read_stored_config()?;
    config.low_balance_threshold = threshold;
    config::write_stored_config(&config)?;
    Ok(config::to_app_config(config)?)
}

#[tauri::command]
fn save_theme(theme: String) -> Result<AppConfig, String> {
    if !["light", "dark", "system"].contains(&theme.as_str()) {
        return Err("无效主题".to_string());
    }
    let mut config = config::read_stored_config()?;
    config.theme = theme;
    config::write_stored_config(&config)?;
    Ok(config::to_app_config(config)?)
}

#[tauri::command]
fn save_currency(currency: String) -> Result<AppConfig, String> {
    if !["cny", "usd"].contains(&currency.as_str()) {
        return Err("无效货币".to_string());
    }
    let mut config = config::read_stored_config()?;
    config.currency = currency;
    config::write_stored_config(&config)?;
    Ok(config::to_app_config(config)?)
}

#[tauri::command]
fn save_efficiency_unit(unit: String) -> Result<AppConfig, String> {
    if !["token_per_currency", "currency_per_token"].contains(&unit.as_str()) {
        return Err("无效效率单位".to_string());
    }
    let mut config = config::read_stored_config()?;
    config.efficiency_unit = unit;
    config::write_stored_config(&config)?;
    Ok(config::to_app_config(config)?)
}

#[tauri::command]
fn save_default_provider(provider: String) -> Result<AppConfig, String> {
    if !["deepseek", "mimo"].contains(&provider.as_str()) {
        return Err("无效平台".to_string());
    }
    let mut config = config::read_stored_config()?;
    config.default_provider = provider;
    config::write_stored_config(&config)?;
    Ok(config::to_app_config(config)?)
}

#[tauri::command]
fn save_mimo_refresh_interval(seconds: u64) -> Result<AppConfig, String> {
    let mut config = config::read_stored_config()?;
    config.mimo_refresh_interval_seconds = seconds;
    config::write_stored_config(&config)?;
    Ok(config::to_app_config(config)?)
}

#[tauri::command]
fn save_always_on_top(window: WebviewWindow, always_on_top: bool) -> Result<AppConfig, String> {
    window.set_always_on_top(always_on_top).map_err(|e| e.to_string())?;
    let mut config = config::read_stored_config()?;
    config.always_on_top = always_on_top;
    config::write_stored_config(&config)?;
    Ok(config::to_app_config(config)?)
}

#[tauri::command]
fn save_auto_clear_old_cache(enabled: bool) -> Result<AppConfig, String> {
    let mut config = config::read_stored_config()?;
    config.auto_clear_old_cache = enabled;
    config::write_stored_config(&config)?;
    Ok(config::to_app_config(config)?)
}

#[tauri::command]
fn save_notify_cooldown(minutes: u64) -> Result<AppConfig, String> {
    let mut config = config::read_stored_config()?;
    config.notify_cooldown_minutes = minutes;
    config::write_stored_config(&config)?;
    Ok(config::to_app_config(config)?)
}

#[tauri::command]
fn save_history_months(months: u32) -> Result<AppConfig, String> {
    let mut config = config::read_stored_config()?;
    config.usage_history_months = months.clamp(1, 60);
    config::write_stored_config(&config)?;
    Ok(config::to_app_config(config)?)
}

// ─── 多账户管理 ──────────────────────────────────────────

#[tauri::command]
fn add_account(name: String) -> Result<AppConfig, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("账户名称不能为空".to_string());
    }
    if name.len() > 40 {
        return Err("账户名称过长（最多 40 字符）".to_string());
    }
    let mut config = config::read_stored_config()?;
    let id = format!(
        "acc_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    config.accounts.push(modules::types::AccountConfig {
        id: id.clone(),
        name,
        api_key: None,
        usage_token: None,
    });
    config.active_account = Some(id);
    config::write_stored_config(&config)?;
    Ok(config::to_app_config(config)?)
}

#[tauri::command]
fn switch_account(id: String) -> Result<AppConfig, String> {
    let mut config = config::read_stored_config()?;
    if !config.accounts.iter().any(|a| a.id == id) {
        return Err("账户不存在".to_string());
    }
    config.active_account = Some(id);
    config::write_stored_config(&config)?;
    Ok(config::to_app_config(config)?)
}

#[tauri::command]
fn delete_account(id: String) -> Result<AppConfig, String> {
    let mut config = config::read_stored_config()?;
    if !config.accounts.iter().any(|a| a.id == id) {
        return Err("账户不存在".to_string());
    }
    config.accounts.retain(|a| a.id != id);
    if config.active_account.as_deref() == Some(id.as_str()) {
        config.active_account = config.accounts.first().map(|a| a.id.clone());
    }
    config::write_stored_config(&config)?;
    Ok(config::to_app_config(config)?)
}

#[tauri::command]
fn get_balance_history() -> Result<Vec<BalanceHistoryEntry>, String> {
    Ok(config::read_stored_config()?.balance_history)
}

#[tauri::command]
fn export_config_json() -> Result<String, String> {
    let config = config::read_stored_config()?;
    serde_json::to_string_pretty(&config).map_err(|e| e.to_string())
}

#[tauri::command]
fn import_config_json(json: String) -> Result<AppConfig, String> {
    let config: config::StoredConfig = serde_json::from_str(&json).map_err(|e| format!("JSON 解析失败: {}", e))?;
    config::write_stored_config(&config)?;
    Ok(config::to_app_config(config)?)
}

/// 余额低于阈值时发送 Windows 通知（DeepSeek 与 MiMo 共用）
fn notify_low_balance_if_needed(balance_str: &str, currency: &str) {
    let config = match config::read_stored_config() {
        Ok(c) => c,
        Err(_) => return,
    };
    if !config.low_balance_notify {
        return;
    }
    let threshold = config.low_balance_threshold;
    if threshold <= 0.0 {
        return;
    }
    let Ok(balance_val) = balance_str.parse::<f64>() else {
        return;
    };
    if balance_val < threshold {
        let symbol = if currency == "USD" { "$" } else { "¥" };
        let _ = notify_rust::Notification::new()
            .summary("DeepSeek / MiMo Monitor")
            .body(&format!("余额不足提醒：当前余额 {}{}，低于阈值 {}{}", symbol, balance_str, symbol, threshold))
            .appname("DeepSeekMonitor")
            .show();
        log::info!("[Notify] 余额不足: {}{} < {}{}", symbol, balance_str, symbol, threshold);
    }
}

#[tauri::command]
fn set_provider(provider: String) -> Result<AppConfig, String> {
    if provider != "deepseek" && provider != "mimo" {
        return Err("无效的 provider，仅支持 deepseek 或 mimo".to_string());
    }
    let mut config = config::read_stored_config()?;
    config.provider = provider;
    config::write_stored_config(&config)?;
    Ok(config::to_app_config(config)?)
}

#[tauri::command]
async fn fetch_balance() -> Result<BalanceResult, String> {
    let result = deepseek::do_fetch_balance().await?;
    config::record_balance_history("deepseek", &result.total_balance, &result.currency);
    notify_low_balance_if_needed(&result.total_balance, &result.currency);
    Ok(result)
}

#[tauri::command]
fn save_usage_token(usage_token: String) -> Result<AppConfig, String> {
    Ok(deepseek::do_save_usage_token(usage_token)?)
}

#[tauri::command]
fn clear_usage_token() -> Result<AppConfig, String> {
    Ok(deepseek::do_clear_usage_token()?)
}

#[tauri::command]
async fn start_usage_sync(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(deepseek::start_usage_sync(&app)?)
}

#[tauri::command]
async fn usage_token_captured(
    app: tauri::AppHandle,
    token: String,
    month: u32,
    year: u32,
) -> Result<AppConfig, String> {
    Ok(deepseek::do_usage_token_captured(&app, token, month, year).await?)
}

#[tauri::command]
async fn fetch_usage(month: u32, year: u32) -> Result<UsageResult, String> {
    Ok(deepseek::do_fetch_usage(month, year).await?)
}

#[tauri::command]
async fn fetch_mimo_balance(app: tauri::AppHandle) -> Result<MimoBalanceResult, String> {
    let result = mimo::do_fetch_mimo_balance(&app).await?;
    config::record_balance_history(
        "mimo",
        &result.available_balance,
        &result.currency,
    );
    notify_low_balance_if_needed(&result.available_balance, &result.currency);
    Ok(result)
}

#[tauri::command]
async fn fetch_mimo_usage(
    app: tauri::AppHandle,
    month: u32,
    year: u32,
) -> Result<MimoUsageResult, String> {
    Ok(mimo::do_fetch_mimo_usage(&app, month, year).await?)
}

#[tauri::command]
async fn start_mimo_sync(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(mimo::do_start_mimo_sync(&app)?)
}

#[tauri::command]
async fn ensure_mimo_webview(app: tauri::AppHandle) -> Result<(), String> {
    Ok(mimo::do_ensure_mimo_webview(&app)?)
}

#[tauri::command]
fn mimo_api_response(
    app: tauri::AppHandle,
    req_id: String,
    json: String,
) -> Result<(), String> {
    Ok(mimo::do_mimo_api_response(&app, req_id, json)?)
}

// ─── 自动更新 ──────────────────────────────────────────────

struct PendingUpdate(std::sync::Mutex<Option<tauri_plugin_updater::Update>>);

#[derive(serde::Serialize)]
struct UpdateInfo {
    version: String,
    date: String,
    body: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(tag = "event", content = "data")]
enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started { content_length: Option<u64> },
    #[serde(rename_all = "camelCase")]
    Progress { chunk_length: usize, downloaded: u64 },
    Finished,
}

#[tauri::command]
async fn check_update(app: tauri::AppHandle, pending: tauri::State<'_, PendingUpdate>) -> Result<Option<UpdateInfo>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| format!("获取更新器失败：{e}"))?;
    match updater.check().await {
        Ok(Some(update)) => {
            let info = UpdateInfo {
                version: update.version.clone(),
                date: update.date.map(|d| {
                    let y = d.year();
                    let m = d.month() as u8;
                    let day = d.day();
                    format!("{y}-{m:02}-{day:02}")
                }).unwrap_or_default(),
                body: update.body.clone().unwrap_or_default(),
            };
            *pending.0.lock().unwrap() = Some(update);
            Ok(Some(info))
        }
        Ok(None) => Ok(None),
        Err(e) => Err(format!("检查更新失败：{e}")),
    }
}

#[tauri::command]
async fn install_update(pending: tauri::State<'_, PendingUpdate>, on_event: tauri::ipc::Channel<DownloadEvent>) -> Result<(), String> {
    let update = pending.0.lock().unwrap().take().ok_or("没有待安装的更新")?;
    let mut downloaded: u64 = 0;
    let mut started = false;
    update
        .download_and_install(
            |chunk_len, content_len| {
                if !started {
                    let _ = on_event.send(DownloadEvent::Started { content_length: content_len });
                    started = true;
                }
                downloaded += chunk_len as u64;
                let _ = on_event.send(DownloadEvent::Progress { chunk_length: chunk_len, downloaded });
            },
            || {
                let _ = on_event.send(DownloadEvent::Finished);
            },
        )
        .await
        .map_err(|e| format!("下载安装失败：{e}"))?;
    Ok(())
}

// ─── 主入口 ──────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                tray::show_main_window(&window);
            }
        }))
        .manage(Arc::new(std::sync::atomic::AtomicBool::new(false)))
        .manage(Arc::new(Mutex::new(HashMap::<String, oneshot::Sender<String>>::new())))
        .manage(Arc::new(tokio::sync::Mutex::new(())))
        .manage(Mutex::new(MimoDetailCache::new()))
        .manage(Mutex::new(CallbackServerPort(0)))
        .manage(PendingUpdate(std::sync::Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            hide_main_window,
            resize_window,
            get_app_config,
            save_api_key,
            clear_api_key,
            save_refresh_interval,
            save_auto_refresh_enabled,
            save_autostart,
            save_low_balance_notify,
            save_low_balance_threshold,
            save_theme,
            save_currency,
            save_efficiency_unit,
            save_default_provider,
            save_mimo_refresh_interval,
            save_notify_cooldown,
            save_always_on_top,
            save_auto_clear_old_cache,
            save_history_months,
            add_account,
            switch_account,
            delete_account,
            get_balance_history,
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
            mimo_api_response,
            check_update,
            install_update,
            export_config_json,
            import_config_json
        ])
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 启动持久化回调服务器
            let shared_map = app
                .state::<Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>>()
                .inner()
                .clone();
            let cb_server = CallbackServer::start(shared_map)?;
            *app.state::<Mutex<CallbackServerPort>>().lock().unwrap() =
                CallbackServerPort(cb_server.port);
            app.manage(Mutex::new(cb_server));

            // 初始化托盘
            tray::setup_tray(app)?;

            // 恢复窗口大小和位置，或首次启动定位到右下角
            if let Some(window) = app.get_webview_window("main") {
                let config = config::read_stored_config().ok();
                // 恢复窗口置顶状态
                if let Some(ref c) = config {
                    if c.always_on_top {
                        let _ = window.set_always_on_top(true);
                    }
                }
                if let Some(ref c) = config {
                    if let (Some(w), Some(h), Some(x), Some(y)) = (c.window_width, c.window_height, c.window_x, c.window_y) {
                        // 有保存的状态，恢复
                        let _ = window.set_size(tauri::LogicalSize::new(w, h));
                        let _ = window.set_position(tauri::PhysicalPosition::new(x.max(0), y.max(0)));
                        return Ok(());
                    }
                }
                // 首次启动或无保存状态，定位到右下角
                let _ = tray::position_near_tray(&window);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
