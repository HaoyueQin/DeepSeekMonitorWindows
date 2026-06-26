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
import { SettingsPanel } from "./components/SettingsPanel";
import { ModelDetailPanel } from "./components/ModelDetailPanel";

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

  const setProvider = React.useCallback((next: Provider) => {
    setProviderState(next);
    setBalance(null); setBalanceState("loading");
    setUsage(null); setUsageState("loading");
    if (next === "mimo") void invoke("ensure_mimo_webview").catch(() => {});
    void invoke<AppConfig>("set_provider", { provider: next }).catch(() => {});
    loadBalance(next);
    loadUsage(next);
  }, [loadBalance, loadUsage]);

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


// ─── Mount ─────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<React.StrictMode><App /></React.StrictMode>);
