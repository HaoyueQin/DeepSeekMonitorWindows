// ─── i18n 国际化支持 ──────────────────────────────────────
// 中文 / English 双语切换

export type Lang = 'zh' | 'en';

export const LANG_OPTIONS: { code: Lang; label: string }[] = [
  { code: 'zh', label: '简体中文' },
  { code: 'en', label: 'English' },
];

const translations: Record<string, Record<Lang, string>> = {
  // 通用
  'app.loading': { zh: '查询中…', en: 'Loading…' },
  'app.error': { zh: '查询失败', en: 'Query failed' },
  'app.unconfigured': { zh: '未配置', en: 'Not configured' },
  'app.unconfigured_token': { zh: '未配置 Token', en: 'Token not configured' },
  'app.unavailable': { zh: '不可用', en: 'Unavailable' },
  'app.no_data': { zh: '暂无数据', en: 'No data' },
  'app.tokens': { zh: 'tokens', en: 'tokens' },

  // 余额
  'balance.title': { zh: '账户余额', en: 'Account Balance' },
  'balance.available': { zh: '可用', en: 'Available' },
  'balance.insufficient': { zh: '余额不足', en: 'Insufficient' },
  'balance.today': { zh: '当日消耗', en: 'Today' },
  'balance.monthly': { zh: '本月消费', en: 'This Month' },

  // 设置
  'settings.title': { zh: '设置', en: 'Settings' },
  'settings.api_key': { zh: 'API Key', en: 'API Key' },
  'settings.api_key_desc': { zh: '用于调用 API 获取余额和用量数据。', en: 'Used to call API for balance and usage data.' },
  'settings.save': { zh: '验证并保存', en: 'Verify & Save' },
  'settings.clear': { zh: '清除 Key', en: 'Clear Key' },
  'settings.verified': { zh: '已配置', en: 'Configured' },
  'settings.not_configured': { zh: '未配置', en: 'Not configured' },
  'settings.general': { zh: '通用', en: 'General' },
  'settings.autostart': { zh: '开机自启', en: 'Auto Start' },
  'settings.autostart_desc': { zh: '开启后，每次登录 Windows 时自动启动应用。', en: 'Auto start on Windows login.' },
  'settings.always_on_top': { zh: '窗口置顶', en: 'Always on Top' },
  'settings.always_on_top_desc': { zh: '开启后，应用窗口保持在其他窗口之上。', en: 'Keep the app window on top of other windows.' },
  'settings.auto_refresh': { zh: '自动刷新', en: 'Auto Refresh' },
  'settings.auto_refresh_desc': { zh: '开启后，按设定周期自动拉取最新数据。', en: 'Automatically fetch latest data at set intervals.' },
  'settings.window_size': { zh: '窗口大小', en: 'Window Size' },
  'settings.window_desc': { zh: '选择预设窗口尺寸，或拖拽窗口边缘自由调整。', en: 'Choose a preset size or drag window edges.' },
  'settings.compact': { zh: '紧凑', en: 'Compact' },
  'settings.standard': { zh: '标准', en: 'Standard' },
  'settings.wide': { zh: '宽屏', en: 'Wide' },
  'settings.large': { zh: '大屏', en: 'Large' },
  'settings.about': { zh: '关于', en: 'About' },
  'settings.version': { zh: '当前版本', en: 'Version' },
  'settings.check_update': { zh: '检查更新', en: 'Check for Updates' },
  'settings.checking': { zh: '检查中…', en: 'Checking…' },
  'settings.latest': { zh: '已是最新版本', en: 'Up to date' },
  'settings.update_found': { zh: '发现新版本', en: 'Update available' },
  'settings.download_update': { zh: '下载更新', en: 'Download Update' },
  'settings.downloading_update': { zh: '正在下载更新…', en: 'Downloading update…' },
  'settings.update_installed': { zh: '更新已下载，即将安装', en: 'Update downloaded, installing soon' },
  'settings.cat_account': { zh: '账户', en: 'Account' },
  'settings.cat_general': { zh: '通用', en: 'General' },
  'settings.cat_display': { zh: '显示', en: 'Display' },
  'settings.cat_data': { zh: '数据', en: 'Data' },
  'settings.cat_about': { zh: '关于', en: 'About' },
  'settings.theme': { zh: '主题', en: 'Theme' },
  'settings.theme_desc': { zh: '选择深色、浅色或跟随系统主题。', en: 'Choose dark, light, or follow system theme.' },
  'settings.theme_light': { zh: '浅色', en: 'Light' },
  'settings.theme_dark': { zh: '深色', en: 'Dark' },
  'settings.theme_system': { zh: '跟随系统', en: 'System' },
  'settings.currency': { zh: '货币单位', en: 'Currency' },
  'settings.currency_desc': { zh: '选择显示金额的货币类型。', en: 'Choose currency for amounts displayed.' },
  'settings.efficiency': { zh: '效率单位', en: 'Efficiency Unit' },
  'settings.efficiency_desc': { zh: '选择显示效率指标的方向。', en: 'Choose efficiency metric direction.' },
  'settings.token_per_currency': { zh: 'MT/¥', en: 'MT/$' },
  'settings.currency_per_token': { zh: '¥/MT', en: '$/MT' },
  'settings.language': { zh: '语言', en: 'Language' },
  'settings.language_desc': { zh: '选择界面显示语言。', en: 'Choose display language.' },
  'settings.default_provider': { zh: '默认平台', en: 'Default Provider' },
  'settings.currency_cny': { zh: '人民币 (¥)', en: 'CNY (¥)' },
  'settings.currency_usd': { zh: '美元 ($)', en: 'USD ($)' },
  'settings.clear_cache': { zh: '清除缓存', en: 'Clear Cache' },
  'settings.clear_cache_desc': { zh: '清除本地缓存的使用数据，下次启动时重新获取。', en: 'Clear local cached usage data, refresh on next launch.' },
  'settings.notify_cooldown': { zh: '通知冷却时间', en: 'Notification Cooldown' },
  'settings.notify_cooldown_desc': { zh: '两次余额不足通知之间的最小间隔。', en: 'Minimum interval between low balance notifications.' },

  // 缓存
  'settings.cache_title': { zh: '缓存管理', en: 'Cache Management' },
  'settings.auto_clear_cache': { zh: '自动清理过期缓存', en: 'Auto-clear old cache' },
  'settings.auto_clear_cache_desc': { zh: '开启后每次启动自动清除超过一年的用量缓存。关闭时缓存持续累积可导出，但主页面仅展示近一年数据。', en: 'When enabled, clears usage cache older than 1 year on each startup. When disabled, cache accumulates for export but only the past year is displayed.' },
  'settings.reload_cache': { zh: '重新加载缓存', en: 'Reload Cache' },
  'settings.reload_cache_desc': { zh: '强制重新获取过去一年的所有用量数据，与本地缓存比对后覆盖。用量明细加载失败时可点击重试。', en: 'Force re-fetch all usage data for the past year, compare with local cache and overwrite. Click to retry if usage details fail to load.' },

  // 通知
  'notify.title': { zh: '通知', en: 'Notifications' },
  'notify.toggle': { zh: '余额不足时发送 Windows 通知', en: 'Notify on low balance' },
  'notify.desc': { zh: '当 API 余额低于设定阈值时，通过 Windows 通知提醒。', en: 'Send Windows notification when balance drops below threshold.' },
  'notify.threshold': { zh: '阈值', en: 'Threshold' },

  // DeepSeek 用量同步
  'usage.title': { zh: '用量同步 Token', en: 'Usage Sync Token' },
  'usage.desc': { zh: '用于同步 Token 用量、消费和趋势图。需网页登录 token。', en: 'Sync token usage and trends. Requires web login token.' },
  'usage.auto_sync': { zh: '网页登录自动同步', en: 'Web Login Auto Sync' },
  'usage.waiting': { zh: '等待登录', en: 'Waiting for login' },
  'usage.manual': { zh: '方式二：手动粘贴 token', en: 'Method 2: Paste token manually' },
  'usage.manual_collapse': { zh: '收起手动粘贴', en: 'Collapse manual paste' },
  'usage.save_token': { zh: '保存 Token', en: 'Save Token' },
  'usage.clear_token': { zh: '清除 Token', en: 'Clear Token' },

  // MiMo
  'mimo.login': { zh: 'MiMo 登录', en: 'MiMo Login' },
  'mimo.login_desc': { zh: '通过小米账号登录 MiMo 平台，登录成功后即可查看余额和用量数据。', en: 'Login to MiMo with Xiaomi account to view balance and usage.' },
  'mimo.login_btn': { zh: '打开 MiMo 登录', en: 'Open MiMo Login' },
  'mimo.opening': { zh: '正在打开…', en: 'Opening…' },
  'mimo.no_key': { zh: 'MiMo 平台通过小米账号登录认证，无需 API Key。', en: 'MiMo uses Xiaomi account login, no API Key needed.' },
  'mimo.not_logged_in': { zh: 'MiMo 未登录，请在设置中重新登录小米账号', en: 'MiMo not logged in, please re-login in settings' },

  // 图表
  'chart.cache_hit': { zh: '缓存命中明细', en: 'Cache Hit Details' },
  'chart.hit': { zh: '命中', en: 'Hit' },
  'chart.miss': { zh: '未命中', en: 'Miss' },
  'chart.output': { zh: '输出', en: 'Output' },
  'chart.hit_rate': { zh: '命中率', en: 'Hit Rate' },
  'chart.total': { zh: '合计', en: 'Total' },
  'chart.this_week': { zh: '本周', en: 'This week' },
  'chart.last_week': { zh: '上周', en: 'Last week' },
  'chart.weeks_ago': { zh: '周前', en: 'weeks ago' },
  'chart.input_hit': { zh: '输入（命中缓存）', en: 'Input (cache hit)' },
  'chart.input_miss': { zh: '输入（未命中缓存）', en: 'Input (cache miss)' },

  // 模型详情
  'detail.requests': { zh: 'API 请求次数', en: 'API Requests' },
  'detail.daily': { zh: '按日 Token 消耗', en: 'Daily Token Usage' },
  'detail.back': { zh: '返回主面板', en: 'Back to Dashboard' },

  // 导航
  'nav.refresh': { zh: '刷新', en: 'Refresh' },
  'nav.settings': { zh: '设置', en: 'Settings' },
  'nav.close': { zh: '关闭', en: 'Close' },
};

let currentLang: Lang = 'zh';

export function setLang(lang: Lang) {
  currentLang = lang;
  try { localStorage.setItem('dsm-lang', lang); } catch {}
}

export function getLang(): Lang {
  return currentLang;
}

export function initLang() {
  try {
    const saved = localStorage.getItem('dsm-lang');
    if (saved === 'en' || saved === 'zh') currentLang = saved as Lang;
  } catch {}
}

export function t(key: string): string {
  const entry = translations[key];
  if (!entry) return key;
  return entry[currentLang] || entry['zh'] || key;
}
