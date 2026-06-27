//! 窗口管理与系统托盘
//!
//! 职责：窗口定位（右下角）、显示/隐藏、托盘图标初始化。

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent}, Manager, PhysicalPosition, Position, WebviewWindow,
};

/// 将窗口定位到屏幕右下角（靠近托盘图标区域）
pub fn position_near_tray(window: &WebviewWindow) -> tauri::Result<()> {
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
    let x = (right - width - margin).max(work_area.position.x);
    let y = (bottom - height - margin).max(work_area.position.y);

    window.set_position(Position::Physical(PhysicalPosition::new(x, y)))
}

/// 显示主窗口并定位到右下角
pub fn show_main_window(window: &WebviewWindow) {
    // 先显示窗口，确保可见
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    // 定位到右下角（失败不影响显示）
    let _ = position_near_tray(window);
}

/// 初始化系统托盘图标和菜单
pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
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
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    // Always show on tray click — user hides via title bar button
                    let _ = window.unminimize();
                    show_main_window(&window);
                }
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    tray_builder.build(app)?;
    Ok(())
}
