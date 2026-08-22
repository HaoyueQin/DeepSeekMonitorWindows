import React from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import {
  BarChart3, CheckCircle2, Info, KeyRound, Power, Settings, X,
  User, Monitor, Bell, Palette, Globe, ChevronRight,
} from "lucide-react";
import type { Provider, AppConfig, BalanceData, UsageResult, MimoUsageResult } from "../types";
import { fmtMoney, addDays, previousMonth } from "../utils";
import { t, tpl, getLang, setLang, LANG_OPTIONS } from "../i18n";
import { marked } from "marked";
import DOMPurify from "dompurify";

// ─── SettingsPanel ─────────────────────────────────────────
export function SettingsPanel({ provider, onProviderChange, onBack, onUsageLoaded, onUsageCleared, onRefreshIntervalChanged, onAutoRefreshChanged, onCurrencyChanged, onEfficiencyUnitChanged, onReloadCache, historyMonths, onHistoryMonthsChanged }: {
  provider: Provider; onProviderChange: (p: Provider) => void; onBack: () => void;
  onUsageLoaded: (usage: UsageResult | MimoUsageResult) => void; onUsageCleared: () => void;
  onRefreshIntervalChanged: (seconds: number) => void; onAutoRefreshChanged: (enabled: boolean) => void;
  onCurrencyChanged: (currency: "cny" | "usd") => void;
  onEfficiencyUnitChanged: (unit: "token_per_currency" | "currency_per_token") => void;
  onReloadCache?: (p?: Provider) => void;
  historyMonths: number;
  onHistoryMonthsChanged: (months: number) => void;
}) {
  const [apiKey, setApiKey] = React.useState("");
  const [config, setConfig] = React.useState<AppConfig | null>(null);
  const [status, setStatus] = React.useState(t("settings.reading_config"));
  const [busy, setBusy] = React.useState(false);
  const [refresh, setRefresh] = React.useState(60);
  const [autoRefresh, setAutoRefresh] = React.useState(false);
  const [autostart, setAutostart] = React.useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = React.useState(false);
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
  const [updateError, setUpdateError] = React.useState("");
  const [downloading, setDownloading] = React.useState(false);
  const [downloadProgress, setDownloadProgress] = React.useState<{ downloaded: number; total: number | null }>({ downloaded: 0, total: null });
  const [downloadDone, setDownloadDone] = React.useState(false);
  const [changelogLoading, setChangelogLoading] = React.useState(false);
  const [changelogError, setChangelogError] = React.useState("");
  const [changelogReleases, setChangelogReleases] = React.useState<Array<{repo:string;tag:string;date:string;html:string}>>([]);
  const [openRelease, setOpenRelease] = React.useState<string | null>(null);
  const [activeCategory, setActiveCategory] = React.useState<string | null>(null);
  const [customDsRefresh, setCustomDsRefresh] = React.useState(false);
  const [customMimoRefresh, setCustomMimoRefresh] = React.useState(false);
  const [customCooldown, setCustomCooldown] = React.useState(false);
  const [theme, setTheme] = React.useState<"light" | "dark" | "system">("light");
  const [currency, setCurrency] = React.useState<"cny" | "usd">("cny");
  const [efficiencyUnit, setEfficiencyUnit] = React.useState<"token_per_currency" | "currency_per_token">("token_per_currency");
  const [autoClearOldCache, setAutoClearOldCache] = React.useState(true);
  const [reloading, setReloading] = React.useState(false);
  const [cacheMsg, setCacheMsg] = React.useState("");
  const configPath = config?.configPath ?? "%APPDATA%\\DeepSeekMonitorWindows\\config.json";

  const PRESET_REFRESH = [60, 300, 1800, 3600];
  const PRESET_COOLDOWN = [10, 30, 60, 180, 360];

  React.useEffect(() => {
    void invoke<AppConfig>("get_app_config").then((c) => {
      setConfig(c);
      const ri = c.refreshIntervalSeconds || 60;
      setRefresh(ri);
      setCustomDsRefresh(!PRESET_REFRESH.includes(ri));
      setCustomMimoRefresh(!PRESET_REFRESH.includes(c.mimoRefreshIntervalSeconds || 0) && (c.mimoRefreshIntervalSeconds || 0) > 0);
      setCustomCooldown(!PRESET_COOLDOWN.includes(c.notifyCooldownMinutes || 30));
      setAutoRefresh(c.autoRefreshEnabled);
      setAutostart(c.autostart);
      setAlwaysOnTop(c.alwaysOnTop || false);
      setLowBalanceNotify(c.lowBalanceNotify || false);
      setLowBalanceThreshold(String(c.lowBalanceThreshold || 5.00));
      setStatus(c.apiKeyConfigured ? `${t("settings.configured_prefix")} ${c.apiKeyPreview}` : t("settings.api_key_unconfigured"));
      setUsageStatus(c.usageTokenConfigured ? t("settings.token_configured") : t("settings.token_unconfigured"));
      setTheme(c.theme || "light");
      setCurrency(c.currency || "cny");
      setEfficiencyUnit(c.efficiencyUnit || "token_per_currency");
      setAutoClearOldCache(c.autoClearOldCache ?? true);
    }).catch(() => setStatus(t("settings.browser_preview")));
  }, []);
  React.useEffect(() => { void getVersion().then(setAppVersion).catch(() => setAppVersion("1.1.0")); }, []);

  const fetchCurrentUsage = React.useCallback(async () => {
    const now = new Date();
    const current: UsageResult = await invoke("fetch_usage", { month: now.getMonth() + 1, year: now.getFullYear() });
    const needsPrev = addDays(now, -6).getMonth() !== now.getMonth();
    if (!needsPrev) return current;
    try {
      const prev = previousMonth(now);
      const prevUsage: UsageResult = await invoke("fetch_usage", { month: prev.month, year: prev.year });
      return { ...current, days: [...prevUsage.days, ...current.days] };
    } catch { return current; }
  }, []);

  const refreshUsageAfterToken = React.useCallback((prefix: string) => {
    setUsageStatus(`${prefix}${t("usage.refreshing")}`);
    return fetchCurrentUsage().then((u) => { onUsageLoaded(u); setUsageStatus(`${prefix}${tpl("usage.month_cost", { cost: fmtMoney(u.monthCost) })}`); return u; }).catch((e) => { setUsageStatus(`${prefix}${tpl("usage.refresh_fail", { err: typeof e === "string" ? e : t("usage.refresh_err") })}`); throw e; });
  }, [onUsageLoaded, fetchCurrentUsage]);

  React.useEffect(() => { const p = listen<AppConfig>("usage-token-captured", (e) => { setConfig(e.payload); setUsageSyncing(false); void refreshUsageAfterToken(t("usage.synced")); }); return () => { void p.then((u) => u()); }; }, [refreshUsageAfterToken]);
  React.useEffect(() => { const p = listen("usage-sync-ended", () => { setUsageSyncing(false); setUsageStatus(t("usage.sync_ended")); }); return () => { void p.then((u) => u()); }; }, []);
  React.useEffect(() => { const p = listen("mimo-sync-started", () => { setMimoStatus(t("mimo.login_hint")); }); return () => { void p.then((u) => u()); }; }, []);

  const saveApiKey = React.useCallback(() => { setBusy(true); void invoke<AppConfig>("save_api_key", { apiKey }).then((c) => { setConfig(c); setApiKey(""); setStatus(t("settings.saving_key")); return invoke<BalanceData>("fetch_balance"); }).then((b) => { setStatus(`${t("settings.verify_ok")} ${b.currency === "USD" ? "$" : "¥"}${b.totalBalance}${b.isAvailable ? "" : t("settings.balance_low_suffix")}`); }).catch((e) => { setStatus(typeof e === "string" ? e : t("settings.save_verify_fail")); }).finally(() => setBusy(false)); }, [apiKey]);
  const clearApiKey = React.useCallback(() => { setBusy(true); void invoke<AppConfig>("clear_api_key").then((c) => { setConfig(c); setApiKey(""); setStatus(t("settings.cleared_key")); }).catch((e) => { setStatus(typeof e === "string" ? e : t("settings.clear_fail")); }).finally(() => setBusy(false)); }, []);
  const startUsageSync = React.useCallback(() => { setUsageSyncing(true); setUsageStatus(t("usage.opening_login")); void invoke<boolean>("start_usage_sync").then((s) => { if (!s) setUsageStatus(t("usage.reopen_hint")); }).catch((e) => { setUsageStatus(typeof e === "string" ? e : t("usage.open_fail")); }).finally(() => { window.setTimeout(() => setUsageSyncing(false), 2500); }); }, []);
  const saveUsageToken = React.useCallback(() => { setBusy(true); void invoke<AppConfig>("save_usage_token", { usageToken }).then((c) => { setConfig(c); setUsageToken(""); setUsageStatus(t("usage.saving_token")); return refreshUsageAfterToken(t("usage.manual_saved")); }).catch((e) => { setUsageStatus(typeof e === "string" ? e : t("usage.save_fail")); }).finally(() => setBusy(false)); }, [refreshUsageAfterToken, usageToken]);
  const clearUsageToken = React.useCallback(() => { setBusy(true); void invoke<AppConfig>("clear_usage_token").then((c) => { setConfig(c); setUsageToken(""); setUsageStatus(t("usage.cleared_token")); onUsageCleared(); }).catch((e) => { setUsageStatus(typeof e === "string" ? e : t("settings.clear_fail")); }).finally(() => setBusy(false)); }, [onUsageCleared]);
  const startMimoSync = React.useCallback(() => { setMimoSyncing(true); setMimoStatus(t("mimo.opening_page")); void invoke<boolean>("start_mimo_sync").then((a) => { setMimoStatus(a ? t("mimo.opened_confirm") : t("mimo.login_hint")); setMimoSyncing(false); }).catch((e) => { setMimoStatus(typeof e === "string" ? e : t("mimo.sync_fail")); setMimoSyncing(false); }); }, []);
  const saveRefreshInterval = React.useCallback((s: number) => { const p = refresh; setRefresh(s); onRefreshIntervalChanged(s); void invoke<AppConfig>("save_refresh_interval", { refreshIntervalSeconds: s }).then((c) => { setConfig(c); setRefresh(c.refreshIntervalSeconds || 60); onRefreshIntervalChanged(c.refreshIntervalSeconds || 60); }).catch(() => { setRefresh(p); onRefreshIntervalChanged(p); }); }, [onRefreshIntervalChanged, refresh]);
  const saveAutoRefreshEnabled = React.useCallback((e: boolean) => { const p = autoRefresh; setAutoRefresh(e); onAutoRefreshChanged(e); void invoke<AppConfig>("save_auto_refresh_enabled", { autoRefreshEnabled: e }).then((c) => { setConfig(c); setAutoRefresh(c.autoRefreshEnabled); onAutoRefreshChanged(c.autoRefreshEnabled); }).catch(() => { setAutoRefresh(p); onAutoRefreshChanged(p); }); }, [autoRefresh, onAutoRefreshChanged]);
  const saveAutostart = React.useCallback((e: boolean) => { const p = autostart; setAutostart(e); void invoke<AppConfig>("save_autostart", { autostart: e }).then((c) => { setConfig(c); setAutostart(c.autostart); }).catch(() => setAutostart(p)); }, [autostart]);
  const saveAlwaysOnTop = React.useCallback((e: boolean) => { const p = alwaysOnTop; setAlwaysOnTop(e); void invoke<AppConfig>("save_always_on_top", { alwaysOnTop: e }).then((c) => { setConfig(c); setAlwaysOnTop(c.alwaysOnTop); }).catch(() => setAlwaysOnTop(p)); }, [alwaysOnTop]);

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
    localStorage.setItem("ui-theme", apply); // sync with DashboardPanel
    void invoke<AppConfig>("save_theme", { theme: val }).then((c) => { setConfig(c); }).catch(() => setTheme(prev));
  }, [theme]);

  const saveCurrency = React.useCallback((val: "cny" | "usd") => {
    const prev = currency; setCurrency(val);
    onCurrencyChanged(val);
    void invoke<AppConfig>("save_currency", { currency: val }).then((c) => { setConfig(c); }).catch(() => { setCurrency(prev); onCurrencyChanged(prev); });
  }, [currency, onCurrencyChanged]);

  const saveEfficiencyUnit = React.useCallback((val: "token_per_currency" | "currency_per_token") => {
    const prev = efficiencyUnit; setEfficiencyUnit(val);
    onEfficiencyUnitChanged(val);
    void invoke<AppConfig>("save_efficiency_unit", { unit: val }).then((c) => { setConfig(c); }).catch(() => { setEfficiencyUnit(prev); onEfficiencyUnitChanged(prev); });
  }, [efficiencyUnit, onEfficiencyUnitChanged]);

  // Apply theme on mount and when theme changes
  React.useEffect(() => {
    const apply = theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
    document.documentElement.setAttribute("data-theme", apply);
    localStorage.setItem("ui-theme", apply); // sync with DashboardPanel
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
    setUpdateError("");
    setUpdateInfo(null);
    setDownloadDone(false);
    setDownloadProgress({ downloaded: 0, total: null });
    void invoke<{ version: string; date: string; body: string } | null>("check_update")
      .then((info) => {
        setUpdateInfo(info);
        if (!info) setUpdateError("");
      })
      .catch((err) => {
        setUpdateInfo(null);
        const msg = typeof err === "string" ? err : String(err);
        setUpdateError(msg);
        console.warn("检查更新失败:", err);
      })
      .finally(() => setCheckingUpdate(false));
  }, []);

  const handleInstallUpdate = React.useCallback(async () => {
    setDownloading(true);
    setDownloadProgress({ downloaded: 0, total: null });
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
      setDownloadProgress({ downloaded: 0, total: null });
    }
  }, []);

  const handleViewChangelog = React.useCallback(async () => {
    if (changelogReleases.length > 0) { setChangelogReleases([]); setOpenRelease(null); return; }
    setChangelogLoading(true);
    setChangelogError("");
    setOpenRelease(null);
    try {
      const repos = [
        { owner: "HaoyueQin", label: "" },
        { owner: "Joyi-code", label: " (原作者)" },
      ];
      const locale = getLang() === "zh" ? "zh-CN" : "en-US";
      const releases: Array<{repo:string;tag:string;date:string;html:string}> = [];
      for (const repo of repos) {
        try {
          let allReleases: Array<{ tag_name: string; published_at: string; body: string }> = [];
          let page = 1;
          while (true) {
            const res = await fetch(`https://api.github.com/repos/${repo.owner}/DeepSeekMonitorWindows/releases?per_page=100&page=${page}`);
            if (!res.ok) break;
            const pageReleases = await res.json();
            if (!Array.isArray(pageReleases) || pageReleases.length === 0) break;
            allReleases = allReleases.concat(pageReleases);
            if (pageReleases.length < 100) break;
            page++;
          }
          for (const r of allReleases) {
            const date = new Date(r.published_at).toLocaleDateString(locale);
            // marked 默认不过滤 HTML：release body 属于外部内容，必须经 DOMPurify 消毒后再注入
            const rawHtml = await marked.parse(r.body || "");
            const html = DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
            releases.push({ repo: `${repo.owner}${repo.label}`, tag: r.tag_name, date, html });
          }
        } catch (e) {
          releases.push({ repo: `${repo.owner}${repo.label}`, tag: t("settings.release_error"), date: "", html: `<em>${t("settings.changelog_fetch_failed")}</em>` });
        }
      }
      setChangelogReleases(releases);
    } catch (e) {
      setChangelogError(`${t("settings.changelog_fail")}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setChangelogLoading(false);
    }
  }, [changelogReleases.length]);

  const [lang, setLangState] = React.useState(getLang());

  const [langOpen, setLangOpen] = React.useState(false);
  const langRef = React.useRef<HTMLDivElement>(null);
  const langBtnRef = React.useRef<HTMLButtonElement>(null);
  const langDropdownRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if ((langRef.current && langRef.current.contains(target)) ||
          (langDropdownRef.current && langDropdownRef.current.contains(target))) return;
      setLangOpen(false);
    };
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
    { key: "data", icon: <Settings size={15} />, label: t('settings.cat_data') },
    { key: "about", icon: <Info size={15} />, label: t('settings.cat_about') },
  ];

  // Account category content - always show both platforms
  const accountContent = (
    <>
      {/* DeepSeek Account */}
      <div style={{ marginBottom: 16, borderLeft: '3px solid #4f8cff', paddingLeft: 12 }}>
        <div style={{ fontSize: '1em', fontWeight: 600, marginBottom: 12, color: '#4f8cff' }}>DeepSeek</div>
        <SettingsSection icon={<KeyRound size={15} />} title={t('settings.api_key')}>
          <p>{t('settings.api_key_desc')}</p>
          <p className="muted">{t('settings.api_key_local')}</p>
          <div className="key-row"><input aria-label={t('settings.api_key')} type="password" maxLength={256} value={apiKey} placeholder={config?.apiKeyConfigured ? "••••••••••••••••••••••••••••••••••••••••••••••••••" : "sk-..."} onChange={(e) => setApiKey(e.target.value)} /></div>
          <div className="settings-actions">
            <button className="primary" onClick={saveApiKey} disabled={busy || !apiKey.trim()}>{t('settings.save')}</button>
            <span className={config?.apiKeyConfigured ? "configured" : "configured muted-status"}><CheckCircle2 size={17} />{config?.apiKeyConfigured ? t('settings.verified') : t('settings.not_configured')}</span>
            <button className="secondary" onClick={clearApiKey} disabled={busy || !config?.apiKeyConfigured}>{t('settings.clear')}</button>
          </div>
          {status && <p className="muted">{status}</p>}
        </SettingsSection>
        <SettingsSection icon={<BarChart3 size={15} />} title={t('usage.title')}>
          <p>{t('usage.desc')}</p>
          <div className="settings-actions usage-sync-actions">
            <button className="primary" onClick={startUsageSync} disabled={usageSyncing}>{usageSyncing ? t('usage.waiting') : t('usage.auto_sync')}</button>
            <span className={config?.usageTokenConfigured ? "configured" : "configured muted-status"}><CheckCircle2 size={17} />{config?.usageTokenConfigured ? t('settings.verified') : t('settings.not_configured')}</span>
            <button className="secondary" onClick={clearUsageToken} disabled={busy || !config?.usageTokenConfigured}>{t('usage.clear_token')}</button>
          </div>
          <p className="muted">{usageStatus}</p>
          <button className="link-button" onClick={() => setShowManualPaste((v) => !v)}>{showManualPaste ? t('usage.manual_collapse') : t('usage.manual')}</button>
          {showManualPaste && (<>
            <p className="muted">{t('usage.get_token_hint')}</p>
            <div className="key-row"><input aria-label={t('usage.title')} type="password" maxLength={4096} value={usageToken} placeholder={config?.usageTokenConfigured ? "••••••••••••••••••••••••••••••••••••••••••••••••••" : ""} onChange={(e) => setUsageToken(e.target.value)} /></div>
            <div className="settings-actions"><button className="primary" onClick={saveUsageToken} disabled={busy || !usageToken.trim()}>{t('usage.save_token')}</button></div>
          </>)}
        </SettingsSection>
      </div>

      {/* MiMo Account */}
      <div style={{ marginBottom: 16, borderLeft: '3px solid #FF6900', paddingLeft: 12 }}>
        <div style={{ fontSize: '1em', fontWeight: 600, marginBottom: 12, color: '#FF6900' }}>MiMo</div>
        <SettingsSection icon={<BarChart3 size={15} />} title={t('mimo.login')}>
          <p>{t('mimo.login_desc')}</p>
          <div className="settings-actions"><button className="primary" onClick={startMimoSync} disabled={mimoSyncing}>{mimoSyncing ? t('mimo.opening') : t('mimo.login_btn')}</button></div>
          {mimoStatus && <p className="muted">{mimoStatus}</p>}
        </SettingsSection>
      </div>

    </>
  );
  const generalContent = (
    <>
      <SettingsSection icon={<Power size={15} />} title={t('settings.general')}>
        <Toggle label={t('settings.autostart')} checked={autostart} onChange={saveAutostart} />
        <p>{t('settings.autostart_desc')}</p>
        <Toggle label={t('settings.always_on_top')} checked={alwaysOnTop} onChange={saveAlwaysOnTop} />
        <p>{t('settings.always_on_top_desc')}</p>
        <Toggle label={t('settings.auto_refresh')} checked={autoRefresh} onChange={saveAutoRefreshEnabled} />
        <p>{t('settings.auto_refresh_desc')}</p>
        {autoRefresh && (
          <div style={{ marginTop: 8 }}>
            <div style={{ marginBottom: 12 }}>
              <span style={{ fontSize: '0.85em', fontWeight: 500 }}>{t('settings.ds_refresh_interval')}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <select style={{ fontSize: '0.85em', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(var(--fg), 0.15)', background: 'rgba(var(--fg), 0.03)', color: 'var(--text)' }}
                  value={customDsRefresh ? -1 : refresh}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    if (v === -1) { setCustomDsRefresh(true); return; }
                    setCustomDsRefresh(false);
                    saveRefreshInterval(v);
                  }}>
                  <option value={60}>{t('settings.refresh_1m')}</option>
                  <option value={300}>{t('settings.refresh_5m')}</option>
                  <option value={1800}>{t('settings.refresh_30m')}</option>
                  <option value={3600}>{t('settings.refresh_1h')}</option>
                  <option value={-1}>{t('settings.custom')}</option>
                </select>
                {customDsRefresh && (
                  <>
                    <input type="number" min="1" max="1440" style={{ width: 80, fontSize: '0.85em', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(var(--fg), 0.15)', background: 'rgba(var(--fg), 0.03)', color: 'var(--text)' }}
                      placeholder={t('settings.custom')}
                      onKeyDown={(e) => { if (e.key === 'Enter') { const val = parseInt((e.target as HTMLInputElement).value); if (val > 0) saveRefreshInterval(val * 60); } }} />
                    <span style={{ fontSize: '0.8em', opacity: 0.6 }}>{t('settings.minutes')}</span>
                  </>
                )}
              </div>
            </div>
            <div>
              <span style={{ fontSize: '0.85em', fontWeight: 500 }}>{t('settings.mimo_refresh_interval')}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <select style={{ fontSize: '0.85em', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(var(--fg), 0.15)', background: 'rgba(var(--fg), 0.03)', color: 'var(--text)' }}
                  value={customMimoRefresh ? -1 : (config?.mimoRefreshIntervalSeconds || 60)}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    if (v === -1) { setCustomMimoRefresh(true); return; }
                    setCustomMimoRefresh(false);
                    void invoke<AppConfig>("save_mimo_refresh_interval", { seconds: v }).then(setConfig).catch(() => {});
                  }}>
                  <option value={60}>{t('settings.refresh_1m')}</option>
                  <option value={300}>{t('settings.refresh_5m')}</option>
                  <option value={1800}>{t('settings.refresh_30m')}</option>
                  <option value={3600}>{t('settings.refresh_1h')}</option>
                  <option value={-1}>{t('settings.custom')}</option>
                </select>
                {customMimoRefresh && (
                  <>
                    <input type="number" min="1" max="1440" style={{ width: 80, fontSize: '0.85em', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(var(--fg), 0.15)', background: 'rgba(var(--fg), 0.03)', color: 'var(--text)' }}
                      placeholder={t('settings.custom')}
                      onKeyDown={(e) => { if (e.key === 'Enter') { const val = parseInt((e.target as HTMLInputElement).value); if (val > 0) void invoke<AppConfig>("save_mimo_refresh_interval", { seconds: val * 60 }).then(setConfig).catch(() => {}); } }} />
                    <span style={{ fontSize: '0.8em', opacity: 0.6 }}>{t('settings.minutes')}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
        <p style={{ marginTop: 12 }}>{t('settings.default_provider')}</p>
        <select style={{ fontSize: '0.85em', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(var(--fg), 0.15)', background: 'rgba(var(--fg), 0.03)', color: 'var(--text-strong)' }}
          value={config?.defaultProvider || "deepseek"}
          onChange={(e) => { void invoke<AppConfig>("save_default_provider", { provider: e.target.value }).then(setConfig).catch(() => {}); }}>
          <option value="deepseek">DeepSeek</option>
          <option value="mimo">MiMo</option>
        </select>
      </SettingsSection>
      <SettingsSection icon={<Globe size={15} />} title={t('settings.language')}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <p style={{ margin: 0 }}>{t('settings.language_desc')}</p>
          <div className="lang-select" ref={langRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              ref={langBtnRef}
              className="lang-select-btn"
              onClick={() => setLangOpen(!langOpen)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', border: '1px solid rgba(var(--fg), 0.2)', borderRadius: 6, background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: '0.85em' }}
            >
              <span>{currentLangLabel}</span>
              <span style={{ fontSize: '0.7em', opacity: 0.6 }}>▼</span>
            </button>
            {langOpen && createPortal(
              <div ref={langDropdownRef} className="lang-dropdown" style={{
                position: 'fixed',
                top: (langBtnRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                right: window.innerWidth - (langBtnRef.current?.getBoundingClientRect().right ?? 0),
                background: 'var(--glass-tooltip-tint)',
                border: '1px solid rgba(var(--fg), 0.15)',
                borderRadius: 8,
                overflow: 'hidden',
                zIndex: 9999,
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                minWidth: 160,
              }}>
                {LANG_OPTIONS.map((opt) => (
                  <button key={opt.code} onClick={() => { setLang(opt.code); setLangState(opt.code); setLangOpen(false); }}
                    style={{ display: 'block', width: '100%', padding: '8px 12px', border: 'none', background: lang === opt.code ? 'rgba(var(--fg), 0.1)' : 'transparent', color: 'var(--text)', cursor: 'pointer', textAlign: 'left', fontSize: '0.85em' }}>
                    {opt.label}
                  </button>
                ))}
              </div>,
              document.body
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
        <p>{t('settings.choose_currency')}</p>
        <div style={{ display: 'inline-flex', gap: 6, marginTop: 6 }}>
          {(["cny", "usd"] as const).map((opt) => (
            <button key={opt} style={{ border: 0, borderRadius: 8, padding: '8px 14px', background: currency === opt ? 'var(--brand)' : 'rgba(var(--fg), 0.12)', color: currency === opt ? '#fff' : 'var(--text-strong)', fontSize: '0.85em', fontWeight: 600, cursor: 'pointer' }} onClick={() => saveCurrency(opt)}>
              {opt === "cny" ? t('settings.currency_cny') : t('settings.currency_usd')}
            </button>
          ))}
        </div>
        <p style={{ marginTop: 12 }}>{t('settings.efficiency_way')}</p>
        <div style={{ display: 'inline-flex', gap: 6, marginTop: 6 }}>
          {(["token_per_currency", "currency_per_token"] as const).map((opt) => (
            <button key={opt} style={{ border: 0, borderRadius: 8, padding: '8px 14px', background: efficiencyUnit === opt ? 'var(--brand)' : 'rgba(var(--fg), 0.12)', color: efficiencyUnit === opt ? '#fff' : 'var(--text-strong)', fontSize: '0.85em', fontWeight: 600, cursor: 'pointer' }} onClick={() => saveEfficiencyUnit(opt)}>
              {opt === "token_per_currency" ? t('settings.token_per_currency') : t('settings.currency_per_token')}
            </button>
          ))}
        </div>
      </SettingsSection>
      <SettingsSection icon={<Palette size={15} />} title={t('settings.theme')}>
        <p>{t('settings.choose_theme')}</p>
        <div style={{ display: 'inline-flex', gap: 6, marginTop: 6 }}>
          {(["light", "dark", "system"] as const).map((opt) => (
            <button key={opt} style={{ border: 0, borderRadius: 8, padding: '8px 14px', background: theme === opt ? 'var(--brand)' : 'rgba(var(--fg), 0.12)', color: theme === opt ? '#fff' : 'var(--text-strong)', fontSize: '0.85em', fontWeight: 600, cursor: 'pointer' }} onClick={() => saveTheme(opt)}>
              {opt === "light" ? t('settings.theme_light') : opt === "dark" ? t('settings.theme_dark') : t('settings.theme_system')}
            </button>
          ))}
        </div>
      </SettingsSection>
      <SettingsSection icon={<Settings size={15} />} title={t('settings.window_size')}>
        <p>{t('settings.window_desc')}</p>
        <div style={{ display: 'inline-flex', gap: 6, marginTop: 6 }}>
          {[{ label: t('settings.compact'), w: 380, h: 690 }, { label: t('settings.standard'), w: 463, h: 750 }, { label: t('settings.wide'), w: 600, h: 790 }, { label: t('settings.large'), w: 660, h: 990 }].map((preset) => (
            <button key={preset.label} style={{ border: 0, borderRadius: 8, padding: '8px 14px', background: 'rgba(var(--fg), 0.12)', color: 'var(--text-strong)', fontSize: '0.85em', fontWeight: 600, cursor: 'pointer' }} onClick={() => { void invoke("resize_window", { width: preset.w, height: preset.h }).catch(() => {}); }}>{preset.label}</button>
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
        <>
          <div className="key-row" style={{ marginTop: 8 }}>
            <span style={{ fontSize: '0.8em', color: 'var(--text-faint)', marginRight: 8 }}>{t('notify.threshold')}：</span>
            <input type="number" min="0" step="0.01" value={lowBalanceThreshold} onChange={(e) => saveLowBalanceThreshold(e.target.value)} style={{ width: 100 }} />
            <span style={{ fontSize: '0.8em', color: 'var(--text-faint)', marginLeft: 4 }}>{currency === "usd" ? "$" : "¥"}</span>
          </div>
          <p style={{ marginTop: 12 }}>{t('settings.notify_cooldown')}</p>
          <p className="muted">{t('settings.notify_cooldown_desc')}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <select style={{ fontSize: '0.85em', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(var(--fg), 0.15)', background: 'rgba(var(--fg), 0.03)', color: 'var(--text)' }}
              value={customCooldown ? -1 : (config?.notifyCooldownMinutes || 30)}
              onChange={(e) => {
                const v = parseInt(e.target.value);
                if (v === -1) { setCustomCooldown(true); return; }
                setCustomCooldown(false);
                void invoke<AppConfig>("save_notify_cooldown", { minutes: v }).then(setConfig).catch(() => {});
              }}>
              <option value={10}>{t('settings.cooldown_10m')}</option>
              <option value={30}>{t('settings.cooldown_30m')}</option>
              <option value={60}>{t('settings.cooldown_1h')}</option>
              <option value={180}>{t('settings.cooldown_3h')}</option>
              <option value={360}>{t('settings.cooldown_6h')}</option>
              <option value={-1}>{t('settings.custom')}</option>
            </select>
            {customCooldown && (
              <>
                <input type="number" min="1" style={{ width: 80, fontSize: '0.85em', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(var(--fg), 0.15)', background: 'rgba(var(--fg), 0.03)', color: 'var(--text)' }}
                  placeholder={t('settings.custom')}
                  onKeyDown={(e) => { if (e.key === 'Enter') { const val = parseInt((e.target as HTMLInputElement).value); if (val > 0) void invoke<AppConfig>("save_notify_cooldown", { minutes: val }).then(setConfig).catch(() => {}); } }} />
                <span style={{ fontSize: '0.8em', opacity: 0.6 }}>{t('settings.minutes')}</span>
              </>
            )}
          </div>
        </>
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
                width: downloadProgress?.total ? `${Math.min(100, (downloadProgress.downloaded / downloadProgress.total) * 100).toFixed(1)}%` : '0%',
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
        {!updateInfo && !updateError && !checkingUpdate && <span className="configured muted-status">{t('settings.latest')}</span>}
        {updateError && <span className="configured" style={{ color: 'var(--orange)' }}>⚠ {updateError}</span>}
      </div>
      <button className="secondary" onClick={() => { void handleViewChangelog(); }} disabled={changelogLoading} style={{ marginTop: 8 }}>
        {changelogLoading ? t("settings.loading") : changelogReleases.length > 0 ? t("settings.hide_changelog") : t("settings.view_changelog")}
      </button>
      {changelogError && <p className="muted" style={{ color: 'var(--orange)', marginTop: 4 }}>{changelogError}</p>}
      {changelogReleases.length > 0 && (
        <div className="changelog-body" style={{ marginTop: 8, maxHeight: 360, overflowY: 'auto', fontSize: '0.8em', lineHeight: 1.6, color: 'var(--text-muted)' }}>
          {(() => {
            let lastRepo = "";
            return changelogReleases.map((r, i) => {
              const showRepo = r.repo !== lastRepo;
              lastRepo = r.repo;
              const isOpen = openRelease === `${i}`;
              return (
                <React.Fragment key={i}>
                  {showRepo && <h3 style={{ margin: '10px 0 6px', fontSize: '1.05em', color: 'var(--text-strong)' }}>{r.repo}</h3>}
                  <div style={{ marginBottom: 2, borderRadius: 8, overflow: 'hidden' }}>
                    <button
                      onClick={() => setOpenRelease(isOpen ? null : `${i}`)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '8px 12px',
                        border: 'none', background: isOpen ? 'rgba(var(--fg), 0.06)' : 'rgba(var(--fg), 0.03)',
                        color: 'var(--text-strong)', cursor: 'pointer', fontSize: '0.9em', fontWeight: 600,
                        borderRadius: isOpen ? '8px 8px 0 0' : 8, textAlign: 'left',
                      }}
                    >
                      <span style={{ display: 'inline-block', transition: 'transform 0.25s ease', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', opacity: 0.5, fontSize: '1.1em' }}>›</span>
                      {r.tag}
                      <span style={{ opacity: 0.5, fontWeight: 400, fontSize: '0.85em' }}>{r.date}</span>
                    </button>
                    <div style={{
                      display: 'grid',
                      gridTemplateRows: isOpen ? '1fr' : '0fr',
                      transition: 'grid-template-rows 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    }}>
                      <div style={{ overflow: 'hidden', minHeight: 0 }}>
                        <div className="changelog-detail" dangerouslySetInnerHTML={{ __html: r.html }} style={{ padding: '8px 12px 10px 28px', background: 'rgba(var(--fg), 0.015)', borderRadius: '0 0 8px 8px' }} />
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            });
          })()}
        </div>
      )}
      {updateInfo && !downloading && !downloadDone && (
        <div style={{ marginTop: 8 }}>
          <p className="muted">v{updateInfo.version} {updateInfo.date ? `(${updateInfo.date})` : ""}</p>
        </div>
      )}
      <div style={{ marginTop: 12, fontSize: '0.75em', color: 'var(--text-faint)', wordBreak: 'break-all' }}>
        <span>{t('settings.config_path')}</span><span>{configPath}</span>
      </div>
    </SettingsSection>
  );

  // Data management category content
  const [exportFormat, setExportFormat] = React.useState<"json" | "csv">("json");
  const [exportPlatform, setExportPlatform] = React.useState<"all" | "deepseek" | "mimo">("all");
  const [exportFrom, setExportFrom] = React.useState<string>("");
  const [exportTo, setExportTo] = React.useState<string>("");

  // 生成最近 36 个月的选项（YYYY-MM）
  const monthOptions = React.useMemo(() => {
    const out: string[] = [];
    const now = new Date();
    for (let i = 0; i < 36; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return out;
  }, []);

  const inExportRange = (key: string): boolean => {
    if (!exportFrom && !exportTo) return true;
    const m = key.match(/dsm-usage-(?:deepseek|mimo)-(\d{4}-\d{2})/);
    if (!m) return true; // 非用量缓存（余额等）总是导出
    const ym = m[1];
    if (exportFrom && ym < exportFrom) return false;
    if (exportTo && ym > exportTo) return false;
    return true;
  };

  const handleExport = () => {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('dsm-')) continue;
      if (exportPlatform === "deepseek" && key.includes('mimo')) continue;
      if (exportPlatform === "mimo" && !key.includes('mimo') && !key.includes('platform')) continue;
      if (!inExportRange(key)) continue;
      keys.push(key);
    }

    if (exportFormat === "json") {
      const data: Record<string, unknown> = {};
      for (const key of keys) {
        try { data[key] = JSON.parse(localStorage.getItem(key) || ''); } catch { data[key] = localStorage.getItem(key); }
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `dsm-data-${exportPlatform}.json`; a.click(); URL.revokeObjectURL(url);
    } else {
      // CSV：使用数据展开为按日期的行，其余键值平铺
      const rows: string[][] = [["key", "date", "totalTokens", "totalCost", "hitTokens", "missTokens", "responseTokens"]];
      for (const key of keys) {
        const val = localStorage.getItem(key) || '';
        const usageMatch = key.match(/^dsm-usage-(deepseek|mimo)-\d{4}-\d{2}$/);
        try {
          const parsed = JSON.parse(val);
          if (usageMatch && typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { days?: unknown[] }).days)) {
            const usage = parsed as { days: Array<{ date: string; totalTokens?: number; totalCost?: number; flashCacheHit?: number; flashCacheMiss?: number; flashResponse?: number; proCacheHit?: number; proCacheMiss?: number; proResponse?: number; models?: Array<{ cacheHitTokens?: number; cacheMissTokens?: number; responseTokens?: number }> }> };
            for (const day of usage.days) {
              const hit = (day.flashCacheHit ?? 0) + (day.proCacheHit ?? 0) + (day.models?.reduce((s, m) => s + (m.cacheHitTokens ?? 0), 0) ?? 0);
              const miss = (day.flashCacheMiss ?? 0) + (day.proCacheMiss ?? 0) + (day.models?.reduce((s, m) => s + (m.cacheMissTokens ?? 0), 0) ?? 0);
              const response = (day.flashResponse ?? 0) + (day.proResponse ?? 0) + (day.models?.reduce((s, m) => s + (m.responseTokens ?? 0), 0) ?? 0);
              rows.push([key, day.date, String(day.totalTokens ?? 0), String(day.totalCost ?? 0), String(hit), String(miss), String(response)]);
            }
          } else if (typeof parsed === 'object' && parsed !== null) {
            for (const [k, v] of Object.entries(parsed)) {
              rows.push([`${key}.${k}`, '', typeof v === 'object' ? JSON.stringify(v) : String(v)]);
            }
          } else {
            rows.push([key, '', String(parsed)]);
          }
        } catch { rows.push([key, '', val]); }
      }
      const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob(['\uFEFF' + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `dsm-data-${exportPlatform}.csv`; a.click(); URL.revokeObjectURL(url);
    }
  };

  const dataContent = (
    <>
      <SettingsSection icon={<Settings size={15} />} title={t('settings.cache_title')}>
        <Toggle label={t('settings.auto_clear_cache')} checked={autoClearOldCache} onChange={(e) => { setAutoClearOldCache(e); void invoke<AppConfig>("save_auto_clear_old_cache", { enabled: e }).then(setConfig).catch(() => {}); }} />
        <p>{t('settings.auto_clear_cache_desc')}</p>
        <div className="settings-actions">
          <button className="primary" disabled={reloading} onClick={async () => { setReloading(true); setCacheMsg(""); try { await (onReloadCache ? onReloadCache() : Promise.resolve()); setCacheMsg(t("settings.reload_ok")); } catch { setCacheMsg(t("settings.reload_fail")); } finally { setReloading(false); } }}>{reloading ? t("settings.loading") : t('settings.reload_cache')}</button>
        </div>
        <p>{t('settings.reload_cache_desc')}</p>
        {cacheMsg && <p style={{ color: cacheMsg.startsWith("✓") ? 'var(--green)' : 'var(--orange)', marginTop: 4 }}>{cacheMsg}</p>}
      </SettingsSection>
      <SettingsSection icon={<Settings size={15} />} title={t('settings.history_depth')}>
        <p>{t('settings.history_depth_desc')}</p>
        <select style={{ fontSize: '0.85em', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(var(--fg), 0.15)', background: 'rgba(var(--fg), 0.03)', color: 'var(--text-strong)' }}
          value={historyMonths}
          onChange={(e) => {
            const v = Number(e.target.value);
            onHistoryMonthsChanged(v);
            void invoke<AppConfig>("save_history_months", { months: v }).then(setConfig).catch(() => {});
          }}>
          <option value={12}>{t('settings.history_12')}</option>
          <option value={24}>{t('settings.history_24')}</option>
          <option value={36}>{t('settings.history_36')}</option>
        </select>
      </SettingsSection>
      <SettingsSection icon={<Settings size={15} />} title={t('settings.clear_cache')}>
        <p>{t('settings.clear_cache_desc')}</p>
        <div className="settings-actions">
          <button className="secondary" onClick={() => { localStorage.clear(); setCacheMsg(t("settings.reload_ok")); }}>{t('settings.clear_cache')}</button>
        </div>
      </SettingsSection>
      <SettingsSection icon={<Settings size={15} />} title={t('settings.export_title')}>
        <p>{t('settings.export_desc')}</p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: '0.85em', opacity: 0.7 }}>{t('settings.format')}</span>
          <div style={{ display: 'inline-flex', gap: 6 }}>
            {(["json", "csv"] as const).map((opt) => (
              <button key={opt} style={{ border: 0, borderRadius: 8, padding: '6px 12px', background: exportFormat === opt ? 'var(--brand)' : 'rgba(var(--fg), 0.12)', color: exportFormat === opt ? '#fff' : 'var(--text-strong)', fontSize: '0.8em', fontWeight: 600, cursor: 'pointer', textTransform: 'uppercase' }} onClick={() => setExportFormat(opt)}>{opt}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: '0.85em', opacity: 0.7 }}>{t('settings.platform')}</span>
          <div style={{ display: 'inline-flex', gap: 6 }}>
            {(["all", "deepseek", "mimo"] as const).map((opt) => (
              <button key={opt} style={{ border: 0, borderRadius: 8, padding: '6px 12px', background: exportPlatform === opt ? 'var(--brand)' : 'rgba(var(--fg), 0.12)', color: exportPlatform === opt ? '#fff' : 'var(--text-strong)', fontSize: '0.8em', fontWeight: 600, cursor: 'pointer' }} onClick={() => setExportPlatform(opt)}>{opt === "all" ? t('settings.all') : opt === "deepseek" ? "DeepSeek" : "MiMo"}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.85em', opacity: 0.7 }}>{t('settings.export_range')}</span>
          <select style={{ fontSize: '0.8em', padding: '5px 8px', borderRadius: 6, border: '1px solid rgba(var(--fg), 0.15)', background: 'rgba(var(--fg), 0.03)', color: 'var(--text)' }} value={exportFrom} onChange={(e) => setExportFrom(e.target.value)}>
            <option value="">{t('settings.all')}</option>
            {monthOptions.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <span style={{ fontSize: '0.85em', opacity: 0.7 }}>{t('settings.to_month')}</span>
          <select style={{ fontSize: '0.8em', padding: '5px 8px', borderRadius: 6, border: '1px solid rgba(var(--fg), 0.15)', background: 'rgba(var(--fg), 0.03)', color: 'var(--text)' }} value={exportTo} onChange={(e) => setExportTo(e.target.value)}>
            <option value="">{t('settings.all')}</option>
            {monthOptions.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <p className="muted">{t('settings.export_range_desc')}</p>
        <div className="settings-actions">
          <button className="secondary" onClick={async () => {
            const { save } = await import("@tauri-apps/plugin-dialog");
            const ext = exportFormat === "json" ? "json" : "csv";
            const filePath = await save({
              defaultPath: `dsm-data-${exportPlatform}.${ext}`,
              filters: [{ name: exportFormat.toUpperCase(), extensions: [ext] }]
            });
            if (!filePath) return;
            handleExport();
          }}>{tpl('settings.export_btn', { fmt: exportFormat.toUpperCase() })}</button>
        </div>
      </SettingsSection>
      <SettingsSection icon={<Settings size={15} />} title={t('settings.import_title')}>
        <p>{t('settings.import_desc')}</p>
        <div className="settings-actions">
          <button className="secondary" onClick={() => {
            const input = document.createElement("input"); input.type = "file"; input.accept = ".json";
            input.onchange = () => { const file = input.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => {
              try {
                const data = JSON.parse(reader.result as string);
                for (const [key, val] of Object.entries(data)) { if (key.startsWith('dsm-')) localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val)); }
                alert(t("settings.import_ok"));
              } catch { alert(t("settings.import_fail")); }
            }; reader.readAsText(file); };
            input.click();
          }}>{t('settings.import_btn')}</button>
        </div>
      </SettingsSection>
    </>
  );

  const categoryContent: Record<string, React.ReactNode> = {
    account: accountContent,
    general: generalContent,
    display: displayContent,
    notify: notifyContent,
    data: dataContent,
    about: aboutContent,
  };

  return (
    <section className="settings-panel" data-testid="settings-panel">
      <button className="floating-close settings-close" onClick={onBack} aria-label={t("detail.back")}><X size={20} /></button>
      <div className="settings-inner">
        <header className="settings-header" data-tauri-drag-region>
          <span className="settings-provider-title">DeepSeek / MiMo Monitor</span>
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
                transition: 'grid-template-rows 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
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
