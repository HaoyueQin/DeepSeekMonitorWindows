#[cfg(test)]
mod tests {
    use super::*;

    // ─── normalize_refresh_interval_seconds ─────────────────

    #[test]
    fn test_normalize_valid_intervals() {
        assert_eq!(normalize_refresh_interval_seconds(60), 60);
        assert_eq!(normalize_refresh_interval_seconds(300), 300);
        assert_eq!(normalize_refresh_interval_seconds(1800), 1800);
        assert_eq!(normalize_refresh_interval_seconds(3600), 3600);
    }

    #[test]
    fn test_normalize_invalid_falls_back_to_60() {
        assert_eq!(normalize_refresh_interval_seconds(0), 60);
        assert_eq!(normalize_refresh_interval_seconds(1), 60);
        assert_eq!(normalize_refresh_interval_seconds(999), 60);
        assert_eq!(normalize_refresh_interval_seconds(7200), 60);
    }

    // ─── api_key_preview ────────────────────────────────────

    #[test]
    fn test_preview_long_key() {
        let key = "sk-abcde12345fghij67890";
        let preview = api_key_preview(key);
        assert!(preview.contains("..."));
        assert!(preview.starts_with("sk-abc"));
        assert!(preview.ends_with("7890"));
    }

    #[test]
    fn test_preview_short_key_returns_saved() {
        let key = "short";
        assert_eq!(api_key_preview(key), "已保存");
    }

    // ─── decrypt_credential ─────────────────────────────────

    #[test]
    fn test_decrypt_passthrough_plain_text() {
        let result = decrypt_credential("plain-text-token");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "plain-text-token");
    }

    #[test]
    fn test_decrypt_invalid_hex_returns_error() {
        let result = decrypt_credential("enc1:invalid_hex");
        assert!(result.is_err());
    }

    // ─── to_app_config ──────────────────────────────────────

    #[test]
    fn test_to_app_config_no_keys() {
        let config = StoredConfig {
            api_key: None,
            usage_token: None,
            provider: "deepseek".to_string(),
            mimo_token: None,
            mimo_ph: None,
            refresh_interval_seconds: 60,
            auto_refresh_enabled: false,
            autostart: false,
        };
        let result = to_app_config(config);
        assert!(result.is_ok());
        let app = result.unwrap();
        assert!(!app.api_key_configured);
        assert!(app.api_key_preview.is_none());
        assert!(!app.usage_token_configured);
        assert!(!app.mimo_token_configured);
        assert_eq!(app.provider, "deepseek");
    }

    #[test]
    fn test_to_app_config_with_keys() {
        let config = StoredConfig {
            api_key: Some("sk-abcde12345fghij67890".to_string()),
            usage_token: Some("some-usage-token".to_string()),
            provider: "mimo".to_string(),
            mimo_token: Some("mimo-token".to_string()),
            mimo_ph: None,
            refresh_interval_seconds: 300,
            auto_refresh_enabled: true,
            autostart: true,
        };
        let result = to_app_config(config);
        assert!(result.is_ok());
        let app = result.unwrap();
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
    fn test_to_app_config_empty_key_not_configured() {
        let config = StoredConfig {
            api_key: Some("".to_string()),
            usage_token: Some("".to_string()),
            provider: "deepseek".to_string(),
            mimo_token: None,
            mimo_ph: None,
            refresh_interval_seconds: 60,
            auto_refresh_enabled: false,
            autostart: false,
        };
        let result = to_app_config(config);
        assert!(result.is_ok());
        let app = result.unwrap();
        assert!(!app.api_key_configured);
        assert!(!app.usage_token_configured);
    }
}
