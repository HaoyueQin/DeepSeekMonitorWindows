import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import "./styles.css";

import type { ViewName, ModelName, Provider, AppConfig, BalanceData, MimoBalanceData, BalanceState, UsageResult, MimoUsageResult } from "./types";
import { fetchWithCache } from "./utils";
import { initLang, t } from "./i18n";
import { DashboardPanel } from "./components/DashboardPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { ModelDetailPanel } from "./components/ModelDetailPanel";

initLang();

// ─── 缓存工具 ─────────────────────────────────────────────
const CACHE_PREFIX = "dsm-usage-";
const DEFAULT_HISTORY_MONTHS = 12;

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

/** 生成过去 N 个月列表（从本月往前数） */
function yearMonths(count: number): { year: number; month: number }[] {
  const now = new Date();
  const out: { year: number; month: number }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return out;
}

/** 清除超过 historyMonths 个月的缓存 */
function clearOldCache(provider: Provider, historyMonths: number) {
  const valid = new Set(yearMonths(historyMonths).map(m => cacheKey(provider, m.year, m.month)));
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
  for (const m of months) {
    for (const d of m.days) {
      const e = daysMap.get(d.date);
      if (e) {
        e.totalTokens += d.totalTokens; e.totalCost += d.totalCost;
        e.flashTokens += d.flashTokens; e.flashCacheHit += d.flashCacheHit; e.flashCacheMiss += d.flashCacheMiss; e.flashResponse += d.flashResponse;
        e.proTokens += d.proTokens; e.proCacheHit += d.proCacheHit; e.proCacheMiss += d.proCacheMiss; e.proResponse += d.proResponse;
      } else { daysMap.set(d.date, { ...d }); }
    }
  }
  return {
    monthCost: months[0]?.monthCost ?? 0,
    days: [...daysMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    models: months[0]?.models ?? [],
  };
}

/** 合并多个月的 MimoUsageResult */
function mergeMimo(months: MimoUsageResult[]): MimoUsageResult {
  const daysMap = new Map<string, MimoUsageResult['days'][number]>();
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
  return {
    monthCost: months[0]?.monthCost ?? 0,
    days: [...daysMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    models: months[0]?.models ?? [],
  };
}

// ─── 数据状态 reducer ────────────────────────────────────

type DataState = {
  balance: BalanceData | MimoBalanceData | null;
  balanceState: BalanceState;
  balanceError: string;
  usage: UsageResult | MimoUsageResult | null;
  usageState: BalanceState;
  usageError: string;
};

type DataAction =
  | { type: "BALANCE_LOADING" }
  | { type: "BALANCE_OK"; balance: BalanceData | MimoBalanceData }
  | { type: "BALANCE_ERR"; error: string }
  | { type: "USAGE_LOADING" }
  | { type: "USAGE_OK"; usage: UsageResult | MimoUsageResult }
  | { type: "USAGE_ERR"; error: string }
  | { type: "RESET" };

const initialDataState: DataState = {
  balance: null, balanceState: "loading", balanceError: "",
  usage: null, usageState: "loading", usageError: "",
};

function dataReducer(state: DataState, action: DataAction): DataState {
  switch (action.type) {
    case "BALANCE_LOADING": return { ...state, balanceState: "loading", balanceError: "" };
    case "BALANCE_OK": return { ...state, balance: action.balance, balanceState: "ok", balanceError: "" };
    case "BALANCE_ERR": return { ...state, balance: null, balanceState: action.error.includes("未配置") ? "nokey" : "error", balanceError: action.error };
    case "USAGE_LOADING": return { ...state, usageState: "loading", usageError: "" };
    case "USAGE_OK": return { ...state, usage: action.usage, usageState: "ok", usageError: "" };
    case "USAGE_ERR": return { ...state, usage: null, usageState: "error", usageError: action.error };
    case "RESET": return { ...initialDataState, balanceState: "loading", usageState: "loading" };
  }
}

// ─── App ───────────────────────────────────────────────────
function App() {
  const [view, setView] = React.useState<ViewName>("dashboard");
  const [model, setModel] = React.useState<ModelName>("flash");
  const [provider, setProviderState] = React.useState<Provider>("deepseek");
  const [data, dispatch] = React.useReducer(dataReducer, initialDataState);
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = React.useState(60);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = React.useState(false);
  const [currency, setCurrency] = React.useState<"cny" | "usd">("cny");
  const [exchangeRate, setExchangeRate] = React.useState<number>(0.137);
  const [efficiencyUnit, setEfficiencyUnit] = React.useState<"token_per_currency" | "currency_per_token">("currency_per_token");
  const [autoClearOld, setAutoClearOld] = React.useState(true);
  const [historyMonths, setHistoryMonths] = React.useState(DEFAULT_HISTORY_MONTHS);

  const providerRef = React.useRef(provider);
  const fetchingRef = React.useRef<Set<string>>(new Set());

  const { balance, balanceState, balanceError, usage, usageState, usageError } = data;

  const loadBalance = React.useCallback((p?: Provider) => {
    const active = p ?? provider;
    dispatch({ type: "BALANCE_LOADING" });
    const cmd = active === "deepseek" ? "fetch_balance" : "fetch_mimo_balance";
    void fetchWithCache<BalanceData | MimoBalanceData>(`dsm-balance-${active}`, () => invoke<BalanceData | MimoBalanceData>(cmd))
      .then((data) => {
        dispatch({ type: "BALANCE_OK", balance: data });
      })
      .catch((error) => {
        const message = typeof error === "string" ? error : t("app.error");
        dispatch({ type: "BALANCE_ERR", error: message });
      });
  }, [provider]);

  /** 全量加载：检查缓存，补齐缺失月份，一次性合并 */
  const loadUsage = React.useCallback(async (p?: Provider) => {
    const active = p ?? provider;
    dispatch({ type: "USAGE_LOADING" });
    const months = yearMonths(historyMonths);

    if (autoClearOld) clearOldCache(active, historyMonths);

    // 每次全量加载时重置防重集合，允许重试之前失败的月份
    fetchingRef.current = new Set();

    const cached: (UsageResult | MimoUsageResult)[] = [];
    const missing: { year: number; month: number }[] = [];

    for (const { year, month } of months) {
      const data = getCached(active, year, month);
      if (data) {
        cached.push(data);
      } else if (!fetchingRef.current.has(cacheKey(active, year, month))) {
        missing.push({ year, month });
      }
    }

    // 并行请求所有缺失月份，后端 MiMo 全局锁已缩小到仅在 eval JS 瞬间持有，
    // 多个 fetch 可以在 WebView2 中并发 pending。
    for (const { year, month } of missing) {
      fetchingRef.current.add(cacheKey(active, year, month));
    }
    const results = await Promise.allSettled(
      missing.map(({ year, month }) =>
        invoke<UsageResult | MimoUsageResult>(
          active === "deepseek" ? "fetch_usage" : "fetch_mimo_usage",
          { month, year }
        ).then((data) => {
          // 两个平台的查询结果都写回缓存，避免下次启动重复拉取
          if (data) setCached(active, year, month, data);
          return data;
        })
      )
    );
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value) {
        cached.push(r.value);
      } else {
        fetchingRef.current.delete(cacheKey(active, missing[i].year, missing[i].month));
      }
    });

    if (cached.length === 0) {
      dispatch({ type: "USAGE_ERR", error: t("usage.no_data") });
      return;
    }

    const merged = active === "deepseek"
      ? mergeDS(cached as UsageResult[])
      : mergeMimo(cached as MimoUsageResult[]);

    dispatch({ type: "USAGE_OK", usage: merged });
  }, [provider, autoClearOld, historyMonths]);

  /** 强制全量重载：忽略缓存，重取历史范围内全部月份，与本地比对后覆盖 */
  const reloadCache = React.useCallback(async (p?: Provider) => {
    const active = p ?? providerRef.current;
    dispatch({ type: "USAGE_LOADING" });
    const months = yearMonths(historyMonths);
    if (autoClearOld) clearOldCache(active, historyMonths);

    const fresh: (UsageResult | MimoUsageResult)[] = [];
    // 并行请求所有月份
    const results = await Promise.allSettled(
      months.map(({ year, month }) =>
        invoke<UsageResult | MimoUsageResult>(
          active === "deepseek" ? "fetch_usage" : "fetch_mimo_usage",
          { month, year }
        )
      )
    );
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value) {
        const { year, month } = months[i];
        const old = getCached(active, year, month);
        if (!old || JSON.stringify(old) !== JSON.stringify(r.value)) {
          setCached(active, year, month, r.value);
        }
        fresh.push(r.value);
      }
    });

    if (fresh.length === 0) {
      dispatch({ type: "USAGE_ERR", error: t("usage.no_data") });
      return;
    }

    const merged = active === "deepseek"
      ? mergeDS(fresh as UsageResult[])
      : mergeMimo(fresh as MimoUsageResult[]);
    dispatch({ type: "USAGE_OK", usage: merged });
  }, [autoClearOld, historyMonths]);

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
      const months = yearMonths(historyMonths);
      const all: (UsageResult | MimoUsageResult)[] = [];
      for (const { year: y, month: m } of months) {
        const c = getCached(active, y, m);
        if (c) all.push(c);
      }
      if (all.length > 0) {
        const merged = active === "deepseek"
          ? mergeDS(all as UsageResult[])
          : mergeMimo(all as MimoUsageResult[]);
        dispatch({ type: "USAGE_OK", usage: merged });
      }
    } catch { /* 静默失败 */ }
  }, [historyMonths]);

  // auto-refresh 只刷新余额和当月用量，不重拉历史
  React.useEffect(() => {
    if (!autoRefreshEnabled) return;
    const timer = window.setInterval(() => { loadBalance(); refreshCurrentMonth(); }, refreshIntervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefreshEnabled, loadBalance, refreshCurrentMonth, refreshIntervalSeconds]);

  const setProvider = React.useCallback((next: Provider) => {
    setProviderState(next);
    dispatch({ type: "RESET" });
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
          if (config.provider !== providerRef.current) { dispatch({ type: "RESET" }); }
          providerRef.current = config.defaultProvider || config.provider; setProviderState(config.defaultProvider || config.provider);
          setRefreshIntervalSeconds(config.refreshIntervalSeconds || 60); setAutoRefreshEnabled(config.autoRefreshEnabled);
          setCurrency(config.currency || "cny");
          setEfficiencyUnit(config.efficiencyUnit || "currency_per_token");
          setAutoClearOld(config.autoClearOldCache ?? true);
          setHistoryMonths(config.usageHistoryMonths || DEFAULT_HISTORY_MONTHS);
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
      if (providerRef.current !== "mimo") return; // 仅在 MiMo 模式下响应
      dispatch({ type: "USAGE_ERR", error: t("mimo.not_logged_in") });
      dispatch({ type: "BALANCE_ERR", error: t("mimo.not_logged_in_short") });
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
          onUsageLoaded={(nextUsage) => { dispatch({ type: "USAGE_OK", usage: nextUsage }); }}
          onUsageCleared={() => { dispatch({ type: "USAGE_LOADING" }); }}
          onRefreshIntervalChanged={setRefreshIntervalSeconds} onAutoRefreshChanged={setAutoRefreshEnabled}
          onCurrencyChanged={setCurrency}
          onEfficiencyUnitChanged={setEfficiencyUnit}
          onReloadCache={reloadCache}
          historyMonths={historyMonths}
          onHistoryMonthsChanged={(n) => { setHistoryMonths(n); void reloadCache(); }}
        />
      )}
      {view === "detail" && (
        <ModelDetailPanel model={model} usage={usage} usageState={usageState} onBack={() => setView("dashboard")} provider={provider} currency={currency} exchangeRate={exchangeRate} efficiencyUnit={efficiencyUnit} />
      )}
    </div>
  );
}


// ─── Mount ─────────────────────────────────────────────────
const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<React.StrictMode><App /></React.StrictMode>);
}

export default App;
