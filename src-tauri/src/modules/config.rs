//! 配置管理 + Windows DPAPI 凭据加密
//!
//! 职责：配置路径、读写、DPAPI 加密/解密、开机自启注册表操作。

use std::{fs, path::PathBuf};

use crate::modules::types::{AppConfig, StoredConfig};

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

fn dpapi_encrypt(plain: &[u8]) -> Result<Vec<u8>, String> {
    let data_in = DataBlob {
        cb_data: plain.len() as u32,
        pb_data: plain.as_ptr() as *mut u8,
    };
    let mut data_out = DataBlob {
        cb_data: 0,
        pb_data: std::ptr::null_mut(),
    };
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
        return Err("DPAPI 加密失败".to_string());
    }
    let encrypted = unsafe {
        std::slice::from_raw_parts(data_out.pb_data, data_out.cb_data as usize).to_vec()
    };
    unsafe {
        LocalFree(data_out.pb_data as isize);
    }
    Ok(encrypted)
}

fn dpapi_decrypt(encrypted: &[u8]) -> Result<Vec<u8>, String> {
    let data_in = DataBlob {
        cb_data: encrypted.len() as u32,
        pb_data: encrypted.as_ptr() as *mut u8,
    };
    let mut data_out = DataBlob {
        cb_data: 0,
        pb_data: std::ptr::null_mut(),
    };
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
        return Err("DPAPI 解密失败，凭据可能由其他 Windows 用户加密".to_string());
    }
    let decrypted = unsafe {
        std::slice::from_raw_parts(data_out.pb_data, data_out.cb_data as usize).to_vec()
    };
    unsafe {
        LocalFree(data_out.pb_data as isize);
    }
    Ok(decrypted)
}

fn hex_encode(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect()
}

fn hex_decode(hex: &str) -> Result<Vec<u8>, String> {
    if hex.len() % 2 != 0 {
        return Err("十六进制编码长度无效".to_string());
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&hex[i..i + 2], 16).map_err(|e| format!("十六进制解码失败：{e}"))
        })
        .collect()
}

pub fn encrypt_credential(plain: &str) -> String {
    match dpapi_encrypt(plain.as_bytes()) {
        Ok(encrypted) => format!("enc1:{}", hex_encode(&encrypted)),
        Err(_) => {
            log::warn!("DPAPI 加密失败，将明文保存凭据");
            plain.to_string()
        }
    }
}

pub fn decrypt_credential(stored: &str) -> Result<String, String> {
    if let Some(hex) = stored.strip_prefix("enc1:") {
        let encrypted = hex_decode(hex)?;
        let decrypted = dpapi_decrypt(&encrypted)?;
        String::from_utf8(decrypted).map_err(|e| format!("解密凭据失败：{e}"))
    } else {
        Ok(stored.to_string()) // 向后兼容明文
    }
}

// ─── 配置路径 ────────────────────────────────────────────

pub fn config_path() -> Result<PathBuf, String> {
    let appdata = std::env::var_os("APPDATA").ok_or("APPDATA is not available")?;
    Ok(PathBuf::from(appdata)
        .join("DeepSeekMonitorWindows")
        .join("config.json"))
}

// ─── 配置读写 ────────────────────────────────────────────

fn normalize_refresh_interval_seconds(value: u64) -> u64 {
    match value {
        60 | 300 | 1800 | 3600 => value,
        _ => 60,
    }
}

pub fn read_stored_config() -> Result<StoredConfig, String> {
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
    // 解密凭据（向后兼容明文）
    if let Some(ref key) = config.api_key {
        config.api_key = Some(decrypt_credential(key)?);
    }
    if let Some(ref token) = config.usage_token {
        config.usage_token = Some(decrypt_credential(token)?);
    }
    Ok(config)
}

pub fn write_stored_config(config: &StoredConfig) -> Result<(), String> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    // 加密凭据后写入
    let mut encrypted_config = config.clone();
    if let Some(ref key) = config.api_key {
        encrypted_config.api_key = Some(encrypt_credential(key));
    }
    if let Some(ref token) = config.usage_token {
        encrypted_config.usage_token = Some(encrypt_credential(token));
    }
    if let Some(ref token) = config.mimo_token {
        encrypted_config.mimo_token = Some(encrypt_credential(token));
    }

    let text =
        serde_json::to_string_pretty(&encrypted_config).map_err(|error| error.to_string())?;
    fs::write(path, text).map_err(|error| error.to_string())
}

// ─── AppConfig 转换 ──────────────────────────────────────

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

pub fn to_app_config(config: StoredConfig) -> Result<AppConfig, String> {
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
    })
}

// ─── 开机自启 ────────────────────────────────────────────

pub fn apply_autostart(enabled: bool) -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run_key = hkcu
        .open_subkey_with_flags(
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            KEY_READ | KEY_WRITE,
        )
        .map_err(|e| e.to_string())?;

    let value_name = "DeepSeekMonitorWindows";

    if enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let path = exe.to_string_lossy().to_string();
        run_key
            .set_value(value_name, &path)
            .map_err(|e| e.to_string())?;
    } else {
        let _ = run_key.delete_value(value_name);
    }
    Ok(())
}
