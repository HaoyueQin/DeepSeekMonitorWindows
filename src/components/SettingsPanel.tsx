import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import {
  BarChart3, CheckCircle2, Info, KeyRound, Power, Settings, X,
  User, Monitor, Bell, Palette, Globe, ChevronRight, ChevronLeft,
} from "lucide-react";
import type { Provider, AppConfig, BalanceData, MimoBalanceData, BalanceState, UsageResult, MimoUsageResult } from "../types";
import { fmtMoney } from "../utils";
import { t, getLang, setLang, type Lang, LANG_OPTIONS, PINNED_LANGS } from "../i18n";

const refreshOptions = [
  { label: "1 分钟", value: 60 },
  { label: "5 分钟", value: 300 },
  { label: "30 分钟", value: 1800 },
  { label: "1 小时", value: 3600 },
];

// ─── SettingsPanel ─────────────────────────────────────────
export function SettingsPanel({ provider, onProviderChange, onBack, onUsageLoaded, onUsageCleared, onRefreshIntervalChanged, onAutoRefreshChanged, onCurrencyChanged }: {
  provider: Provider; onProviderChange: (p: Provider) => void; onBack: () => void;
  onUsageLoaded: (usage: UsageResult | MimoUsageResult) => void; onUsageCleared: () => void;
  onRefreshIntervalChanged: (seconds: number) => void; onAutoRefreshChanged: (enabled: boolean) => void;
  onCurrencyChanged: (currency: "cny" | "usd") => void;
}) {
  const [apiKey, setApiKey] = React.useState("");
  const [config, setConfig] = React.useState<AppConfig | null>(null);
  const [status, setStatus] = React.useState("正在读取本地配置");
  const [busy, setBusy] = React.useState(false);
  const [refresh, setRefresh] = React.useState(60);
  const [autoRefresh, setAutoRefresh] = React.useState(false);
  const [autostart, setAutostart] = React.useState(false);
  const [lowBalanceNotify, setLowBalanceNotify] = React.useState(false);
  const [lowBalanceThreshold, setLowBalanceThreshold] = React.useState("5.00");
  const [usageToken, setUsageToken] = React.useState("");
  const [usageStatus, setUsageStatus] = React.useState("");
  const [usageSyncing, setUsageSyncing] = React.useState(false);
  const [showManualPaste, setShowManualPaste] = React.useState(false);
  const [appVersion, setAppVersion] = React.useState("1.1.0");
  const [mimoStatus, setMimoStatus] = React.useState("");
  const [mimoSyncing, setMimoSyncing] = React.useState(false);
  const [checkingUpdate, setCheckingUpdate] = React.useState(false);
  const [updateInfo, setUpdateInfo] = React.useState<{ version: string; date: string; body: string } | null>(null);
  const [updateChecked, setUpdateChecked] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);
  const [downloadProgress, setDownloadProgress] = React.useState<{ downloaded: number; total: number | null } | null>(null);
  const [downloadDone, setDownloadDone] = React.useState(false);
  const [activeCategory, setActiveCategory] = React.useState<string | null>(null);
  const [theme, setTheme] = React.useState<"light" | "dark" | "system">("light");
  const [currency, setCurrency] = React.useState<"cny" | "usd">("cny");
  const [efficiencyUnit, setEfficiencyUnit] = React.useState<"token_per_currency" | "currency_per_token">("token_per_currency");
  const configPath = config?.configPath ?? "%APPDATA%\\DeepSeekMonitorWindows\\config.json";

  React.useEffect(() => {
    void invoke<AppConfig>("get_app_config").then((c) => { setConfig(c); setRefresh(c.refreshIntervalSeconds || 60); setAutoRefresh(c.autoRefreshEnabled); setAutostart(c.autostart); setLowBalanceNotify(c.lowBalanceNotify || false); setLowBalanceThreshold(String(c.lowBalanceThreshold || 5.00)); setStatus(c.apiKeyConfigured ? `已配置 ${c.apiKeyPreview}` : "未配置 API Key"); setUsageStatus(c.usageTokenConfigured ? "用量 Token 已配置" : "未配置用量 Token"); setTheme(c.theme || "light"); setCurrency(c.currency || "cny"); setEfficiencyUnit(c.efficiencyUnit || "token_per_currency"); }).catch(() => setStatus("浏览器预览模式"));
  }, []);
  React.useEffect(() => { void getVersion().then(setAppVersion).catch(() => setAppVersion("1.1.0")); }, []);

  const fetchCurrentUsage = React.useCallback(async () => {
    const { invoke: inv } = await import("@tauri-apps/api/core");
    const { addDays, previousMonth } = await import("../utils");
    const now = new Date();
    const current: UsageResult = await inv("fetch_usage", { month: now.getMonth() + 1, year: now.getFullYear() });
    const needsPrev = addDays(now, -6).getMonth() !== now.getMonth();
    if (!needsPrev) return current;
    try {
      const prev = previousMonth(now);
      const prevUsage: UsageResult = await inv("fetch_usage", { month: prev.month, year: prev.year });
      return { ...current, days: [...prevUsage.days, ...current.days] };
    } catch { return current; }
  }, []);

  const refreshUsageAfterToken = React.useCallback((prefix: string) => {
    setUsageStatus(`${prefix}，正在刷新用量数据…`);
    return fetchCurrentUsage().then((u) => { onUsageLoaded(u); setUsageStatus(`${prefix}，本月消费 ${fmtMoney(u.monthCost)}`); return u; }).catch((e) => { setUsageStatus(`${prefix}，但用量刷新失败：${typeof e === "string" ? e : "刷新失败"}`); throw e; });
  }, [onUsageLoaded, fetchCurrentUsage]);

  React.useEffect(() => { const p = listen<AppConfig>("usage-token-captured", (e) => { setConfig(e.payload); setUsageSyncing(false); void refreshUsageAfterToken("已通过网页登录自动同步用量 Token"); }); return () => { void p.then((u) => u()); }; }, [refreshUsageAfterToken]);
  React.useEffect(() => { const p = listen("usage-sync-ended", () => { setUsageSyncing(false); setUsageStatus("登录窗口已关闭，Token 未获取到。可重新点击同步或使用方式二手动粘贴。"); }); return () => { void p.then((u) => u()); }; }, []);
  React.useEffect(() => { const p = listen("mimo-sync-started", () => { setMimoStatus("请在打开的窗口中登录小米账号，登录后保持窗口打开"); }); return () => { void p.then((u) => u()); }; }, []);

  const pasteApiKey = React.useCallback(async () => { try { setApiKey((await navigator.clipboard.readText()).trim()); setStatus("已从剪贴板读取"); } catch { setStatus("剪贴板读取失败"); } }, []);
  const saveApiKey = React.useCallback(() => { setBusy(true); void invoke<AppConfig>("save_api_key", { apiKey }).then((c) => { setConfig(c); setApiKey(""); setStatus("已保存，正在验证 Key…"); return invoke<BalanceData>("fetch_balance"); }).then((b) => { setStatus(`验证通过，当前余额 ${b.currency === "USD" ? "$" : "¥"}${b.totalBalance}${b.isAvailable ? "" : "（余额不足）"}`); }).catch((e) => { setStatus(typeof e === "string" ? e : "保存或验证失败"); }).finally(() => setBusy(false)); }, [apiKey]);
  const clearApiKey = React.useCallback(() => { setBusy(true); void invoke<AppConfig>("clear_api_key").then((c) => { setConfig(c); setApiKey(""); setStatus("已清除 API Key"); }).catch((e) => { setStatus(typeof e === "string" ? e : "清除失败"); }).finally(() => setBusy(false)); }, []);
  const pasteUsageToken = React.useCallback(async () => { try { setUsageToken((await navigator.clipboard.readText()).trim()); setUsageStatus("已从剪贴板读取"); } catch { setUsageStatus("剪贴板读取失败"); } }, []);
  const startUsageSync = React.useCallback(() => { setUsageSyncing(true); setUsageStatus("正在打开登录窗口…"); void invoke<boolean>("start_usage_sync").then((s) => { if (!s) setUsageStatus("登录完成后，再次点击本按钮即可同步用量（可多点几次）"); }).catch((e) => { setUsageStatus(typeof e === "string" ? e : "打开登录窗口失败"); }).finally(() => { window.setTimeout(() => setUsageSyncing(false), 2500); }); }, []);
  const saveUsageToken = React.useCallback(() => { setBusy(true); void invoke<AppConfig>("save_usage_token", { usageToken }).then((c) => { setConfig(c); setUsageToken(""); setUsageStatus("已保存，正在验证用量 Token…"); return refreshUsageAfterToken("手动 Token 已保存"); }).catch((e) => { setUsageStatus(typeof e === "string" ? e : "保存或验证失败"); }).finally(() => setBusy(false)); }, [refreshUsageAfterToken, usageToken]);
  const clearUsageToken = React.useCallback(() => { setBusy(true); void invoke<AppConfig>("clear_usage_token").then((c) => { setConfig(c); setUsageToken(""); setUsageStatus("已清除用量 Token"); onUsageCleared(); }).catch((e) => { setUsageStatus(typeof e === "string" ? e : "清除失败"); }).finally(() => setBusy(false)); }, [onUsageCleared]);
  const startMimoSync = React.useCallback(() => { setMimoSyncing(true); setMimoStatus("正在打开 MiMo 页面…"); void invoke<boolean>("start_mimo_sync").then((a) => { setMimoStatus(a ? "登录窗口已打开，请确认已登录小米账号" : "请在打开的窗口中登录小米账号，登录后保持窗口打开"); setMimoSyncing(false); }).catch((e) => { setMimoStatus(typeof e === "string" ? e : "启动同步失败"); setMimoSyncing(false); }); }, []);
  const saveRefreshInterval = React.useCallback((s: number) => { const p = refresh; setRefresh(s); onRefreshIntervalChanged(s); void invoke<AppConfig>("save_refresh_interval", { refreshIntervalSeconds: s }).then((c) => { setConfig(c); setRefresh(c.refreshIntervalSeconds || 60); onRefreshIntervalChanged(c.refreshIntervalSeconds || 60); }).catch(() => { setRefresh(p); onRefreshIntervalChanged(p); }); }, [onRefreshIntervalChanged, refresh]);
  const saveAutoRefreshEnabled = React.useCallback((e: boolean) => { const p = autoRefresh; setAutoRefresh(e); onAutoRefreshChanged(e); void invoke<AppConfig>("save_auto_refresh_enabled", { autoRefreshEnabled: e }).then((c) => { setConfig(c); setAutoRefresh(c.autoRefreshEnabled); onAutoRefreshChanged(c.autoRefreshEnabled); }).catch(() => { setAutoRefresh(p); onAutoRefreshChanged(p); }); }, [autoRefresh, onAutoRefreshChanged]);
  const saveAutostart = React.useCallback((e: boolean) => { const p = autostart; setAutostart(e); void invoke<AppConfig>("save_autostart", { autostart: e }).then((c) => { setConfig(c); setAutostart(c.autostart); }).catch(() => setAutostart(p)); }, [autostart]);

  const saveLowBalanceNotify = React.useCallback((e: boolean) => {
    const p = lowBalanceNotify; setLowBalanceNotify(e);
    void invoke<AppConfig>("save_low_balance_notify", { enabled: e }).then((c) => { setConfig(c); setLowBalanceNotify(c.lowBalanceNotify); }).catch(() => setLowBalanceNotify(p));
  }, [lowBalanceNotify]);
  const saveLowBalanceThreshold = React.useCallback((val: string) => {
    setLowBalanceThreshold(val);
    const num = parseFloat(val);
    if (!isNaN(num) && num >= 0) {
      void invoke<AppConfig>("save_low_balance_threshold", { threshold: num }).then((c) => { setConfig(c); }).catch(() => {});
    }
  }, []);

  const saveTheme = React.useCallback((val: "light" | "dark" | "system") => {
    const prev = theme; setTheme(val);
    // Apply theme immediately
    const apply = val === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : val;
    document.documentElement.setAttribute("data-theme", apply);
    void invoke<AppConfig>("save_theme", { theme: val }).then((c) => { setConfig(c); }).catch(() => setTheme(prev));
  }, [theme]);

  const saveCurrency = React.useCallback((val: "cny" | "usd") => {
    const prev = currency; setCurrency(val);
    onCurrencyChanged(val);
    void invoke<AppConfig>("save_currency", { currency: val }).then((c) => { setConfig(c); }).catch(() => { setCurrency(prev); onCurrencyChanged(prev); });
  }, [currency, onCurrencyChanged]);

  const saveEfficiencyUnit = React.useCallback((val: "token_per_currency" | "currency_per_token") => {
    const prev = efficiencyUnit; setEfficiencyUnit(val);
    void invoke<AppConfig>("save_efficiency_unit", { unit: val }).then((c) => { setConfig(c); }).catch(() => setEfficiencyUnit(prev));
  }, [efficiencyUnit]);

  // Apply theme on mount and when theme changes
  React.useEffect(() => {
    const apply = theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
    document.documentElement.setAttribute("data-theme", apply);
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent) => {
        document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
      };
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [theme]);

  const handleCheckUpdate = React.useCallback(() => {
    setCheckingUpdate(true);
    setUpdateChecked(false);
    setUpdateInfo(null);
    setDownloadDone(false);
    setDownloadProgress(null);
    void invoke<{ version: string; date: string; body: string } | null>("check_update")
      .then((info) => {
        setUpdateInfo(info);
        setUpdateChecked(true);
      })
      .catch((err) => {
        setUpdateChecked(true);
        setUpdateInfo(null);
        console.warn("检查更新失败:", err);
      })
      .finally(() => setCheckingUpdate(false));
  }, []);

  const handleInstallUpdate = React.useCallback(async () => {
    setDownloading(true);
    setDownloadProgress(null);
    setDownloadDone(false);
    try {
      const { Channel } = await import("@tauri-apps/api/core");
      const onEvent = new Channel<{ event: string; data?: { contentLength?: number; chunkLength?: number; downloaded?: number } }>();
      onEvent.onmessage = (msg) => {
        if (msg.event === "Started") {
          setDownloadProgress({ downloaded: 0, total: msg.data?.contentLength ?? null });
        } else if (msg.event === "Progress") {
          // Use server-side cumulative downloaded value directly
          setDownloadProgress((prev) => ({ downloaded: msg.data?.downloaded ?? prev?.downloaded ?? 0, total: prev?.total ?? null }));
        } else if (msg.event === "Finished") {
          setDownloadDone(true);
          setDownloading(false);
        }
      };
      await invoke("install_update", { onEvent });
      // On Windows/NSIS, the process exits during install — this line is unreachable.
      // The NSIS installer handles restart via its /UPDATE flag.
    } catch (e) {
      console.warn("下载安装失败:", e);
      setDownloading(false);
      setDownloadDone(false);
      setDownloadProgress(null);
    }
  }, []);

  const [lang, setLangState] = React.useState(getLang());

  const [langOpen, setLangOpen] = React.useState(false);
  const langRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const handler = (e: MouseEvent) => { if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const currentLangLabel = LANG_OPTIONS.find(l => l.code === lang)?.label || '简体中文';

  // Category list view
  const categories = [
    { key: "account", icon: <User size={15} />, label: t('settings.cat_account') },
    { key: "general", icon: <Settings size={15} />, label: t('settings.cat_general') },
    { key: "display", icon: <Monitor size={15} />, label: t('settings.cat_display') },
    { key: "notify", icon: <Bell size={15} />, label: t('notify.title') },
    { key: "about", icon: <Info size={15} />, label: t('settings.cat_about') },
  ];

  // Account category content
  const accountContent = (
    <>
      <SettingsSection icon={<KeyRound size={15} />} title="API Key">
        {provider === "deepseek" ? (
          <>
            <p>用于调用 DeepSeek API 获取余额和用量数据。当前 Windows 版本会保存在应用本地设置中。</p>
            <p className="muted">API Key 只在当前这台 Windows 电脑本地保留。</p>
            <p className="muted config-path"><span>本地位置：</span><span>{configPath}</span></p>
            <div className="key-row"><input aria-label="API Key" type="password" maxLength={256} value={apiKey} placeholder={config?.apiKeyConfigured ? "••••••••••••••••••••••••••••••••••••••••••••••••••" : "sk-..."} onChange={(e) => setApiKey(e.target.value)} /></div>
            <div className="settings-actions">
              <button className="primary" onClick={saveApiKey} disabled={busy || !apiKey.trim()}>验证并保存</button>
              <span className={config?.apiKeyConfigured ? "configured" : "configured muted-status"}><CheckCircle2 size={17} />{config?.apiKeyConfigured ? "已配置" : "未配置"}</span>
              <button className="secondary" onClick={clearApiKey} disabled={busy || !config?.apiKeyConfigured}>清除 Key</button>
            </div>
          </>
        ) : <p>MiMo 平台通过小米账号登录认证，无需 API Key。切换到 MiMo 后会自动弹出登录窗口。</p>}
      </SettingsSection>
      {provider === "deepseek" ? (
        <SettingsSection icon={<BarChart3 size={15} />} title="用量同步 Token">
          <p>用于同步 Token 用量、消费和趋势图。DeepSeek 无官方用量 API，需网页登录 token（与上面的 API Key 不同）。</p>
          <p className="muted">方式一网页登录自动同步</p>
          <div className="settings-actions usage-sync-actions">
            <button className="primary" onClick={startUsageSync} disabled={usageSyncing}>{usageSyncing ? "等待登录" : "网页登录自动同步"}</button>
            <span className={config?.usageTokenConfigured ? "configured" : "configured muted-status"}><CheckCircle2 size={17} />{config?.usageTokenConfigured ? "已配置" : "未配置"}</span>
            <button className="secondary" onClick={clearUsageToken} disabled={busy || !config?.usageTokenConfigured}>清除 Token</button>
          </div>
          <p className="muted">{usageStatus}</p>
          <button className="link-button" onClick={() => setShowManualPaste((v) => !v)}>{showManualPaste ? "收起手动粘贴" : "方式二：手动粘贴 token"}</button>
          {showManualPaste && (<>
            <p className="muted">获取：浏览器登录 platform.deepseek.com，按 F12 打开控制台，输入 JSON.parse(localStorage.userToken).value 回车，复制返回的字符串。</p>
            <p className="muted">token 会过期，用量查询失败时重新获取一次即可。</p>
            <div className="key-row"><input aria-label="用量 Token" type="password" maxLength={4096} value={usageToken} placeholder={config?.usageTokenConfigured ? "••••••••••••••••••••••••••••••••••••••••••••••••••" : ""} onChange={(e) => setUsageToken(e.target.value)} /></div>
            <div className="settings-actions"><button className="primary" onClick={saveUsageToken} disabled={busy || !usageToken.trim()}>保存 Token</button></div>
          </>)}
        </SettingsSection>
      ) : (
        <SettingsSection icon={<BarChart3 size={15} />} title="MiMo 登录">
          <p>通过小米账号登录 MiMo 平台，登录成功后即可查看余额和用量数据。</p>
          <div className="settings-actions"><button className="primary" onClick={startMimoSync} disabled={mimoSyncing}>{mimoSyncing ? "正在打开…" : "打开 MiMo 登录"}</button></div>
          {mimoStatus && <p className="muted">{mimoStatus}</p>}
        </SettingsSection>
      )}
    </>
  );

  // General category content
  const generalContent = (
    <>
      <SettingsSection icon={<Power size={15} />} title={t('settings.general')}>
        <Toggle label={t('settings.autostart')} checked={autostart} onChange={saveAutostart} />
        <p>{t('settings.autostart_desc')}</p>
        <Toggle label={t('settings.auto_refresh')} checked={autoRefresh} onChange={saveAutoRefreshEnabled} />
        <p>{t('settings.auto_refresh_desc')}</p>
        {autoRefresh && (<div className="segmented">{refreshOptions.map((o) => (<button key={o.value} className={refresh === o.value ? "selected" : ""} onClick={() => saveRefreshInterval(o.value)}>{o.label}</button>))}</div>)}
      </SettingsSection>
      <SettingsSection icon={<Palette size={15} />} title={t('settings.theme')}>
        <p>选择应用的外观主题。</p>
        <div className="segmented">
          {(["light", "dark", "system"] as const).map((opt) => (
            <button key={opt} className={theme === opt ? "selected" : ""} onClick={() => saveTheme(opt)}>
              {opt === "light" ? t('settings.theme_light') : opt === "dark" ? t('settings.theme_dark') : t('settings.theme_system')}
            </button>
          ))}
        </div>
      </SettingsSection>
      <SettingsSection icon={<Globe size={15} />} title={t('settings.language')}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <p style={{ margin: 0 }}>{t('settings.language_desc')}</p>
          <div className="lang-select" ref={langRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              className="lang-select-btn"
              onClick={() => setLangOpen(!langOpen)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', border: '1px solid rgba(var(--fg), 0.2)', borderRadius: 6, background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: '0.85em' }}
            >
              <span>{currentLangLabel}</span>
              <span style={{ fontSize: '0.7em', opacity: 0.6 }}>▼</span>
            </button>
            {langOpen && (
              <div className="lang-dropdown" style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'var(--glass-tooltip-tint)', border: '1px solid rgba(var(--fg), 0.15)', borderRadius: 8, overflow: 'hidden', zIndex: 100, backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', minWidth: 160, maxHeight: 380, overflowY: 'auto' }}>
                {PINNED_LANGS.map((code) => {
                  const opt = LANG_OPTIONS.find(o => o.code === code);
                  if (!opt) return null;
                  return (
                    <button key={'pinned-' + code} onClick={() => { setLang(code); setLangState(code); setLangOpen(false); }}
                      style={{ display: 'block', width: '100%', padding: '8px 12px', border: 'none', background: lang === code ? 'rgba(var(--fg), 0.1)' : 'transparent', color: 'var(--text)', cursor: 'pointer', textAlign: 'left', fontSize: '0.85em' }}>
                      {opt.label}
                    </button>
                  );
                })}
                <div style={{ borderTop: '1px solid rgba(var(--fg), 0.12)', margin: '2px 8px' }} />
                {LANG_OPTIONS.map((opt) => (
                  <button key={opt.code} onClick={() => { setLang(opt.code); setLangState(opt.code); setLangOpen(false); }}
                    style={{ display: 'block', width: '100%', padding: '8px 12px', border: 'none', background: lang === opt.code ? 'rgba(var(--fg), 0.1)' : 'transparent', color: 'var(--text)', cursor: 'pointer', textAlign: 'left', fontSize: '0.85em' }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </SettingsSection>
    </>
  );

  // Display category content
  const displayContent = (
    <>
      <SettingsSection icon={<Palette size={15} />} title={t('settings.currency')}>
        <p>选择金额显示的货币。</p>
        <div className="segmented">
          {(["cny", "usd"] as const).map((opt) => (
            <button key={opt} className={currency === opt ? "selected" : ""} onClick={() => saveCurrency(opt)}>
              {opt === "cny" ? t('settings.currency_cny') : t('settings.currency_usd')}
            </button>
          ))}
        </div>
        <p style={{ marginTop: 12 }}>效率指标显示方式：</p>
        <div className="segmented">
          <button className={efficiencyUnit === "token_per_currency" ? "selected" : ""} onClick={() => saveEfficiencyUnit("token_per_currency")}>
            {currency === "usd" ? "MT/$" : "MT/¥"}
          </button>
          <button className={efficiencyUnit === "currency_per_token" ? "selected" : ""} onClick={() => saveEfficiencyUnit("currency_per_token")}>
            {currency === "usd" ? "$/MT" : "¥/MT"}
          </button>
        </div>
      </SettingsSection>
      <SettingsSection icon={<Settings size={15} />} title={t('settings.window_size')}>
        <p>{t('settings.window_desc')}</p>
        <div className="segmented">
          {[{ label: t('settings.compact'), w: 380, h: 600 }, { label: t('settings.standard'), w: 463, h: 660 }, { label: t('settings.wide'), w: 600, h: 700 }, { label: t('settings.large'), w: 660, h: 900 }].map((preset) => (
            <button key={preset.label} onClick={() => { void invoke("resize_window", { width: preset.w, height: preset.h }).catch(() => {}); }}>{preset.label}</button>
          ))}
        </div>
      </SettingsSection>
    </>
  );

  // Notify category content
  const notifyContent = (
    <SettingsSection icon={<Bell size={15} />} title={t('notify.title')}>
      <Toggle label={t('notify.toggle')} checked={lowBalanceNotify} onChange={saveLowBalanceNotify} />
      <p>{t('notify.desc')}</p>
      {lowBalanceNotify && (
        <div className="key-row" style={{ marginTop: 8 }}>
          <span style={{ fontSize: '0.8em', color: 'var(--text-faint)', marginRight: 8 }}>{t('notify.threshold')}：</span>
          <input type="number" min="0" step="0.01" value={lowBalanceThreshold} onChange={(e) => saveLowBalanceThreshold(e.target.value)} style={{ width: 100 }} />
          <span style={{ fontSize: '0.8em', color: 'var(--text-faint)', marginLeft: 4 }}>{currency === "usd" ? "$" : "¥"}</span>
        </div>
      )}
    </SettingsSection>
  );

  // About category content
  const aboutContent = (
    <SettingsSection icon={<Info size={15} />} title={t('settings.about')}>
      <div className="version-row"><span>{t('settings.version')}</span><strong>v{appVersion}</strong></div>
      <div className="settings-actions" style={{ marginTop: 8 }}>
        {!updateInfo && (
          <button className="primary" onClick={handleCheckUpdate} disabled={checkingUpdate}>
            {checkingUpdate ? t('settings.checking') : t('settings.check_update')}
          </button>
        )}
        {updateInfo && !downloading && !downloadDone && (
          <button className="primary" onClick={handleInstallUpdate}>
            {t('settings.download_update')} v{updateInfo.version}
          </button>
        )}
        {downloading && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ height: 6, borderRadius: 3, background: 'rgba(var(--fg), 0.1)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 3, background: 'var(--accent, #4f8cff)',
                width: downloadProgress?.total ? `${Math.min(100, (downloadProgress.downloaded / downloadProgress.total) * 100).toFixed(1)}%` : '30%',
                transition: downloadProgress?.total ? 'width 0.2s' : 'none',
              }} />
            </div>
            <span style={{ fontSize: '0.8em', color: 'var(--muted)' }}>
              {downloadProgress?.total
                ? `${(downloadProgress.downloaded / 1024 / 1024).toFixed(1)} / ${(downloadProgress.total / 1024 / 1024).toFixed(1)} MB (${Math.min(100, (downloadProgress.downloaded / downloadProgress.total) * 100).toFixed(1)}%)`
                : t('settings.downloading_update')}
            </span>
          </div>
        )}
        {downloadDone && <span className="configured"><CheckCircle2 size={17} />{t('settings.update_installed')}</span>}
        {!updateInfo && updateChecked && <span className="configured muted-status">{t('settings.latest')}</span>}
      </div>
      {updateInfo && !downloading && !downloadDone && (
        <div style={{ marginTop: 8 }}>
          <p className="muted">v{updateInfo.version} {updateInfo.date ? `(${updateInfo.date})` : ""}</p>
        </div>
      )}
    </SettingsSection>
  );

  const categoryContent: Record<string, React.ReactNode> = {
    account: accountContent,
    general: generalContent,
    display: displayContent,
    notify: notifyContent,
    about: aboutContent,
  };

  return (
    <section className="settings-panel" data-testid="settings-panel">
      <button className="floating-close settings-close" onClick={onBack} aria-label="返回主面板"><X size={20} /></button>
      <div className="settings-inner">
        <header className="settings-header" data-tauri-drag-region>
          <button className="provider-toggle" onClick={() => onProviderChange(provider === "deepseek" ? "mimo" : "deepseek")}>{provider === "deepseek" ? "DeepSeek Monitor" : "MiMo Monitor"}</button>
          <div><p>{t('settings.title')}</p></div>
        </header>

        <div style={{ padding: '8px 0' }}>
          {categories.map((cat) => (
            <React.Fragment key={cat.key}>
              <button
                onClick={() => setActiveCategory(activeCategory === cat.key ? null : cat.key)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '12px 16px', border: 'none',
                  background: activeCategory === cat.key ? 'rgba(var(--fg), 0.06)' : 'transparent',
                  color: 'var(--text)', cursor: 'pointer',
                  fontSize: '0.9em', borderRadius: 8, transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => { if (activeCategory !== cat.key) e.currentTarget.style.background = 'rgba(var(--fg), 0.04)'; }}
                onMouseLeave={(e) => { if (activeCategory !== cat.key) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {cat.icon}
                  <span>{cat.label}</span>
                </span>
                <ChevronRight size={14} style={{ opacity: 0.4, transform: activeCategory === cat.key ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }} />
              </button>
              <div style={{
                display: 'grid',
                gridTemplateRows: activeCategory === cat.key ? '1fr' : '0fr',
                transition: 'grid-template-rows 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                paddingLeft: 8, paddingRight: 8,
              }}>
                <div style={{ overflow: 'hidden', minHeight: 0 }}>
                  {categoryContent[cat.key]}
                </div>
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Shared ────────────────────────────────────────────────
function SettingsSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (<section className="settings-section"><h2>{icon}{title}</h2>{children}</section>);
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (<label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><i /></label>);
}
