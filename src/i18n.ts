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
  'app.unconfigured_usage_token': { zh: '未配置用量 Token', en: 'Usage token not configured' },
  'app.unavailable': { zh: '不可用', en: 'Unavailable' },
  'app.no_data': { zh: '暂无数据', en: 'No data' },
  'app.tokens': { zh: 'tokens', en: 'tokens' },

  // 平台
  'provider.deepseek_monitor': { zh: 'DeepSeek Monitor', en: 'DeepSeek Monitor' },
  'provider.mimo_monitor': { zh: 'MiMo Monitor', en: 'MiMo Monitor' },

  // 余额
  'balance.title': { zh: '账户余额', en: 'Account Balance' },
  'balance.available': { zh: '可用', en: 'Available' },
  'balance.insufficient': { zh: '余额不足', en: 'Insufficient' },
  'balance.today': { zh: '当日消耗', en: 'Today' },
  'balance.monthly': { zh: '本月消费', en: 'This Month' },
  'balance.total_cost': { zh: '累计消费', en: 'Total Cost' },

  // 用量行
  'usage.cache_hit': { zh: '缓存命中', en: 'Cache hit' },
  'usage.unavailable': { zh: '用量不可用', en: 'Usage unavailable' },
  'usage.no_data': { zh: '暂无用量数据', en: 'No usage data' },

  // 设置
  'settings.title': { zh: '设置', en: 'Settings' },
  'settings.api_key': { zh: 'API Key', en: 'API Key' },
  'settings.api_key_desc': { zh: '用于调用 API 获取余额和用量数据。', en: 'Used to call API for balance and usage data.' },
  'settings.api_key_local': { zh: 'API Key 只在当前这台 Windows 电脑本地保留。', en: 'API Key stays only on this Windows PC.' },
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

  // 缓存 / 数据
  'settings.cache_title': { zh: '缓存管理', en: 'Cache Management' },
  'settings.auto_clear_cache': { zh: '自动清理过期缓存', en: 'Auto-clear old cache' },
  'settings.auto_clear_cache_desc': { zh: '开启后每次启动自动清除超过一年的用量缓存。关闭时缓存持续累积可导出，但主页面仅展示近一年数据。', en: 'When enabled, clears usage cache older than 1 year on each startup. When disabled, cache accumulates for export but only the past year is displayed.' },
  'settings.reload_cache': { zh: '重新加载缓存', en: 'Reload Cache' },
  'settings.reload_cache_desc': { zh: '强制重新获取历史范围内的所有用量数据，与本地缓存比对后覆盖。用量明细加载失败时可点击重试。', en: 'Force re-fetch all usage data within the history range, compare with local cache and overwrite. Click to retry if usage details fail to load.' },
  'settings.history_depth': { zh: '历史数据深度', en: 'History Depth' },
  'settings.history_depth_desc': { zh: '主面板加载的历史月份数量。MiMo 平台较早日期的数据可能不可用。', en: 'Number of historical months loaded on the main panel. Older MiMo data may be unavailable.' },
  'settings.history_12': { zh: '12 个月', en: '12 months' },
  'settings.history_24': { zh: '24 个月', en: '24 months' },
  'settings.history_36': { zh: '36 个月', en: '36 months' },
  'settings.export_title': { zh: '导出使用数据', en: 'Export Usage Data' },
  'settings.export_desc': { zh: '导出缓存的使用数据（余额、用量等），支持格式、平台和日期范围筛选。', en: 'Export cached usage data (balance, usage) with format, platform and date range filters.' },
  'settings.format': { zh: '格式：', en: 'Format:' },
  'settings.platform': { zh: '平台：', en: 'Platform:' },
  'settings.all': { zh: '全部', en: 'All' },
  'settings.export_btn': { zh: '导出 {fmt}', en: 'Export {fmt}' },
  'settings.export_range': { zh: '日期范围：', en: 'Date range:' },
  'settings.export_range_desc': { zh: '仅导出所选月份范围内的使用数据。', en: 'Only export usage data within the selected month range.' },
  'settings.from_month': { zh: '从', en: 'From' },
  'settings.to_month': { zh: '至', en: 'To' },
  'settings.import_title': { zh: '导入使用数据', en: 'Import Usage Data' },
  'settings.import_desc': { zh: '从 JSON 文件导入使用数据，将覆盖当前缓存。', en: 'Import usage data from a JSON file, overwriting current cache.' },
  'settings.import_btn': { zh: '导入使用数据', en: 'Import Usage Data' },
  'settings.import_ok': { zh: '使用数据已导入，刷新页面生效', en: 'Imported. Takes effect after refresh.' },
  'settings.import_fail': { zh: '导入失败：文件格式错误', en: 'Import failed: invalid file format.' },
  'settings.reload_ok': { zh: '✓ 缓存已重新加载', en: '✓ Cache reloaded' },
  'settings.reload_fail': { zh: '✗ 加载失败，请重试', en: '✗ Failed, please retry' },
  'settings.loading': { zh: '加载中…', en: 'Loading…' },
  'settings.config_path': { zh: '配置文件：', en: 'Config file:' },
  'settings.view_changelog': { zh: '查看更新日志', en: 'View changelog' },
  'settings.hide_changelog': { zh: '收起更新日志', en: 'Hide changelog' },
  'settings.changelog_fail': { zh: '获取更新日志失败', en: 'Failed to fetch changelog' },
  'settings.reading_config': { zh: '正在读取本地配置', en: 'Reading local config…' },
  'settings.browser_preview': { zh: '浏览器预览模式', en: 'Browser preview mode' },
  'settings.clipboard_read': { zh: '已从剪贴板读取', en: 'Read from clipboard' },
  'settings.clipboard_fail': { zh: '剪贴板读取失败', en: 'Clipboard read failed' },
  'settings.saving_key': { zh: '已保存，正在验证 Key…', en: 'Saved, verifying key…' },
  'settings.verify_ok': { zh: '验证通过，当前余额', en: 'Verified. Current balance' },
  'settings.balance_low_suffix': { zh: '（余额不足）', en: ' (insufficient)' },
  'settings.save_verify_fail': { zh: '保存或验证失败', en: 'Save or verify failed' },
  'settings.cleared_key': { zh: '已清除 API Key', en: 'API Key cleared' },
  'settings.clear_fail': { zh: '清除失败', en: 'Clear failed' },
  'settings.configured_prefix': { zh: '已配置', en: 'Configured' },
  'settings.api_key_unconfigured': { zh: '未配置 API Key', en: 'API Key not configured' },
  'settings.token_configured': { zh: '用量 Token 已配置', en: 'Usage token configured' },
  'settings.token_unconfigured': { zh: '未配置用量 Token', en: 'Usage token not configured' },
  'settings.ds_refresh_interval': { zh: 'DeepSeek 刷新间隔', en: 'DeepSeek refresh interval' },
  'settings.mimo_refresh_interval': { zh: 'MiMo 刷新间隔', en: 'MiMo refresh interval' },
  'settings.minutes': { zh: '分钟', en: 'min' },
  'settings.custom': { zh: '自定义', en: 'Custom' },
  'settings.refresh_1m': { zh: '1 分钟', en: '1 min' },
  'settings.refresh_5m': { zh: '5 分钟', en: '5 min' },
  'settings.refresh_30m': { zh: '30 分钟', en: '30 min' },
  'settings.refresh_1h': { zh: '1 小时', en: '1 hour' },
  'settings.cooldown_10m': { zh: '10 分钟', en: '10 min' },
  'settings.cooldown_30m': { zh: '30 分钟', en: '30 min' },
  'settings.cooldown_1h': { zh: '1 小时', en: '1 hour' },
  'settings.cooldown_3h': { zh: '3 小时', en: '3 hours' },
  'settings.cooldown_6h': { zh: '6 小时', en: '6 hours' },
  'settings.choose_currency': { zh: '选择金额显示的货币。', en: 'Choose currency for displayed amounts.' },
  'settings.efficiency_way': { zh: '效率指标显示方式：', en: 'Efficiency metric display:' },
  'settings.choose_theme': { zh: '选择应用的外观主题。', en: 'Choose app appearance theme.' },


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
  'usage.get_token_hint': { zh: '获取：浏览器登录 platform.deepseek.com，按 F12 打开控制台，输入 JSON.parse(localStorage.userToken).value 回车，复制返回的字符串。', en: 'Get: login platform.deepseek.com in a browser, press F12, run JSON.parse(localStorage.userToken).value, copy the returned string.' },
  'usage.opening_login': { zh: '正在打开登录窗口…', en: 'Opening login window…' },
  'usage.reopen_hint': { zh: '登录完成后，再次点击本按钮即可同步用量（可多点几次）', en: 'After login, click this button again to sync usage (may need a few clicks)' },
  'usage.open_fail': { zh: '打开登录窗口失败', en: 'Failed to open login window' },
  'usage.synced': { zh: '已通过网页登录自动同步用量 Token', en: 'Usage token auto-synced via web login' },
  'usage.refreshing': { zh: '，正在刷新用量数据…', en: ', refreshing usage data…' },
  'usage.month_cost': { zh: '，本月消费 {cost}', en: ', this month {cost}' },
  'usage.refresh_fail': { zh: '，但用量刷新失败：{err}', en: ', but usage refresh failed: {err}' },
  'usage.refresh_err': { zh: '刷新失败', en: 'Refresh failed' },
  'usage.sync_ended': { zh: '登录窗口已关闭，Token 未获取到。可重新点击同步或使用方式二手动粘贴。', en: 'Login window closed without a token. Click sync again or paste manually.' },
  'usage.saving_token': { zh: '已保存，正在验证用量 Token…', en: 'Saved, verifying usage token…' },
  'usage.manual_saved': { zh: '手动 Token 已保存', en: 'Manual token saved' },
  'usage.cleared_token': { zh: '已清除用量 Token', en: 'Usage token cleared' },
  'usage.save_fail': { zh: '保存或验证失败', en: 'Save or verify failed' },

  // MiMo
  'mimo.login': { zh: 'MiMo 登录', en: 'MiMo Login' },
  'mimo.login_desc': { zh: '通过小米账号登录 MiMo 平台，登录成功后即可查看余额和用量数据。', en: 'Login to MiMo with Xiaomi account to view balance and usage.' },
  'mimo.login_btn': { zh: '打开 MiMo 登录', en: 'Open MiMo Login' },
  'mimo.opening': { zh: '正在打开…', en: 'Opening…' },
  'mimo.no_key': { zh: 'MiMo 平台通过小米账号登录认证，无需 API Key。', en: 'MiMo uses Xiaomi account login, no API Key needed.' },
  'mimo.not_logged_in': { zh: 'MiMo 未登录，请在设置中重新登录小米账号', en: 'MiMo not logged in, please re-login in settings' },
  'mimo.not_logged_in_short': { zh: 'MiMo 未登录', en: 'MiMo not logged in' },
  'mimo.opening_page': { zh: '正在打开 MiMo 页面…', en: 'Opening MiMo page…' },
  'mimo.opened_confirm': { zh: '登录窗口已打开，请确认已登录小米账号', en: 'Login window opened, please confirm Xiaomi login' },
  'mimo.login_hint': { zh: '请在打开的窗口中登录小米账号，登录后保持窗口打开', en: 'Login to Xiaomi in the opened window and keep it open' },
  'mimo.sync_fail': { zh: '启动同步失败', en: 'Failed to start sync' },


  // 图表
  'chart.cache_hit': { zh: '缓存命中明细', en: 'Cache Hit Details' },
  'chart.hit': { zh: '命中', en: 'Hit' },
  'chart.miss': { zh: '未命中', en: 'Miss' },
  'chart.output': { zh: '输出', en: 'Output' },
  'chart.hit_rate': { zh: '命中率', en: 'Hit Rate' },
  'chart.total': { zh: '合计', en: 'Total' },
  'chart.this_week': { zh: '本周', en: 'This week' },
  'chart.last_week': { zh: '上周', en: 'Last week' },
  'chart.weeks_ago': { zh: '{n}周前', en: '{n}w ago' },
  'chart.input_hit': { zh: '输入（命中缓存）', en: 'Input (cache hit)' },
  'chart.input_miss': { zh: '输入（未命中缓存）', en: 'Input (cache miss)' },
  'chart.avg_price': { zh: '平均单价', en: 'Avg. price' },
  'chart.prev_week': { zh: '上一周', en: 'Previous week' },
  'chart.next_week': { zh: '下一周', en: 'Next week' },

  // 模型详情
  'detail.requests': { zh: 'API 请求次数', en: 'API Requests' },
  'detail.daily': { zh: '按日 Token 消耗', en: 'Daily Token Usage' },
  'detail.back': { zh: '返回主面板', en: 'Back to Dashboard' },

  // 导航
  'nav.refresh': { zh: '刷新', en: 'Refresh' },
  'nav.settings': { zh: '设置', en: 'Settings' },
  'nav.close': { zh: '关闭', en: 'Close' },
  'nav.theme': { zh: '切换主题', en: 'Toggle theme' },
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

/** 支持 {placeholder} 替换的翻译 */
export function tpl(key: string, vars: Record<string, string | number>): string {
  let s = t(key);
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}
