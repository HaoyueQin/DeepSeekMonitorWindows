//! 共享数据结构定义
//!
//! 所有模块共用的类型定义集中在此，避免循环依赖。

use serde::{Deserialize, Serialize};

// ─── 配置 ─────────────────────────────────────────────────

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct StoredConfig {
    pub api_key: Option<String>,
    #[serde(default)]
    pub usage_token: Option<String>,
    #[serde(default)]
    pub provider: String, // "deepseek" | "mimo"
    #[serde(default)]
    pub mimo_token: Option<String>,
    #[serde(default)]
    pub mimo_ph: Option<String>,
    pub refresh_interval_seconds: u64,
    #[serde(default)]
    pub auto_refresh_enabled: bool,
    pub autostart: bool,
    #[serde(default)]
    pub window_width: Option<f64>,
    #[serde(default)]
    pub window_height: Option<f64>,
    #[serde(default)]
    pub window_x: Option<i32>,
    #[serde(default)]
    pub window_y: Option<i32>,
    #[serde(default)]
    pub low_balance_notify: bool,
    #[serde(default)]
    pub low_balance_threshold: f64,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_currency")]
    pub currency: String, // "cny" | "usd"
    #[serde(default = "default_efficiency_unit")]
    pub efficiency_unit: String, // "token_per_currency" | "currency_per_token"
    #[serde(default = "default_provider")]
    pub default_provider: String, // "deepseek" | "mimo"
    #[serde(default)]
    pub mimo_refresh_interval_seconds: u64, // 0 = use global
    #[serde(default = "default_notify_cooldown")]
    pub notify_cooldown_minutes: u64,
    #[serde(default)]
    pub always_on_top: bool,
    #[serde(default)]
    pub auto_clear_old_cache: bool,
}

fn default_theme() -> String { "light".to_string() }
fn default_currency() -> String { "cny".to_string() }
fn default_efficiency_unit() -> String { "token_per_currency".to_string() }
fn default_provider() -> String { "deepseek".to_string() }
fn default_notify_cooldown() -> u64 { 30 }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub api_key_configured: bool,
    pub api_key_preview: Option<String>,
    pub usage_token_configured: bool,
    pub provider: String,
    pub mimo_token_configured: bool,
    pub refresh_interval_seconds: u64,
    pub auto_refresh_enabled: bool,
    pub autostart: bool,
    pub config_path: String,
    #[serde(default)]
    pub low_balance_notify: bool,
    #[serde(default)]
    pub low_balance_threshold: f64,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_currency")]
    pub currency: String,
    #[serde(default = "default_efficiency_unit")]
    pub efficiency_unit: String,
    #[serde(default = "default_provider")]
    pub default_provider: String,
    #[serde(default)]
    pub mimo_refresh_interval_seconds: u64,
    #[serde(default = "default_notify_cooldown")]
    pub notify_cooldown_minutes: u64,
    #[serde(default)]
    pub always_on_top: bool,
    #[serde(default)]
    pub auto_clear_old_cache: bool,
}

// ─── DeepSeek ─────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BalanceResult {
    pub is_available: bool,
    pub currency: String,
    pub total_balance: String,
    pub granted_balance: String,
    pub topped_up_balance: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageModelSummary {
    pub key: String,
    pub name: String,
    pub total_tokens: u64,
    pub request_count: u64,
    pub cache_hit_tokens: u64,
    pub cache_miss_tokens: u64,
    pub response_tokens: u64,
    pub cost: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageDaySummary {
    pub date: String,
    pub flash_tokens: u64,
    pub flash_cache_hit: u64,
    pub flash_cache_miss: u64,
    pub flash_response: u64,
    pub pro_tokens: u64,
    pub pro_cache_hit: u64,
    pub pro_cache_miss: u64,
    pub pro_response: u64,
    pub total_tokens: u64,
    pub total_cost: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageResult {
    pub models: Vec<UsageModelSummary>,
    pub days: Vec<UsageDaySummary>,
    pub month_cost: f64,
}

// ─── MiMo ─────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MimoBalanceResult {
    pub available_balance: String,
    pub currency: String,
    pub total_consumption: String,
    pub monthly_expense: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MimoUsageModel {
    pub key: String,
    pub name: String,
    pub total_tokens: u64,
    pub request_count: u64,
    pub cache_hit_tokens: u64,
    pub cache_miss_tokens: u64,
    pub response_tokens: u64,
    pub cost: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MimoUsageDayModel {
    pub key: String,
    pub total_tokens: u64,
    pub cache_hit_tokens: u64,
    pub cache_miss_tokens: u64,
    pub response_tokens: u64,
    pub total_cost: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MimoUsageDay {
    pub date: String,
    pub total_tokens: u64,
    pub total_cost: f64,
    pub models: Vec<MimoUsageDayModel>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MimoUsageResult {
    pub models: Vec<MimoUsageModel>,
    pub days: Vec<MimoUsageDay>,
    pub month_cost: f64,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UsageDetailItem {
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub total_token: u64,
    #[serde(default)]
    pub input_hit_token: u64,
    #[serde(default)]
    pub input_miss_token: u64,
    #[serde(default)]
    pub output_token: u64,
    #[serde(default)]
    pub request_count: u64,
    #[serde(default)]
    pub consumed_amount: String,
}

// ─── Callback Server ──────────────────────────────────────

pub struct CallbackServerPort(pub u16);

// ─── Detail Cache ─────────────────────────────────────────

pub struct MimoDetailCache {
    items: Option<(std::time::Instant, Vec<UsageDetailItem>)>,
    month_key: Option<String>,
    in_progress: bool,
    in_progress_month: Option<String>,
}

impl MimoDetailCache {
    pub fn new() -> Self {
        Self {
            items: None,
            month_key: None,
            in_progress: false,
            in_progress_month: None,
        }
    }
    pub fn get(&self, max_age: std::time::Duration, month: &str) -> Option<Vec<UsageDetailItem>> {
        if self.in_progress {
            return None;
        }
        // 月份不匹配 → 缓存无效
        if self.month_key.as_deref() != Some(month) {
            return None;
        }
        self.items
            .as_ref()
            .and_then(|(ts, items)| {
                if ts.elapsed() < max_age {
                    Some(items.to_vec())
                } else {
                    None
                }
            })
    }
    pub fn set(&mut self, items: Vec<UsageDetailItem>, month: &str) {
        self.items = Some((std::time::Instant::now(), items));
        self.month_key = Some(month.to_string());
        self.in_progress = false;
    }
    pub fn mark_in_progress(&mut self, month: &str) -> bool {
        if self.in_progress {
            return false;
        }
        self.in_progress = true;
        self.in_progress_month = Some(month.to_string());
        true
    }
    pub fn clear_in_progress(&mut self) {
        self.in_progress = false;
    }
}
