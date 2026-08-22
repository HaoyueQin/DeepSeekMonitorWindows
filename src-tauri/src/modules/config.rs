//! 配置管理 + Windows DPAPI 凭据加密
//!
//! 职责：配置路径、读写、DPAPI 加密/解密、开机自启注册表操作。

use std::{fs, path::PathBuf};

use crate::modules::types::{AppConfig, AppError};
pub use crate::modules::types::StoredConfig;

// ─── DPAPI 加密 ──────────────────────────────────────────

#[repr(C)]
struct DataBlob {
    cb_data: u32,
    pb_data: *mut u8,
}

#[link(name = "crypt32")]
extern "system" {
    fn CryptProtectData(
        pdata_in: *const DataBlob,
        sz_data_descr: *const u16,
        p_optional_entropy: *const DataBlob,
        pv_reserved: *mut core::ffi::c_void,
        p_prompt_struct: *const core::ffi::c_void,
        dw_flags: u32,
        pdata_out: *mut DataBlob,
    ) -> i32;
    fn CryptUnprotectData(
        pdata_in: *const DataBlob,
        p_sz_data_descr: *mut *mut u16,
        p_optional_entropy: *const DataBlob,
        pv_reserved: *mut core::ffi::c_void,
        p_prompt_struct: *const core::ffi::c_void,
        dw_flags: u32,
        pdata_out: *mut DataBlob,
    ) -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    fn LocalFree(h_mem: isize) -> isize;
}

fn dpapi_encrypt(plain: &[u8]) -> Result<Vec<u8>, AppError> {
    let data_in = DataBlob {
        cb_data: plain.len() as u32,
        pb_data: plain.as_ptr() as *mut u8,
    };
    let mut data_out = DataBlob {
        cb_data: 0,
        pb_data: std::ptr::null_mut(),
    };
    // SAFETY: CryptProtectData is a Windows API that reads data_in and writes to data_out.
    // Both structs are valid for the duration of the call. data_out.pb_data is allocated by the OS.
    let result = unsafe {
        CryptProtectData(
            &data_in,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null(),
            0,
            &mut data_out,
        )
    };
    if result == 0 {
        return Err(AppError::Crypto("DPAPI 加密失败".to_string()));
    }
    // SAFETY: data_out.pb_data is guaranteed valid by CryptProtectData on success;
    // cb_data matches the allocated length. We copy to a Vec immediately.
    let encrypted = unsafe {
        std::slice::from_raw_parts(data_out.pb_data, data_out.cb_data as usize).to_vec()
    };
    // SAFETY: data_out.pb_data was allocated by CryptProtectData; LocalFree is the correct deallocator.
    unsafe {
        LocalFree(data_out.pb_data as isize);
    }
    Ok(encrypted)
}

fn dpapi_decrypt(encrypted: &[u8]) -> Result<Vec<u8>, AppError> {
    let data_in = DataBlob {
        cb_data: encrypted.len() as u32,
        pb_data: encrypted.as_ptr() as *mut u8,
    };
    let mut data_out = DataBlob {
        cb_data: 0,
        pb_data: std::ptr::null_mut(),
    };
    // SAFETY: CryptUnprotectData reads data_in (valid encrypted bytes) and writes to data_out.
    // Both structs are valid for the duration of the call.
    let result = unsafe {
        CryptUnprotectData(
            &data_in,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null(),
            0,
            &mut data_out,
        )
    };
    if result == 0 {
        return Err(AppError::Crypto(
            "DPAPI 解密失败，凭据可能由其他 Windows 用户加密".to_string(),
        ));
    }
    // SAFETY: data_out.pb_data is guaranteed valid by CryptUnprotectData on success;
    // cb_data matches the allocated length. We copy to a Vec immediately.
    let decrypted = unsafe {
        std::slice::from_raw_parts(data_out.pb_data, data_out.cb_data as usize).to_vec()
    };
    // SAFETY: data_out.pb_data was allocated by CryptUnprotectData; LocalFree is the correct deallocator.
    unsafe {
        LocalFree(data_out.pb_data as isize);
    }
    Ok(decrypted)
}

fn hex_encode(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect()
}

fn hex_decode(hex: &str) -> Result<Vec<u8>, AppError> {
    // 必须按字节处理：直接对 str 切片在多字节 UTF-8 输入下会因非字符边界而 panic
    let bytes = hex.as_bytes();
    if bytes.len() % 2 != 0 {
        return Err(AppError::Crypto("十六进制编码长度无效".to_string()));
    }
    let mut out = Vec::with_capacity(bytes.len() / 2);
    for pair in bytes.chunks_exact(2) {
        let hi = (pair[0] as char)
            .to_digit(16)
            .ok_or_else(|| AppError::Crypto("十六进制解码失败：非法字符".to_string()))?;
        let lo = (pair[1] as char)
            .to_digit(16)
            .ok_or_else(|| AppError::Crypto("十六进制解码失败：非法字符".to_string()))?;
        out.push(((hi << 4) | lo) as u8);
    }
    Ok(out)
}

pub fn encrypt_credential(plain: &str) -> Result<String, AppError> {
    match dpapi_encrypt(plain.as_bytes()) {
        Ok(encrypted) => Ok(format!("enc1:{}", hex_encode(&encrypted))),
        Err(e) => {
            log::error!("DPAPI 加密失败: {}", e);
            Err(AppError::Crypto(format!(
                "DPAPI 加密失败，凭据未保存: {}",
                e
            )))
        }
    }
}

pub fn decrypt_credential(stored: &str) -> Result<String, AppError> {
    if let Some(hex) = stored.strip_prefix("enc1:") {
        let encrypted = hex_decode(hex)?;
        let decrypted = dpapi_decrypt(&encrypted)?;
        String::from_utf8(decrypted)
            .map_err(|e| AppError::Crypto(format!("解密凭据失败：{e}")))
    } else {
        Ok(stored.to_string()) // 向后兼容明文
    }
}

// ─── 配置路径 ────────────────────────────────────────────

pub fn config_path() -> Result<PathBuf, AppError> {
    let appdata =
        std::env::var_os("APPDATA").ok_or_else(|| AppError::Config("APPDATA is not available".into()))?;
    Ok(PathBuf::from(appdata)
        .join("DeepSeekMonitorWindows")
        .join("config.json"))
}

// ─── 配置读写 ────────────────────────────────────────────

pub fn normalize_refresh_interval_seconds(value: u64) -> u64 {
    match value {
        0 => 60,
        v if v < 60 => 60,
        _ => value,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_valid() {
        assert_eq!(normalize_refresh_interval_seconds(60), 60);
        assert_eq!(normalize_refresh_interval_seconds(300), 300);
        assert_eq!(normalize_refresh_interval_seconds(1800), 1800);
        assert_eq!(normalize_refresh_interval_seconds(3600), 3600);
    }

    #[test]
    fn normalize_invalid() {
        assert_eq!(normalize_refresh_interval_seconds(0), 60);
        assert_eq!(normalize_refresh_interval_seconds(1), 60);
        assert_eq!(normalize_refresh_interval_seconds(59), 60);
        // 自定义值应保留
        assert_eq!(normalize_refresh_interval_seconds(120), 120);
        assert_eq!(normalize_refresh_interval_seconds(999), 999);
        assert_eq!(normalize_refresh_interval_seconds(7200), 7200);
    }

    #[test]
    fn api_key_preview_long() {
        let preview = api_key_preview("sk-abcde12345fghij67890");
        assert!(preview.contains("..."));
        assert!(preview.starts_with("sk-abc"));
        assert!(preview.ends_with("7890"));
    }

    #[test]
    fn api_key_preview_short() {
        // 短 Key 不泄露内容，用掩码占位
        assert_eq!(api_key_preview("short"), "••••");
    }

    #[test]
    fn decrypt_passthrough_plain() {
        let result = decrypt_credential("plain-text-token");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "plain-text-token");
    }

    #[test]
    fn decrypt_invalid_hex() {
        let result = decrypt_credential("enc1:invalid_hex");
        assert!(result.is_err());
    }

    #[test]
    fn decrypt_multibyte_hex_is_error_not_panic() {
        // 多字节 UTF-8（偶数字节长度）历史上会在字符边界切片 panic，必须返回 Err
        let result = decrypt_credential("enc1:中文");
        assert!(result.is_err());
        let result2 = decrypt_credential("enc1:ab\u{4e2d}");
        assert!(result2.is_err());
    }

    #[test]
    fn to_app_config_no_keys() {
        let config = StoredConfig {
            api_key: None,
            usage_token: None,
            provider: "deepseek".to_string(),
            mimo_token: None,
            mimo_ph: None,
            refresh_interval_seconds: 60,
            auto_refresh_enabled: false,
            autostart: false,
            ..Default::default()
        };
        let app = to_app_config(config).unwrap();
        assert!(!app.api_key_configured);
        assert!(app.api_key_preview.is_none());
        assert!(!app.usage_token_configured);
        assert!(!app.mimo_token_configured);
        assert_eq!(app.provider, "deepseek");
        assert_eq!(app.usage_history_months, 12);
    }

    #[test]
    fn to_app_config_with_keys() {
        let config = StoredConfig {
            api_key: Some("sk-abcde12345fghij67890".to_string()),
            usage_token: Some("some-usage-token".to_string()),
            provider: "mimo".to_string(),
            mimo_token: Some("mimo-token".to_string()),
            mimo_ph: None,
            refresh_interval_seconds: 300,
            auto_refresh_enabled: true,
            autostart: true,
            ..Default::default()
        };
        let app = to_app_config(config).unwrap();
        assert!(app.api_key_configured);
        assert!(app.api_key_preview.is_some());
        assert!(app.usage_token_configured);
        assert!(app.mimo_token_configured);
        assert_eq!(app.provider, "mimo");
        assert_eq!(app.refresh_interval_seconds, 300);
        assert!(app.auto_refresh_enabled);
        assert!(app.autostart);
    }

    #[test]
    fn to_app_config_empty_keys_not_configured() {
        let config = StoredConfig {
            api_key: Some("".to_string()),
            usage_token: Some("".to_string()),
            provider: "deepseek".to_string(),
            mimo_token: None,
            mimo_ph: None,
            refresh_interval_seconds: 60,
            auto_refresh_enabled: false,
            autostart: false,
            ..Default::default()
        };
        let app = to_app_config(config).unwrap();
        assert!(!app.api_key_configured);
        assert!(!app.low_balance_notify);
    }
}

pub fn read_stored_config() -> Result<StoredConfig, AppError> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(StoredConfig {
            refresh_interval_seconds: 60,
            ..StoredConfig::default()
        });
    }

    let text = fs::read_to_string(&path).map_err(|error| AppError::Io(error.to_string()))?;
    let mut config: StoredConfig =
        serde_json::from_str(&text).map_err(|error| AppError::Parse(error.to_string()))?;
    config.refresh_interval_seconds =
        normalize_refresh_interval_seconds(config.refresh_interval_seconds);
    // 解密凭据（向后兼容明文）
    if let Some(ref key) = config.api_key {
        config.api_key = Some(decrypt_credential(key)?);
    }
    if let Some(ref token) = config.usage_token {
        config.usage_token = Some(decrypt_credential(token)?);
    }
    if let Some(ref token) = config.mimo_token {
        config.mimo_token = Some(decrypt_credential(token)?);
    }
    if let Some(ref ph) = config.mimo_ph {
        config.mimo_ph = Some(decrypt_credential(ph)?);
    }
    Ok(config)
}

pub fn write_stored_config(config: &StoredConfig) -> Result<(), AppError> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| AppError::Io(error.to_string()))?;
    }

    // 加密凭据后写入
    let mut encrypted_config = config.clone();
    if let Some(ref key) = config.api_key {
        encrypted_config.api_key = Some(encrypt_credential(key)?);
    }
    if let Some(ref token) = config.usage_token {
        encrypted_config.usage_token = Some(encrypt_credential(token)?);
    }
    if let Some(ref token) = config.mimo_token {
        encrypted_config.mimo_token = Some(encrypt_credential(token)?);
    }
    if let Some(ref ph) = config.mimo_ph {
        encrypted_config.mimo_ph = Some(encrypt_credential(ph)?);
    }
    let text =
        serde_json::to_string_pretty(&encrypted_config).map_err(|error| AppError::Parse(error.to_string()))?;
    fs::write(path, text).map_err(|error| AppError::Io(error.to_string()))
}

// ─── AppConfig 转换 ──────────────────────────────────────

fn api_key_preview(api_key: &str) -> String {
    let chars: Vec<char> = api_key.chars().collect();
    if chars.len() <= 12 {
        return "••••".to_string();
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

pub fn to_app_config(config: StoredConfig) -> Result<AppConfig, AppError> {
    let path = config_path()?;

    let api_key_preview = config
        .api_key
        .as_ref()
        .filter(|k| !k.is_empty())
        .map(|k| api_key_preview(k));

    let usage_token_configured = config
        .usage_token
        .as_ref()
        .filter(|t| !t.is_empty())
        .is_some();

    let mimo_token_configured = config
        .mimo_token
        .as_ref()
        .filter(|t| !t.is_empty())
        .is_some();

    Ok(AppConfig {
        api_key_configured: api_key_preview.is_some(),
        api_key_preview,
        usage_token_configured,
        provider: config.provider,
        mimo_token_configured,
        refresh_interval_seconds: config.refresh_interval_seconds,
        auto_refresh_enabled: config.auto_refresh_enabled,
        autostart: config.autostart,
        config_path: path.to_string_lossy().to_string(),
        low_balance_notify: config.low_balance_notify,
        low_balance_threshold: config.low_balance_threshold,
        theme: config.theme,
        currency: config.currency,
        efficiency_unit: config.efficiency_unit,
        default_provider: config.default_provider,
        mimo_refresh_interval_seconds: config.mimo_refresh_interval_seconds,
        notify_cooldown_minutes: config.notify_cooldown_minutes,
        always_on_top: config.always_on_top,
        auto_clear_old_cache: config.auto_clear_old_cache,
        usage_history_months: if config.usage_history_months == 0 {
            12
        } else {
            config.usage_history_months
        },
    })
}

// ─── 开机自启 ────────────────────────────────────────────

pub fn apply_autostart(enabled: bool) -> Result<(), AppError> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run_key = hkcu
        .open_subkey_with_flags(
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            KEY_READ | KEY_WRITE,
        )
        .map_err(|e| AppError::Config(e.to_string()))?;

    let value_name = "DeepSeekMonitorWindows";

    if enabled {
        let exe = std::env::current_exe().map_err(|e| AppError::Config(e.to_string()))?;
        let path = exe.to_string_lossy().to_string();
        run_key
            .set_value(value_name, &path)
            .map_err(|e| AppError::Config(e.to_string()))?;
    } else {
        let _ = run_key.delete_value(value_name);
    }
    Ok(())
}
