import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import {
  BarChart3, Brain, CalendarDays, CheckCircle2, Clipboard, CreditCard,
  Info, KeyRound, Power, RefreshCw, Settings, Shirt, SunMedium, X, Zap,
} from "lucide-react";
import "./styles.css";

import type { ViewName, ModelName, Provider, AppConfig, BalanceData, MimoBalanceData, BalanceState, UsageModel, UsageDay, UsageResult, MimoBalanceData as MimoBalance, MimoUsageModel, MimoUsageDay, MimoUsageResult } from "./types";
import { fmtInt, fmtTokensShort, fmtMoney, mmdd, todayStr, dateKey, addDays, recentUsageDays, previousMonth, modelDisplayName, modelIcon } from "./utils";
import { DashboardPanel } from "./components/DashboardPanel";

// Re-export for components that still live here
type MimoBalanceDataType = MimoBalance;

const fetchMonthUsage = (month: number, year: number) => {
  return invoke<UsageResult>("fetch_usage", { month, year });
};
const fetchCurrentUsage = async () => {
  const now = new Date();
  const current = await fetchMonthUsage(now.getMonth() + 1, now.getFullYear());
  const needsPreviousMonth = addDays(now, -6).getMonth() !== now.getMonth();
  if (!needsPreviousMonth) return current;
  try {
    const previous = previousMonth(now);
    const previousUsage = await fetchMonthUsage(previous.month, previous.year);
    return { ...current, days: [...previousUsage.days, ...current.days] };
  } catch { return current; }
};

const refreshOptions = [
  { label: "1 分钟", value: 60 },
  { label: "5 分钟", value: 300 },
  { label: "30 分钟", value: 1800 },
  { label: "1 小时", value: 3600 },
];

// ─── App ───────────────────────────────────────────────────
function App() {
  const [view, setView] = React.useState<ViewName>("dashboard");
  const [model, setModel] = React.useState<ModelName>("flash");
  const [provider, setProviderState] = React.useState<Provider>("deepseek");
  const [balance, setBalance] = React.useState<BalanceData | MimoBalanceData | null>(null);
  const [balanceState, setBalanceState] = React.useState<BalanceState>("loading");
  const [balanceError, setBalanceError] = React.useState("");
  const [usage, setUsage] = React.useState<UsageResult | MimoUsageResult | null>(null);
  const [usageState, setUsageState] = React.useState<BalanceState>("loading");
  const [usageError, setUsageError] = React.useState("");
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = React.useState(60);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = React.useState(false);

  const setProvider = React.useCallback((next: Provider) => {
    providerRef.current = next;
    setProviderState(next);
    setBalance(null); setBalanceState("loading");
    setUsage(null); setUsageState("loading");
    if (next === "mimo") void invoke("ensure_mimo_webview").catch(() => {});
    void invoke<AppConfig>("set_provider", { provider: next }).catch(() => {});
  }, []);

  const loadBalance = React.useCallback((p?: Provider) => {
    const active = p ?? provider;
    setBalanceState("loading");
    const cmd = active === "deepseek" ? "fetch_balance" : "fetch_mimo_balance";
    void invoke<BalanceData | MimoBalanceData>(cmd)
      .then((data) => { setBalance(data); setBalanceState("ok"); try { localStorage.setItem(`dsm-balance-${active}`, JSON.stringify(data)); } catch {} })
      .catch((error) => {
        try { const cached = localStorage.getItem(`dsm-balance-${active}`); if (cached) { setBalance(JSON.parse(cached)); setBalanceState("ok"); return; } } catch {}
        const message = typeof error === "string" ? error : "查询失败";
        setBalance(null); setBalanceError(message); setBalanceState(message.includes("未配置") ? "nokey" : "error");
      });
  }, [provider]);

  const loadUsage = React.useCallback((p?: Provider) => {
    const active = p ?? provider;
    setUsageState("loading");
    if (active === "deepseek") {
      void fetchCurrentUsage()
        .then((data) => { setUsage(data); setUsageState("ok"); setUsageError(""); try { localStorage.setItem("dsm-usage-deepseek", JSON.stringify(data)); } catch {} })
        .catch((error) => {
          try { const cached = localStorage.getItem("dsm-usage-deepseek"); if (cached) { setUsage(JSON.parse(cached)); setUsageState("ok"); setUsageError(""); return; } } catch {}
          const message = typeof error === "string" ? error : "查询失败"; setUsageError(message); setUsage(null); setUsageState(message.includes("未配置") ? "nokey" : "error");
        });
    } else {
      const now = new Date();
      void invoke<MimoUsageResult>("fetch_mimo_usage", { month: now.getMonth() + 1, year: now.getFullYear() })
        .then((data) => { setUsage(data); setUsageState("ok"); setUsageError(""); try { localStorage.setItem("dsm-usage-mimo", JSON.stringify(data)); } catch {} })
        .catch((error) => {
          try { const cached = localStorage.getItem("dsm-usage-mimo"); if (cached) { setUsage(JSON.parse(cached)); setUsageState("ok"); setUsageError(""); return; } } catch {}
          const message = typeof error === "string" ? error : "查询失败"; setUsageError(message); setUsage(null); setUsageState(message.includes("未配置") ? "nokey" : "error");
        });
    }
  }, [provider]);

  const refreshAll = React.useCallback(() => { loadBalance(); loadUsage(); }, [loadBalance, loadUsage]);
  const providerRef = React.useRef(provider);
  const initialLoadDone = React.useRef(false);

  React.useEffect(() => {
    if (providerRef.current !== provider) { providerRef.current = provider; loadBalance(provider); loadUsage(provider); }
  }, [provider, loadBalance, loadUsage]);

  React.useEffect(() => {
    void invoke<AppConfig>("get_app_config")
      .then((config) => {
        if (!initialLoadDone.current) {
          initialLoadDone.current = true;
          if (config.provider !== providerRef.current) { setBalance(null); setBalanceState("loading"); setUsage(null); setUsageState("loading"); }
          providerRef.current = config.provider; setProviderState(config.provider);
          setRefreshIntervalSeconds(config.refreshIntervalSeconds || 60); setAutoRefreshEnabled(config.autoRefreshEnabled);
          loadBalance(config.provider); loadUsage(config.provider);
        }
      })
      .catch(() => { if (!initialLoadDone.current) { initialLoadDone.current = true; setRefreshIntervalSeconds(60); setAutoRefreshEnabled(false); loadBalance(); loadUsage(); } });
  }, [loadBalance, loadUsage]);

  React.useEffect(() => {
    if (!autoRefreshEnabled) return;
    const timer = window.setInterval(refreshAll, refreshIntervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefreshEnabled, refreshAll, refreshIntervalSeconds]);

  React.useEffect(() => {
    const unlistenPromise = listen("mimo-auth-required", () => {
      setUsageState("error"); setUsageError("MiMo 未登录，请在设置中重新登录小米账号");
      setBalanceState("error"); setBalanceError("MiMo 未登录");
    });
    return () => { void unlistenPromise.then((unlisten) => unlisten()); };
  }, []);

  const hideWindow = React.useCallback(() => { void invoke("hide_main_window").catch(() => {}); }, []);

  return (
    <div className="stage">
      {view === "dashboard" && (
        <DashboardPanel
          provider={provider} onProviderChange={setProvider}
          balance={balance} balanceState={balanceState} balanceError={balanceError}
          usage={usage} usageState={usageState} usageError={usageError}
          onRefresh={refreshAll} onClose={hideWindow}
          onSettings={() => setView("settings")}
          onDetail={(nextModel) => { setModel(nextModel); setView("detail"); }}
        />
      )}
      {view === "settings" && (
        <SettingsPanel
          provider={provider} onProviderChange={setProvider} onBack={() => setView("dashboard")}
          onUsageLoaded={(nextUsage) => { setUsage(nextUsage); setUsageState("ok"); }}
          onUsageCleared={() => { setUsage(null); setUsageState("loading"); }}
          onRefreshIntervalChanged={setRefreshIntervalSeconds} onAutoRefreshChanged={setAutoRefreshEnabled}
        />
      )}
      {view === "detail" && (
        <ModelDetailPanel model={model} usage={usage} usageState={usageState} onBack={() => setView("dashboard")} provider={provider} />
      )}
    </div>
  );
}

// ─── SettingsPanel (stays here for now) ────────────────────
function SettingsPanel({ provider, onProviderChange, onBack, onUsageLoaded, onUsageCleared, onRefreshIntervalChanged, onAutoRefreshChanged }: {
  provider: Provider; onProviderChange: (p: Provider) => void; onBack: () => void;
  onUsageLoaded: (usage: UsageResult | MimoUsageResult) => void; onUsageCleared: () => void;
  onRefreshIntervalChanged: (seconds: number) => void; onAutoRefreshChanged: (enabled: boolean) => void;
}) {
  const [apiKey, setApiKey] = React.useState("");
  const [config, setConfig] = React.useState<AppConfig | null>(null);
  const [status, setStatus] = React.useState("正在读取本地配置");
  const [busy, setBusy] = React.useState(false);
  const [refresh, setRefresh] = React.useState(60);
  const [autoRefresh, setAutoRefresh] = React.useState(false);
  const [autostart, setAutostart] = React.useState(false);
  const [usageToken, setUsageToken] = React.useState("");
  const [usageStatus, setUsageStatus] = React.useState("");
  const [usageSyncing, setUsageSyncing] = React.useState(false);
  const [showManualPaste, setShowManualPaste] = React.useState(false);
  const [appVersion, setAppVersion] = React.useState("1.1.0");
  const [mimoStatus, setMimoStatus] = React.useState("");
  const [mimoSyncing, setMimoSyncing] = React.useState(false);
  const configPath = config?.configPath ?? "%APPDATA%\\DeepSeekMonitorWindows\\config.json";

  React.useEffect(() => {
    void invoke<AppConfig>("get_app_config").then((c) => { setConfig(c); setRefresh(c.refreshIntervalSeconds || 60); setAutoRefresh(c.autoRefreshEnabled); setAutostart(c.autostart); setStatus(c.apiKeyConfigured ? `已配置 ${c.apiKeyPreview}` : "未配置 API Key"); setUsageStatus(c.usageTokenConfigured ? "用量 Token 已配置" : "未配置用量 Token"); }).catch(() => setStatus("浏览器预览模式"));
  }, []);
  React.useEffect(() => { void getVersion().then(setAppVersion).catch(() => setAppVersion("1.1.0")); }, []);

  const refreshUsageAfterToken = React.useCallback((prefix: string) => {
    setUsageStatus(`${prefix}，正在刷新用量数据…`);
    return fetchCurrentUsage().then((u) => { onUsageLoaded(u); setUsageStatus(`${prefix}，本月消费 ${fmtMoney(u.monthCost)}`); return u; }).catch((e) => { setUsageStatus(`${prefix}，但用量刷新失败：${typeof e === "string" ? e : "刷新失败"}`); throw e; });
  }, [onUsageLoaded]);

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

  return (
    <section className="settings-panel" data-testid="settings-panel">
      <button className="floating-close settings-close" onClick={onBack} aria-label="返回主面板"><X size={20} /></button>
      <div className="settings-inner">
        <header className="settings-header" data-tauri-drag-region>
          <button className="provider-toggle" onClick={() => onProviderChange(provider === "deepseek" ? "mimo" : "deepseek")}>{provider === "deepseek" ? "DeepSeek Monitor" : "MiMo Monitor"}</button>
          <div><p>设置</p></div>
        </header>

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

        <SettingsSection icon={<Power size={15} />} title="通用">
          <Toggle label="开机自启" checked={autostart} onChange={saveAutostart} />
          <p>开启后，每次登录 Windows 时自动启动 {provider === "deepseek" ? "DeepSeek" : "MiMo"} Monitor。</p>
          <Toggle label="自动刷新" checked={autoRefresh} onChange={saveAutoRefreshEnabled} />
          <p>开启后，按设定周期自动从 {provider === "deepseek" ? "DeepSeek" : "MiMo"} API 拉取最新数据。</p>
          {autoRefresh && (<div className="segmented">{refreshOptions.map((o) => (<button key={o.value} className={refresh === o.value ? "selected" : ""} onClick={() => saveRefreshInterval(o.value)}>{o.label}</button>))}</div>)}
        </SettingsSection>

        <SettingsSection icon={<Settings size={15} />} title="窗口大小">
          <p>选择预设窗口尺寸，或拖拽窗口边缘自由调整。</p>
          <div className="segmented">
            {[{ label: "紧凑", w: 380, h: 560 }, { label: "标准", w: 463, h: 660 }, { label: "宽屏", w: 600, h: 700 }, { label: "大屏", w: 660, h: 900 }].map((preset) => (
              <button key={preset.label} onClick={() => { void invoke("resize_window", { width: preset.w, height: preset.h }).catch(() => {}); }}>{preset.label}</button>
            ))}
          </div>
        </SettingsSection>

        <SettingsSection icon={<Info size={15} />} title="关于">
          <div className="version-row"><span>当前版本</span><strong>v{appVersion}</strong></div>
        </SettingsSection>
      </div>
    </section>
  );
}

// ─── ModelDetailPanel (stays here for now) ─────────────────
function ModelDetailPanel({ model, usage, usageState, onBack, provider }: { model: ModelName; usage: UsageResult | MimoUsageResult | null; usageState: BalanceState; onBack: () => void; provider: Provider }) {
  const isDeepSeek = provider === "deepseek";
  const isFlash = model === "flash";
  const mimoUsage = !isDeepSeek ? (usage as MimoUsageResult | null) : null;
  const dsUsage = isDeepSeek ? (usage as UsageResult | null) : null;
  let title: string; let tintClass: string; let cost: string; let totalText: string;
  if (isDeepSeek) { const data = dsUsage?.models.find((i) => i.key === model) ?? null; title = isFlash ? "V4 Flash" : "V4 Pro"; tintClass = isFlash ? "flash" : "pro"; cost = data ? fmtMoney(data.cost) : "—"; totalText = data ? fmtTokensShort(data.totalTokens) : "—"; }
  else { title = modelDisplayName(model); tintClass = modelIcon(model); const md = mimoUsage?.models.find((m) => m.key === model); cost = md ? fmtMoney(md.cost) : "—"; totalText = md ? fmtTokensShort(md.totalTokens) : "—"; }
  const detailModelData = isDeepSeek ? (dsUsage?.models.find((i) => i.key === model) ?? null) : (mimoUsage?.models.find((m) => m.key === model) ?? null);
  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null);
  const [weekOffset, setWeekOffset] = React.useState(0);
  const MIN_BAR = 3; const DAYS_PER_WEEK = 7;
  const today = new Date(); const weekStart = addDays(today, weekOffset * DAYS_PER_WEEK - DAYS_PER_WEEK + 1);
  const dayKeys = Array.from({ length: DAYS_PER_WEEK }, (_, i) => dateKey(addDays(weekStart, i)));
  const dsMap = new Map((dsUsage?.days ?? []).map((d) => [d.date, d])); const mimoMap = new Map((mimoUsage?.days ?? []).map((d) => [d.date, d]));
  const points = dayKeys.map((date) => {
    if (isDeepSeek) { const d = dsMap.get(date); if (!d) return { date, hit: 0, miss: 0, response: 0, total: 0 }; const hit = isFlash ? d.flashCacheHit : d.proCacheHit; const miss = isFlash ? d.flashCacheMiss : d.proCacheMiss; const response = isFlash ? d.flashResponse : d.proResponse; return { date, hit, miss, response, total: hit + miss + response }; }
    else { const d = mimoMap.get(date); if (!d) return { date, hit: 0, miss: 0, response: 0, total: 0 }; const md = d.models.find((m) => m.key === model); return { date, hit: md?.cacheHitTokens ?? 0, miss: md?.cacheMissTokens ?? 0, response: md?.responseTokens ?? 0, total: md?.totalTokens ?? 0 }; }
  });
  const maxVal = Math.max(...points.map((p) => p.total), 1);
  const rangeText = `${mmdd(points[0]?.date ?? "")} - ${mmdd(points[points.length - 1]?.date ?? "")}`;
  const canGoForward = weekOffset < 0; const weekLabel = weekOffset === 0 ? "本周" : weekOffset === -1 ? "上周" : `${-weekOffset}周前`;

  return (
    <section className="panel detail-panel" data-testid="detail-panel">
      <button className="floating-close" onClick={onBack} aria-label="返回主面板"><X size={20} /></button>
      <article className="card detail-hero" data-tauri-drag-region>
        <div className={`model-badge large ${tintClass}`}>{isDeepSeek ? (isFlash ? <Zap size={34} fill="currentColor" /> : <Brain size={33} />) : <Zap size={34} fill="currentColor" />}</div>
        <div><h1>{title}</h1><p>{cost}</p></div>
      </article>
      <div className="detail-metrics">
        <article className="card metric-card"><span>API 请求次数</span><strong className={tintClass}>{detailModelData ? fmtInt(detailModelData.requestCount) : "—"}</strong></article>
        <article className="card metric-card"><span>Tokens</span><strong className={tintClass}>{totalText}</strong></article>
      </div>
      <article className="card detail-chart">
        <div className="detail-chart-head"><div><h2>按日 Token 消耗</h2><span>{rangeText}</span></div>
          <div className="chart-nav"><button className="chart-nav-btn" onClick={() => setWeekOffset((o) => o - 1)} title="上一周">‹</button><span className="chart-nav-label">{weekLabel}</span><button className="chart-nav-btn" onClick={() => setWeekOffset((o) => o + 1)} disabled={!canGoForward} title="下一周">›</button></div>
        </div>
        {usageState === "ok" && points.length > 0 ? (
          <>
            <div className="detail-bars" onMouseLeave={() => setHoveredIdx(null)}>
              {points.map((point, idx) => (
                <div className="detail-bar-column" key={point.date} onMouseEnter={() => setHoveredIdx(idx)}>
                  {hoveredIdx === idx && (
                    <div className={`bar-tooltip${idx <= 1 ? " align-left" : idx >= points.length - 2 ? " align-right" : ""}`}>
                      <div className="bar-tooltip-head"><span className="bar-tooltip-date">{point.date}</span><strong>{fmtInt(point.total)} tokens</strong></div>
                      <span className="bar-tooltip-row"><i className="dot hit" />输入（命中缓存）<strong>{fmtInt(point.hit)} tokens</strong></span>
                      <span className="bar-tooltip-row"><i className="dot miss" />输入（未命中缓存）<strong>{fmtInt(point.miss)} tokens</strong></span>
                      <span className="bar-tooltip-row"><i className="dot response" />输出<strong>{fmtInt(point.response)} tokens</strong></span>
                    </div>
                  )}
                  <span>{point.total > 0 ? fmtTokensShort(point.total) : ""}</span>
                  <div className="detail-bar-slot">
                    <div className="detail-bar-stacked" style={{ height: `${point.total > 0 ? Math.max(MIN_BAR, (point.total / maxVal) * 100) : MIN_BAR}%` }}>
                      {point.total > 0 ? (<>{point.hit > 0 && <i className="seg hit" style={{ flexGrow: point.hit }} />}{point.miss > 0 && <i className="seg miss" style={{ flexGrow: point.miss }} />}{point.response > 0 && <i className="seg response" style={{ flexGrow: point.response }} />}</>) : <i className="seg empty" />}
                    </div>
                  </div>
                  <em>{mmdd(point.date)}</em>
                </div>
              ))}
            </div>
            <div className="chart-legend-bottom">
              <span className="chart-legend-item"><i className="dot hit" />命中</span>
              <span className="chart-legend-item"><i className="dot miss" />未命中</span>
              <span className="chart-legend-item"><i className="dot response" />输出</span>
            </div>
          </>
        ) : <div className="chart-placeholder">{usageState === "nokey" ? "未配置用量 Token" : usageState === "loading" ? "查询中…" : "暂无数据"}</div>}
      </article>
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

// ─── Mount ─────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<React.StrictMode><App /></React.StrictMode>);
