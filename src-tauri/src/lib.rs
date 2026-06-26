//! DeepSeek / MiMo Monitor Windows — Tauri 入口
//!
//! 职责：模块声明、Tauri 命令注册、Builder 配置。
//! 具体业务逻辑分散在 modules/ 子模块中。

mod modules;
use modules::{
    config, deepseek, mimo, tray,
    types::{
        AppConfig, BalanceResult, CallbackServerPort, MimoBalanceResult, MimoDetailCache,
        MimoUsageResult, UsageResult,
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
    fn start(shared_map: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>) -> Self {
        use tiny_http::{Header, Method, Response, Server};
        let server = Server::http("127.0.0.1:0").expect("无法启动回调服务器");
        let port = server.server_addr().to_ip().unwrap().port();
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
        CallbackServer { port }
    }
}

// ─── Tauri 命令 ──────────────────────────────────────────

#[tauri::command]
fn hide_main_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn resize_window(window: WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    use tauri::{PhysicalPosition, LogicalSize};

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
    window.set_position(PhysicalPosition::new(new_x, new_y)).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_app_config() -> Result<AppConfig, String> {
    config::to_app_config(config::read_stored_config()?)
}

#[tauri::command]
fn save_api_key(api_key: String) -> Result<AppConfig, String> {
    let value = api_key.trim().to_string();
    if value.is_empty() {
        return Err("API Key 不能为空".to_string());
    }
    let mut config = config::read_stored_config()?;
    config.api_key = Some(value);
    config::write_stored_config(&config)?;
    config::to_app_config(config)
}

#[tauri::command]
fn clear_api_key() -> Result<AppConfig, String> {
    let mut config = config::read_stored_config()?;
    config.api_key = None;
    config::write_stored_config(&config)?;
    config::to_app_config(config)
}

#[tauri::command]
fn save_refresh_interval(refresh_interval_seconds: u64) -> Result<AppConfig, String> {
    let mut config = config::read_stored_config()?;
    config.refresh_interval_seconds = refresh_interval_seconds;
    config::write_stored_config(&config)?;
    config::to_app_config(config)
}

#[tauri::command]
fn save_auto_refresh_enabled(auto_refresh_enabled: bool) -> Result<AppConfig, String> {
    let mut config = config::read_stored_config()?;
    config.auto_refresh_enabled = auto_refresh_enabled;
    config::write_stored_config(&config)?;
    config::to_app_config(config)
}

#[tauri::command]
fn save_autostart(autostart: bool) -> Result<AppConfig, String> {
    config::apply_autostart(autostart)?;
    let mut config = config::read_stored_config()?;
    config.autostart = autostart;
    config::write_stored_config(&config)?;
    config::to_app_config(config)
}

#[tauri::command]
fn set_provider(provider: String) -> Result<AppConfig, String> {
    if provider != "deepseek" && provider != "mimo" {
        return Err("无效的 provider，仅支持 deepseek 或 mimo".to_string());
    }
    let mut config = config::read_stored_config()?;
    config.provider = provider;
    config::write_stored_config(&config)?;
    config::to_app_config(config)
}

#[tauri::command]
async fn fetch_balance() -> Result<BalanceResult, String> {
    deepseek::do_fetch_balance().await
}

#[tauri::command]
fn save_usage_token(usage_token: String) -> Result<AppConfig, String> {
    deepseek::do_save_usage_token(usage_token)
}

#[tauri::command]
fn clear_usage_token() -> Result<AppConfig, String> {
    deepseek::do_clear_usage_token()
}

#[tauri::command]
async fn start_usage_sync(app: tauri::AppHandle) -> Result<bool, String> {
    deepseek::start_usage_sync(&app)
}

#[tauri::command]
async fn usage_token_captured(
    app: tauri::AppHandle,
    token: String,
    month: u32,
    year: u32,
) -> Result<AppConfig, String> {
    deepseek::do_usage_token_captured(&app, token, month, year).await
}

#[tauri::command]
async fn fetch_usage(month: u32, year: u32) -> Result<UsageResult, String> {
    deepseek::do_fetch_usage(month, year).await
}

#[tauri::command]
async fn fetch_mimo_balance(app: tauri::AppHandle) -> Result<MimoBalanceResult, String> {
    mimo::do_fetch_mimo_balance(&app).await
}

#[tauri::command]
async fn fetch_mimo_usage(
    app: tauri::AppHandle,
    month: u32,
    year: u32,
) -> Result<MimoUsageResult, String> {
    mimo::do_fetch_mimo_usage(&app, month, year).await
}

#[tauri::command]
async fn start_mimo_sync(app: tauri::AppHandle) -> Result<bool, String> {
    mimo::do_start_mimo_sync(&app)
}

#[tauri::command]
async fn ensure_mimo_webview(app: tauri::AppHandle) -> Result<(), String> {
    mimo::do_ensure_mimo_webview(&app)
}

#[tauri::command]
fn mimo_api_response(
    app: tauri::AppHandle,
    req_id: String,
    json: String,
) -> Result<(), String> {
    mimo::do_mimo_api_response(&app, req_id, json)
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
        .invoke_handler(tauri::generate_handler![
            hide_main_window,
            resize_window,
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

            // 启动持久化回调服务器
            let shared_map = app
                .state::<Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>>()
                .inner()
                .clone();
            let cb_server = CallbackServer::start(shared_map);
            *app.state::<Mutex<CallbackServerPort>>().lock().unwrap() =
                CallbackServerPort(cb_server.port);
            app.manage(Mutex::new(cb_server));

            // 初始化托盘
            tray::setup_tray(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
