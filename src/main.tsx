import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import "./styles.css";

import type { ViewName, ModelName, Provider, AppConfig, BalanceData, MimoBalanceData, BalanceState, UsageResult, MimoUsageResult, MimoUsageModel } from "./types";
import { fetchWithCache } from "./utils";
import { initLang } from "./i18n";
import { DashboardPanel } from "./components/DashboardPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { ModelDetailPanel } from "./components/ModelDetailPanel";

initLang();

// ─── 缓存工具 ─────────────────────────────────────────────
const CACHE_PREFIX = "dsm-usage-";
const MONTHS_TO_KEEP = 12;

function cacheKey(provider: Provider, year: number, month: number) {
  return `${CACHE_PREFIX}${provider}-${year}-${String(month).padStart(2, '0')}`;
}

function getCached(provider: Provider, year: number, month: number) {
  try {
    const raw = localStorage.getItem(cacheKey(provider, year, month));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setCached(provider: Provider, year: number, month: number, data: UsageResult | MimoUsageResult) {
  try { localStorage.setItem(cacheKey(provider, year, month), JSON.stringify(data)); } catch {}
}

/** 生成过去 12 个月列表（从本月往前数） */
function yearMonths(): { year: number; month: number }[] {
  const now = new Date();
  const out: { year: number; month: number }[] = [];
  for (let i = 0; i < MONTHS_TO_KEEP; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return out;
}

/** 清除超过 MONTHS_TO_KEEP 个月的缓存 */
function clearOldCache(provider: Provider) {
  const valid = new Set(yearMonths().map(m => cacheKey(provider, m.year, m.month)));
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(`${CACHE_PREFIX}${provider}-`) && !valid.has(key)) {
      toRemove.push(key);
    }
  }
  for (const key of toRemove) localStorage.removeItem(key);
}

/** 合并多个月的 UsageResult（DeepSeek） */
function mergeDS(months: UsageResult[]): UsageResult {
  const daysMap = new Map<string, UsageResult['days'][number]>();
  const modelMap = new Map<string, UsageResult['models'][number]>();
  for (const m of months) {
    for (const d of m.days) {
      const e = daysMap.get(d.date);
      if (e) {
        e.totalTokens += d.totalTokens; e.totalCost += d.totalCost;
        e.flashTokens += d.flashTokens; e.flashCacheHit += d.flashCacheHit; e.flashCacheMiss += d.flashCacheMiss; e.flashResponse += d.flashResponse;
        e.proTokens += d.proTokens; e.proCacheHit += d.proCacheHit; e.proCacheMiss += d.proCacheMiss; e.proResponse += d.proResponse;
      } else { daysMap.set(d.date, { ...d }); }
    }
    for (const mdl of m.models) {
      const e = modelMap.get(mdl.key);
      if (e) {
        e.totalTokens += mdl.totalTokens; e.requestCount += mdl.requestCount;
        e.cacheHitTokens += mdl.cacheHitTokens; e.cacheMissTokens += mdl.cacheMissTokens; e.responseTokens += mdl.responseTokens; e.cost += mdl.cost;
      } else { modelMap.set(mdl.key, { ...mdl }); }
    }
  }
  return {
    monthCost: months[0]?.monthCost ?? 0,
    days: [...daysMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    models: [...modelMap.values()],
  };
}

/** 合并多个月的 MimoUsageResult */
function mergeMimo(months: MimoUsageResult[]): MimoUsageResult {
  const daysMap = new Map<string, MimoUsageResult['days'][number]>();
  // Deep-merge days: 同日期累加 total_tokens/total_cost，models 也合并
  for (const m of months) {
    for (const d of m.days) {
      const e = daysMap.get(d.date);
      if (e) {
        e.totalTokens += d.totalTokens; e.totalCost += d.totalCost;
        const mm = new Map<string, MimoUsageResult['days'][number]['models'][number]>();
        for (const dm of [...e.models, ...d.models]) {
          const prev = mm.get(dm.key);
          if (prev) {
            prev.totalTokens += dm.totalTokens; prev.cacheHitTokens += dm.cacheHitTokens;
            prev.cacheMissTokens += dm.cacheMissTokens; prev.responseTokens += dm.responseTokens; prev.totalCost += dm.totalCost;
          } else { mm.set(dm.key, { ...dm }); }
        }
        e.models = [...mm.values()];
      } else { daysMap.set(d.date, { ...d, models: d.models.map(m2 => ({ ...m2 })) }); }
    }
  }
  const modelMap = new Map<string, MimoUsageModel>();
  for (const m of months) {
    for (const mdl of m.models) {
      const e = modelMap.get(mdl.key);
      if (e) {
        e.totalTokens += mdl.totalTokens; e.requestCount += mdl.requestCount;
        e.cacheHitTokens += mdl.cacheHitTokens; e.cacheMissTokens += mdl.cacheMissTokens; e.responseTokens += mdl.responseTokens; e.cost += mdl.cost;
      } else { modelMap.set(mdl.key, { ...mdl }); }
    }
  }
  return {
    monthCost: months[0]?.monthCost ?? 0,
    days: [...daysMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    models: [...modelMap.values()],
  };
}

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
  const [currency, setCurrency] = React.useState<"cny" | "usd">("cny");
  const [exchangeRate, setExchangeRate] = React.useState<number>(0.137);
  const [efficiencyUnit, setEfficiencyUnit] = React.useState<"token_per_currency" | "currency_per_token">("currency_per_token");
  const [autoClearOld, setAutoClearOld] = React.useState(false);

  const providerRef = React.useRef(provider);
  const fetchingRef = React.useRef<Set<string>>(new Set());

  const loadBalance = React.useCallback((p?: Provider) => {
    const active = p ?? provider;
    setBalanceState("loading");
    const cmd = active === "deepseek" ? "fetch_balance" : "fetch_mimo_balance";
    void fetchWithCache<BalanceData | MimoBalanceData>(`dsm-balance-${active}`, () => invoke<BalanceData | MimoBalanceData>(cmd))
      .then((data) => { setBalance(data); setBalanceState("ok"); })
      .catch((error) => {
        const message = typeof error === "string" ? error : "查询失败";
        setBalance(null); setBalanceError(message); setBalanceState(message.includes("未配置") ? "nokey" : "error");
      });
  }, [provider]);

  /** 全量加载：检查缓存，补齐缺失月份，一次性合并 */
  const loadUsage = React.useCallback(async (p?: Provider) => {
    const active = p ?? provider;
    setUsageState("loading");
    const months = yearMonths();

    if (autoClearOld) clearOldCache(active);

    const cached: (UsageResult | MimoUsageResult)[] = [];
    const missing: { year: number; month: number }[] = [];

    for (const { year, month } of months) {
      const data = getCached(active, year, month);
      if (data && data.days && data.days.length > 0) {
        cached.push(data);
      } else if (!fetchingRef.current.has(cacheKey(active, year, month))) {
        missing.push({ year, month });
      }
    }

    // 从当前月开始往前取缺失月份（当前月优先，数据可能变化）
    for (const { year, month } of missing) {
      fetchingRef.current = new Set(fetchingRef.current).add(cacheKey(active, year, month));
      try {
        const data = active === "deepseek"
          ? await invoke<UsageResult>("fetch_usage", { month, year })
          : await invoke<MimoUsageResult>("fetch_mimo_usage", { month, year });
        if (data && data.days && data.days.length > 0) {
          setCached(active, year, month, data);
          cached.push(data);
        }
      } catch { /* 跳过失败的月份，下次再试 */ }
    }

    if (cached.length === 0) {
      setUsage(null); setUsageState("error"); setUsageError("暂无用量数据");
      return;
    }

    const merged = active === "deepseek"
      ? mergeDS(cached as UsageResult[])
      : mergeMimo(cached as MimoUsageResult[]);

    setUsage(merged); setUsageState("ok"); setUsageError("");
  }, [provider, autoClearOld]);

  /** 增量刷新：仅更新当前月（当日数据可能变化） */
  const refreshCurrentMonth = React.useCallback(async () => {
    const active = providerRef.current;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    try {
      const data = active === "deepseek"
        ? await invoke<UsageResult>("fetch_usage", { month, year })
        : await invoke<MimoUsageResult>("fetch_mimo_usage", { month, year });
      if (data) setCached(active, year, month, data);
      // 重新合并所有缓存月份
      const months = yearMonths();
      const all: (UsageResult | MimoUsageResult)[] = [];
      for (const { year: y, month: m } of months) {
        const c = getCached(active, y, m);
        if (c && c.days && c.days.length > 0) all.push(c);
      }
      if (all.length > 0) {
        const merged = active === "deepseek"
          ? mergeDS(all as UsageResult[])
          : mergeMimo(all as MimoUsageResult[]);
        setUsage(merged); setUsageState("ok");
      }
    } catch { /* 静默失败 */ }
  }, []);

  const refreshAll = React.useCallback(() => { loadBalance(); }, [loadBalance]);

  // auto-refresh 只刷新余额和当月用量，不重拉历史
  React.useEffect(() => {
    if (!autoRefreshEnabled) return;
    const timer = window.setInterval(() => { loadBalance(); refreshCurrentMonth(); }, refreshIntervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefreshEnabled, loadBalance, refreshCurrentMonth, refreshIntervalSeconds]);

  const setProvider = React.useCallback((next: Provider) => {
    setProviderState(next);
    setBalance(null); setBalanceState("loading");
    setUsage(null); setUsageState("loading");
    if (next === "mimo") void invoke("ensure_mimo_webview").catch(console.warn);
    void invoke<AppConfig>("set_provider", { provider: next }).catch(console.warn);
  }, []);

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
          providerRef.current = config.defaultProvider || config.provider; setProviderState(config.defaultProvider || config.provider);
          setRefreshIntervalSeconds(config.refreshIntervalSeconds || 60); setAutoRefreshEnabled(config.autoRefreshEnabled);
          setCurrency(config.currency || "cny");
          setEfficiencyUnit(config.efficiencyUnit || "currency_per_token");
          setAutoClearOld(config.autoClearOldCache || false);
          const cached = localStorage.getItem("dsm-exrate-v2");
          if (cached) {
            try {
              const { rate, ts } = JSON.parse(cached);
              if (Date.now() - ts < 24 * 3600 * 1000 && rate > 0) { setExchangeRate(rate); }
              else { throw new Error("invalid or expired"); }
            } catch { localStorage.removeItem("dsm-exrate-v2"); }
          }
          if (!localStorage.getItem("dsm-exrate-v2")) {
            void fetch("https://open.er-api.com/v6/latest/CNY")
              .then(r => r.json())
              .then(data => {
                if (data?.rates?.USD) { setExchangeRate(data.rates.USD); localStorage.setItem("dsm-exrate-v2", JSON.stringify({ rate: data.rates.USD, ts: Date.now() })); }
              })
              .catch(() => {});
          }
          loadBalance(config.provider); loadUsage(config.provider);
        }
      })
      .catch(() => { if (!initialLoadDone.current) { initialLoadDone.current = true; setRefreshIntervalSeconds(60); setAutoRefreshEnabled(false); loadBalance(); loadUsage(); } });
  }, [loadBalance, loadUsage]);

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
          onRefresh={() => { loadBalance(); refreshCurrentMonth(); }} onClose={hideWindow}
          onSettings={() => setView("settings")}
          onDetail={(nextModel) => { setModel(nextModel); setView("detail"); }}
          currency={currency}
          exchangeRate={exchangeRate}
          efficiencyUnit={efficiencyUnit}
        />
      )}
      {view === "settings" && (
        <SettingsPanel
          provider={provider} onProviderChange={setProvider} onBack={() => setView("dashboard")}
          onUsageLoaded={(nextUsage) => { setUsage(nextUsage); setUsageState("ok"); }}
          onUsageCleared={() => { setUsage(null); setUsageState("loading"); }}
          onRefreshIntervalChanged={setRefreshIntervalSeconds} onAutoRefreshChanged={setAutoRefreshEnabled}
          onCurrencyChanged={setCurrency}
          onEfficiencyUnitChanged={setEfficiencyUnit}
        />
      )}
      {view === "detail" && (
        <ModelDetailPanel model={model} usage={usage} usageState={usageState} onBack={() => setView("dashboard")} provider={provider} currency={currency} exchangeRate={exchangeRate} efficiencyUnit={efficiencyUnit} />
      )}
    </div>
  );
}


// ─── Mount ─────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<React.StrictMode><App /></React.StrictMode>);
