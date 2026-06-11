import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import {
  BarChart3,
  Brain,
  CalendarDays,
  CheckCircle2,
  Clipboard,
  CreditCard,
  Info,
  KeyRound,
  Power,
  RefreshCw,
  Settings,
  Shirt,
  SunMedium,
  X,
  Zap,
} from "lucide-react";
import "./styles.css";

type ViewName = "dashboard" | "settings" | "detail";
type ModelName = "flash" | "pro" | (string & {});
type Provider = "deepseek" | "mimo";
type AppConfig = {
  apiKeyConfigured: boolean;
  apiKeyPreview: string | null;
  usageTokenConfigured: boolean;
  provider: Provider;
  mimoTokenConfigured: boolean;
  refreshIntervalSeconds: number;
  autoRefreshEnabled: boolean;
  autostart: boolean;
  configPath: string;
};
type BalanceData = {
  isAvailable: boolean;
  currency: string;
  totalBalance: string;
  grantedBalance: string;
  toppedUpBalance: string;
};
type BalanceState = "loading" | "ok" | "error" | "nokey";

type UsageModel = {
  key: string;
  name: string;
  totalTokens: number;
  requestCount: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  responseTokens: number;
  cost: number;
};
type UsageDay = {
  date: string;
  flashTokens: number;
  flashCacheHit: number;
  flashCacheMiss: number;
  flashResponse: number;
  proTokens: number;
  proCacheHit: number;
  proCacheMiss: number;
  proResponse: number;
  totalTokens: number;
  totalCost: number;
};
type UsageResult = {
  models: UsageModel[];
  days: UsageDay[];
  monthCost: number;
};

type MimoBalanceData = {
  availableBalance: string;
  currency: string;
  totalConsumption: string;
  monthlyExpense: string;
};

type MimoUsageModel = {
  key: string;
  name: string;
  totalTokens: number;
  requestCount: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  responseTokens: number;
  cost: number;
};

type MimoUsageDay = {
  date: string;
  totalTokens: number;
  totalCost: number;
  models: Array<{ key: string; totalTokens: number; totalCost: number; }>;
};

type MimoUsageResult = {
  models: MimoUsageModel[];
  days: MimoUsageDay[];
  monthCost: number;
};

const modelDisplayName = (key: string): string => {
  const map: Record<string, string> = {
    "mimo-v2.5": "V2.5",
    "mimo-v2.5-pro": "V2.5 Pro",
  };
  return map[key] ?? key;
};

const modelIcon = (key: string): "flash" | "pro" => {
  if (key.includes("pro")) return "pro";
  return "flash";
};

const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtTokensShort = (n: number) => {
  if (n >= 1e8) return (n / 1e6).toFixed(0) + "M";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
};
const fmtMoney = (n: number) => "¥" + n.toFixed(2);
const mmdd = (date: string) => {
  const parts = date.split("-");
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : date;
};
const todayStr = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const addDays = (date: Date, offset: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + offset);
  return next;
};
const recentUsageDays = (days: UsageDay[], count = 7): UsageDay[] => {
  const source = new Map(days.filter((day) => day.date <= todayStr()).map((day) => [day.date, day]));
  const today = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = dateKey(addDays(today, index - count + 1));
    return (
      source.get(date) ?? {
        date,
        flashTokens: 0,
        flashCacheHit: 0,
        flashCacheMiss: 0,
        flashResponse: 0,
        proTokens: 0,
        proCacheHit: 0,
        proCacheMiss: 0,
        proResponse: 0,
        totalTokens: 0,
        totalCost: 0,
      }
    );
  });
};
const previousMonth = (date: Date) => {
  const previous = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  return { month: previous.getMonth() + 1, year: previous.getFullYear() };
};
const fetchMonthUsage = (month: number, year: number) => {
  return invoke<UsageResult>("fetch_usage", { month, year });
};
const fetchCurrentUsage = async () => {
  const now = new Date();
  const current = await fetchMonthUsage(now.getMonth() + 1, now.getFullYear());
  const needsPreviousMonth = addDays(now, -6).getMonth() !== now.getMonth();
  if (!needsPreviousMonth) {
    return current;
  }
  try {
    const previous = previousMonth(now);
    const previousUsage = await fetchMonthUsage(previous.month, previous.year);
    return {
      ...current,
      days: [...previousUsage.days, ...current.days],
    };
  } catch {
    return current;
  }
};

const refreshOptions = [
  { label: "1 分钟", value: 60 },
  { label: "5 分钟", value: 300 },
  { label: "30 分钟", value: 1800 },
  { label: "1 小时", value: 3600 },
];

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
    setBalance(null);
    setBalanceState("loading");
    setUsage(null);
    setUsageState("loading");
    if (next === "mimo") {
      void invoke("ensure_mimo_webview").catch(() => {});
    }
    void invoke<AppConfig>("set_provider", { provider: next }).catch(() => {});
  }, []);

  const loadBalance = React.useCallback(
    (p?: Provider) => {
      const active = p ?? provider;
      setBalanceState("loading");
      const cmd = active === "deepseek" ? "fetch_balance" : "fetch_mimo_balance";
      void invoke<BalanceData | MimoBalanceData>(cmd)
        .then((data) => {
          setBalance(data);
          setBalanceState("ok");
        })
        .catch((error) => {
          const message = typeof error === "string" ? error : "查询失败";
          setBalance(null);
          setBalanceError(message);
          setBalanceState(message.includes("未配置") ? "nokey" : "error");
        });
    },
    [provider],
  );

  const loadUsage = React.useCallback(
    (p?: Provider) => {
      const active = p ?? provider;
      setUsageState("loading");
      if (active === "deepseek") {
        void fetchCurrentUsage()
          .then((data) => {
            setUsage(data);
            setUsageState("ok");
            setUsageError("");
          })
          .catch((error) => {
            const message = typeof error === "string" ? error : "查询失败";
            setUsageError(message);
            setUsage(null);
            setUsageState(message.includes("未配置") ? "nokey" : "error");
          });
      } else {
        const now = new Date();
        void invoke<MimoUsageResult>("fetch_mimo_usage", { month: now.getMonth() + 1, year: now.getFullYear() })
          .then((data) => {
            setUsage(data);
            setUsageState("ok");
            setUsageError("");
          })
          .catch((error) => {
            const message = typeof error === "string" ? error : "查询失败";
            setUsageError(message);
            setUsage(null);
            setUsageState(message.includes("未配置") ? "nokey" : "error");
          });
      }
    },
    [provider],
  );

  const refreshAll = React.useCallback(() => {
    loadBalance();
    loadUsage();
  }, [loadBalance, loadUsage]);

  const providerRef = React.useRef(provider);
  const initialLoadDone = React.useRef(false);

  React.useEffect(() => {
    if (providerRef.current !== provider) {
      providerRef.current = provider;
      loadBalance(provider);
      loadUsage(provider);
    }
  }, [provider, loadBalance, loadUsage]);

  React.useEffect(() => {
    void invoke<AppConfig>("get_app_config")
      .then((config) => {
        if (!initialLoadDone.current) {
          initialLoadDone.current = true;
          if (config.provider !== providerRef.current) {
            setBalance(null);
            setBalanceState("loading");
            setUsage(null);
            setUsageState("loading");
          }
          providerRef.current = config.provider;
          setProviderState(config.provider);
          setRefreshIntervalSeconds(config.refreshIntervalSeconds || 60);
          setAutoRefreshEnabled(config.autoRefreshEnabled);
          // Only load after config is known
          loadBalance(config.provider);
          loadUsage(config.provider);
        }
      })
      .catch(() => {
        if (!initialLoadDone.current) {
          initialLoadDone.current = true;
          setRefreshIntervalSeconds(60);
          setAutoRefreshEnabled(false);
          loadBalance();
          loadUsage();
        }
      });
  }, [loadBalance, loadUsage]);

  React.useEffect(() => {
    if (!autoRefreshEnabled) {
      return;
    }
    const timer = window.setInterval(refreshAll, refreshIntervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefreshEnabled, refreshAll, refreshIntervalSeconds]);

  const hideWindow = React.useCallback(() => {
    void invoke("hide_main_window").catch(() => {
      // Browser preview has no Tauri IPC. Keep it non-blocking for visual checks.
    });
  }, []);

  return (
    <div className="stage">
      {view === "dashboard" && (
        <DashboardPanel
          provider={provider}
          onProviderChange={setProvider}
          balance={balance}
          balanceState={balanceState}
          balanceError={balanceError}
          usage={usage}
          usageState={usageState}
          usageError={usageError}
          onRefresh={refreshAll}
          onClose={hideWindow}
          onSettings={() => setView("settings")}
          onDetail={(nextModel) => {
            setModel(nextModel);
            setView("detail");
          }}
        />
      )}
      {view === "settings" && (
        <SettingsPanel
          provider={provider}
          onProviderChange={setProvider}
          onUsageLoaded={(nextUsage) => {
            setUsage(nextUsage);
            setUsageState("ok");
            setUsageError("");
          }}
          onUsageCleared={() => {
            setUsage(null);
            setUsageState("nokey");
            setUsageError("未配置用量 Token");
          }}
          onRefreshIntervalChanged={setRefreshIntervalSeconds}
          onAutoRefreshChanged={setAutoRefreshEnabled}
          onBack={() => setView("dashboard")}
        />
      )}
      {view === "detail" && (
        <ModelDetailPanel model={model} usage={usage} usageState={usageState} provider={provider} onBack={() => setView("dashboard")} />
      )}
    </div>
  );
}

function BrandIcon({ provider, size = 32 }: { provider: Provider; size?: number }) {
  return null;
}

function ProviderSelect({
  provider,
  onChange,
}: {
  provider: Provider;
  onChange: (p: Provider) => void;
}) {
  return (
    <button className="provider-toggle" onClick={() => onChange(provider === "deepseek" ? "mimo" : "deepseek")}>
      {provider === "deepseek" ? "DeepSeek Monitor" : "MiMo Monitor"}
      <span className="provider-arrow">↺</span>
    </button>
  );
}

function DashboardPanel({
  provider,
  onProviderChange,
  balance,
  balanceState,
  balanceError,
  usage,
  usageState,
  usageError,
  onRefresh,
  onClose,
  onSettings,
  onDetail,
}: {
  provider: Provider;
  onProviderChange: (p: Provider) => void;
  balance: BalanceData | MimoBalanceData | null;
  balanceState: BalanceState;
  balanceError: string;
  usage: UsageResult | MimoUsageResult | null;
  usageState: BalanceState;
  usageError: string;
  onRefresh: () => void;
  onClose: () => void;
  onSettings: () => void;
  onDetail: (model: ModelName) => void;
}) {
  const [theme, setTheme] = React.useState<string>(
    () => localStorage.getItem("ui-theme") || "dark",
  );
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("ui-theme", next);
    document.documentElement.setAttribute("data-theme", next);
  };

  const isDeepSeek = provider === "deepseek";
  const dsUsage = isDeepSeek ? (usage as UsageResult | null) : null;
  const mimoUsage = !isDeepSeek ? (usage as MimoUsageResult | null) : null;

  const flash = dsUsage?.models.find((item) => item.key === "flash") ?? null;
  const pro = dsUsage?.models.find((item) => item.key === "pro") ?? null;
  const maxTokens = Math.max(
    flash?.totalTokens ?? 0,
    pro?.totalTokens ?? 0,
    ...(mimoUsage?.models.map((m) => m.totalTokens) ?? []),
    1,
  );
  const today = dsUsage?.days.find((day) => day.date === todayStr()) ?? null;
  const todayCost = usageState === "ok" && today ? today.totalCost : (mimoUsage ? null : null);
  const monthCost = usageState === "ok" && usage ? usage.monthCost : null;

  const mimoDefaultModels: MimoUsageModel[] = [
    { key: "mimo-v2.5", name: "MiMo-V2.5", totalTokens: 0, requestCount: 0, cacheHitTokens: 0, cacheMissTokens: 0, responseTokens: 0, cost: 0 },
    { key: "mimo-v2.5-pro", name: "MiMo-V2.5-Pro", totalTokens: 0, requestCount: 0, cacheHitTokens: 0, cacheMissTokens: 0, responseTokens: 0, cost: 0 },
  ];
  const topModels = mimoUsage
    ? mimoDefaultModels.map((def) => {
        const actual = mimoUsage.models.find((m) => m.key === def.key);
        return actual ?? def;
      })
    : mimoDefaultModels;

  return (
    <section className="panel dashboard-panel" data-testid="dashboard-panel">
      <header className="panel-header" data-tauri-drag-region>
        <div className="title-lockup" data-tauri-drag-region>
          <ProviderSelect provider={provider} onChange={onProviderChange} />
        </div>
        <div className="header-actions">
          <button aria-label="刷新" onClick={onRefresh}>
            <RefreshCw size={22} />
          </button>
          <div className="skin-menu-wrap">
            <button
              aria-label="Toggle theme"
              className="skin-toggle"
              title={theme === "dark" ? "Switch to light" : "Switch to dark"}
              onClick={toggleTheme}
            >
              <Shirt size={21} />
            </button>
          </div>
          <button aria-label="设置" onClick={onSettings}>
            <Settings size={23} />
          </button>
          <button aria-label="关闭" onClick={onClose}>
            <X size={25} />
          </button>
        </div>
      </header>

      <BalanceCard
        balance={balance}
        state={balanceState}
        error={balanceError}
        todayCost={todayCost}
        monthCost={monthCost}
        provider={provider}
      />

      <div className="usage-stack">
        {isDeepSeek ? (
          <>
            <UsageRow
              modelKey="flash"
              data={flash ? { ...flash, key: "flash" } : null}
              maxTokens={maxTokens}
              state={usageState}
              onClick={() => onDetail("flash")}
            />
            <UsageRow
              modelKey="pro"
              data={pro ? { ...pro, key: "pro" } : null}
              maxTokens={maxTokens}
              state={usageState}
              onClick={() => onDetail("pro")}
            />
          </>
        ) : (
          topModels.map((m) => (
            <UsageRow
              key={m.key}
              modelKey={modelIcon(m.key)}
              data={{ ...m, key: modelIcon(m.key) }}
              maxTokens={maxTokens}
              state={usageState}
              onClick={() => onDetail(m.key)}
              modelDisplay={modelDisplayName(m.key)}
            />
          ))
        )}
      </div>

      <UsageChart usage={usage} state={usageState} error={usageError} provider={provider} />
    </section>
  );
}

function BalanceCard({
  balance,
  state,
  error,
  todayCost,
  monthCost,
  provider,
}: {
  balance: BalanceData | MimoBalanceData | null;
  state: BalanceState;
  error: string;
  todayCost: number | null;
  monthCost: number | null;
  provider: Provider;
}) {
  const isDeepSeek = provider === "deepseek";
  const dsBalance = isDeepSeek ? (balance as BalanceData | null) : null;
  const mimoBalance = !isDeepSeek ? (balance as MimoBalanceData | null) : null;

  const symbol = isDeepSeek
    ? (dsBalance?.currency === "USD" ? "$" : "¥")
    : (mimoBalance?.currency === "USD" ? "$" : "¥");
  const amount =
    state === "loading"
      ? "查询中…"
      : state === "nokey"
        ? "未配置"
        : state === "error"
          ? "查询失败"
          : isDeepSeek
            ? `${symbol}${dsBalance?.totalBalance ?? "0.00"}`
            : `${symbol}${mimoBalance?.availableBalance ?? "0.00"}`;
  const statusText = state === "ok" ? (isDeepSeek && dsBalance?.isAvailable === false ? "余额不足" : "可用") : "—";
  const statusOff = state === "ok" && isDeepSeek && dsBalance != null && !dsBalance.isAvailable;

  return (
    <article className="card balance-card">
      <div className="card-title-row">
        <div className="caption-with-icon">
          <CreditCard size={15} />
          <span>账户余额</span>
        </div>
        <div className={`status-pill ${statusOff ? "off" : ""}`}>
          <span />
          {statusText}
        </div>
      </div>
      <div className={`balance-amount ${state !== "ok" ? "balance-dim" : ""}`}>{amount}</div>
      {state === "error" && <div className="balance-error">{error}</div>}
      <div className="metric-grid">
        <div className="mini-card">
          <div className="caption-with-icon orange">
            <SunMedium size={15} />
            <span>当日消耗</span>
          </div>
          <strong>{todayCost != null ? fmtMoney(todayCost) : "—"}</strong>
        </div>
        <div className="mini-card">
          <div className="caption-with-icon orange">
            <CalendarDays size={15} />
            <span>本月消费</span>
          </div>
          <strong>{monthCost != null ? fmtMoney(monthCost) : "—"}</strong>
        </div>
      </div>
    </article>
  );
}

function UsageRow({
  modelKey,
  data,
  maxTokens,
  state,
  onClick,
  modelDisplay,
}: {
  modelKey: ModelName;
  data: UsageModel | null;
  maxTokens: number;
  state: BalanceState;
  onClick: () => void;
  modelDisplay?: string;
}) {
  const isFlash = modelKey === "flash";
  const name = modelDisplay ?? (isFlash ? "V4 Flash" : "V4 Pro");
  const tokensText = data
    ? `${fmtInt(data.totalTokens)} Tokens`
    : state === "loading"
      ? "查询中…"
      : state === "nokey"
        ? "未配置 Token"
        : state === "error"
          ? "用量不可用"
          : "—";
  const cost = data ? fmtMoney(data.cost) : "—";
  const ratio = data && data.cost > 0 ? `${(data.cost * 1_000_000 / data.totalTokens).toFixed(3)} ¥/MT` : "—";
  const width = data ? `${Math.max(2, (data.totalTokens / maxTokens) * 100)}%` : "0%";

  return (
    <button className="card usage-row" onClick={onClick}>
      <div className={`model-badge ${isFlash ? "flash" : "pro"}`}>
        {isFlash ? <Zap size={27} fill="currentColor" /> : <Brain size={25} />}
      </div>
      <div className="usage-main">
        <h2>{name}</h2>
        <div className="token-line">
          <span>{tokensText}</span>
          <div className="progress-track">
            <i className={isFlash ? "flash-fill" : "pro-fill"} style={{ width }} />
          </div>
        </div>
        {data && data.cacheHitTokens + data.cacheMissTokens > 0 && (
          <span className={`cache-hit-rate ${isFlash ? "flash" : "pro"}`}>
            缓存命中{" "}
            {((data.cacheHitTokens / (data.cacheHitTokens + data.cacheMissTokens)) * 100).toFixed(3)}%
          </span>
        )}
      </div>
      <div className="usage-price">
        <strong>{cost}</strong>
        <span>{ratio}</span>
      </div>
    </button>
  );
}

function UsageChart({
  usage,
  state,
  error,
  provider,
}: {
  usage: UsageResult | MimoUsageResult | null;
  state: BalanceState;
  error: string;
  provider: Provider;
}) {
  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null);
  const MIN_BAR = 3;

  const isDeepSeek = provider === "deepseek";
  const dsUsage = isDeepSeek ? (usage as UsageResult | null) : null;
  const mimoUsage = !isDeepSeek ? (usage as MimoUsageResult | null) : null;

  const days = isDeepSeek
    ? recentUsageDays(dsUsage?.days ?? [])
    : (mimoUsage?.days ?? []);
  const points = isDeepSeek
    ? days.map((day) => {
        const d = day as UsageDay;
        const hit = d.flashCacheHit + d.proCacheHit;
        const miss = d.flashCacheMiss + d.proCacheMiss;
        const response = d.flashResponse + d.proResponse;
        return { date: d.date, hit, miss, response, total: hit + miss + response };
      })
    : days.map((day) => {
        const d = day as MimoUsageDay;
        return { date: d.date, hit: 0, miss: 0, response: d.totalTokens, total: d.totalTokens };
      });
  const maxVal = Math.max(...points.map((point) => point.total), 1);
  const sumHit = points.reduce((sum, point) => sum + point.hit, 0);
  const sumMiss = points.reduce((sum, point) => sum + point.miss, 0);
  const sumTotal = points.reduce((sum, point) => sum + point.total, 0);
  const hitRate = sumHit + sumMiss > 0 ? ((sumHit / (sumHit + sumMiss)) * 100).toFixed(3) : "0";
  const placeholder =
    state === "loading"
      ? "查询中…"
      : state === "nokey"
        ? "未配置用量 Token"
        : state === "error"
          ? error
          : "暂无数据";

  return (
    <article className="card chart-card">
      <div className="card-title-row">
        <div className="caption-with-icon">
          <BarChart3 size={16} className="brand-blue" />
          <span>缓存命中明细</span>
        </div>
        <span className="chart-total">
          {state === "ok" ? `命中率 ${hitRate}% · 合计 ${fmtTokensShort(sumTotal)}` : "—"}
        </span>
      </div>
      {state === "ok" && points.length > 0 ? (
        <>
          <div className="bars" onMouseLeave={() => setHoveredIdx(null)}>
            {points.map((point, idx) => (
              <div className="bar-column" key={point.date}>
                {hoveredIdx === idx && point.total > 0 && (
                  <div
                    className={`bar-tooltip${
                      idx <= 1 ? " align-left" : idx >= points.length - 2 ? " align-right" : ""
                    }`}
                  >
                    <div className="bar-tooltip-head">
                      <span className="bar-tooltip-date">{point.date}</span>
                      <strong>{fmtInt(point.total)} tokens</strong>
                    </div>
                    {isDeepSeek && (
                      <>
                        <span className="bar-tooltip-row">
                          <i className="dot hit" />输入（命中缓存）
                          <strong>{fmtInt(point.hit)} tokens</strong>
                        </span>
                        <span className="bar-tooltip-row">
                          <i className="dot miss" />输入（未命中缓存）
                          <strong>{fmtInt(point.miss)} tokens</strong>
                        </span>
                        <span className="bar-tooltip-row">
                          <i className="dot response" />输出
                          <strong>{fmtInt(point.response)} tokens</strong>
                        </span>
                      </>
                    )}
                  </div>
                )}
                <span className="bar-value">
                  {point.total > 0 ? fmtTokensShort(point.total) : "0"}
                </span>
                <div className="bar-slot">
                  <div
                    className="cache-bar"
                    style={{
                      height: `${point.total > 0 ? Math.max(MIN_BAR, (point.total / maxVal) * 100) : MIN_BAR}%`,
                    }}
                    onMouseEnter={() => setHoveredIdx(idx)}
                    onMouseLeave={() => setHoveredIdx(null)}
                  >
                    {point.total > 0 ? (
                      <>
                        {isDeepSeek && point.hit > 0 && <i className="seg hit" style={{ flexGrow: point.hit }} />}
                        {isDeepSeek && point.miss > 0 && <i className="seg miss" style={{ flexGrow: point.miss }} />}
                        {point.response > 0 && (
                          <i className={`seg ${isDeepSeek ? "response" : "mimo-tokens"}`} style={{ flexGrow: point.response }} />
                        )}
                      </>
                    ) : (
                      <i className="seg empty" />
                    )}
                  </div>
                </div>
                <span className="bar-day">{mmdd(point.date)}</span>
              </div>
            ))}
          </div>
          <div className="chart-legend-bottom">
            {isDeepSeek && (
              <>
                <span className="chart-legend-item"><i className="dot hit" />命中</span>
                <span className="chart-legend-item"><i className="dot miss" />未命中</span>
              </>
            )}
            <span className="chart-legend-item"><i className={`dot ${isDeepSeek ? "response" : "mimo-tokens"}`} />{isDeepSeek ? "输出" : "Tokens"}</span>
          </div>
        </>
      ) : (
        <div className="chart-placeholder">{placeholder}</div>
      )}
    </article>
  );
}

function SettingsPanel({
  provider,
  onProviderChange,
  onBack,
  onUsageLoaded,
  onUsageCleared,
  onRefreshIntervalChanged,
  onAutoRefreshChanged,
}: {
  provider: Provider;
  onProviderChange: (p: Provider) => void;
  onBack: () => void;
  onUsageLoaded: (usage: UsageResult | MimoUsageResult) => void;
  onUsageCleared: () => void;
  onRefreshIntervalChanged: (seconds: number) => void;
  onAutoRefreshChanged: (enabled: boolean) => void;
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
  const configPath = config?.configPath ?? "%APPDATA%\\DeepSeekMonitorWindows\\config.json";

  React.useEffect(() => {
    void invoke<AppConfig>("get_app_config")
      .then((nextConfig) => {
        setConfig(nextConfig);
        setRefresh(nextConfig.refreshIntervalSeconds || 60);
        setAutoRefresh(nextConfig.autoRefreshEnabled);
        setAutostart(nextConfig.autostart);
        setStatus(nextConfig.apiKeyConfigured ? `已配置 ${nextConfig.apiKeyPreview}` : "未配置 API Key");
        setUsageStatus(nextConfig.usageTokenConfigured ? "用量 Token 已配置" : "未配置用量 Token");
      })
      .catch(() => {
        setStatus("浏览器预览模式，未连接本地配置");
      });
  }, []);

  React.useEffect(() => {
    void getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion("1.1.0"));
  }, []);

  const refreshUsageAfterToken = React.useCallback(
    (prefix: string) => {
      setUsageStatus(`${prefix}，正在刷新用量数据…`);
      return fetchCurrentUsage()
        .then((usage) => {
          onUsageLoaded(usage);
          setUsageStatus(`${prefix}，本月消费 ${fmtMoney(usage.monthCost)}`);
          return usage;
        })
        .catch((error) => {
          const message = typeof error === "string" ? error : "用量刷新失败";
          setUsageStatus(`${prefix}，但用量刷新失败：${message}`);
          throw error;
        });
    },
    [onUsageLoaded],
  );

  React.useEffect(() => {
    const unlistenPromise = listen<AppConfig>("usage-token-captured", (event) => {
      setConfig(event.payload);
      setUsageSyncing(false);
      void refreshUsageAfterToken("已通过网页登录自动同步用量 Token");
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [refreshUsageAfterToken]);

  React.useEffect(() => {
    const unlistenPromise = listen("usage-sync-ended", () => {
      setUsageSyncing(false);
      setUsageStatus("登录窗口已关闭，Token 未获取到。可重新点击同步或使用方式二手动粘贴。");
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const pasteApiKey = React.useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setApiKey(text.trim());
      setStatus("已从剪贴板读取");
    } catch {
      setStatus("剪贴板读取失败");
    }
  }, []);

  const saveApiKey = React.useCallback(() => {
    setBusy(true);
    void invoke<AppConfig>("save_api_key", { apiKey })
      .then((nextConfig) => {
        setConfig(nextConfig);
        setApiKey("");
        setStatus("已保存，正在验证 Key…");
        return invoke<BalanceData>("fetch_balance");
      })
      .then((balance) => {
        const symbol = balance.currency === "USD" ? "$" : "¥";
        const tip = balance.isAvailable ? "" : "（余额不足）";
        setStatus(`验证通过，当前余额 ${symbol}${balance.totalBalance}${tip}`);
      })
      .catch((error) => {
        setStatus(typeof error === "string" ? error : "保存或验证失败");
      })
      .finally(() => setBusy(false));
  }, [apiKey]);

  const clearApiKey = React.useCallback(() => {
    setBusy(true);
    void invoke<AppConfig>("clear_api_key")
      .then((nextConfig) => {
        setConfig(nextConfig);
        setApiKey("");
        setStatus("已清除 API Key");
      })
      .catch((error) => {
        setStatus(typeof error === "string" ? error : "清除失败");
      })
      .finally(() => setBusy(false));
  }, []);

  const pasteUsageToken = React.useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUsageToken(text.trim());
      setUsageStatus("已从剪贴板读取");
    } catch {
      setUsageStatus("剪贴板读取失败");
    }
  }, []);

  const startUsageSync = React.useCallback(() => {
    setUsageSyncing(true);
    setUsageStatus("正在打开登录窗口…");
    void invoke<boolean>("start_usage_sync")
      .then((synced) => {
        if (!synced) {
          setUsageStatus("登录完成后，再次点击本按钮即可同步用量（可多点几次）");
        }
        // synced=true 时由 usage-token-captured 事件刷新数据并更新状态
      })
      .catch((error) => {
        setUsageStatus(typeof error === "string" ? error : "打开登录窗口失败");
      })
      .finally(() => {
        // 短暂忙碌后自动恢复可点击，允许用户登录后反复点击触发同步
        window.setTimeout(() => setUsageSyncing(false), 2500);
      });
  }, []);

  const saveUsageToken = React.useCallback(() => {
    setBusy(true);
    void invoke<AppConfig>("save_usage_token", { usageToken })
      .then((nextConfig) => {
        setConfig(nextConfig);
        setUsageToken("");
        setUsageStatus("已保存，正在验证用量 Token…");
        return refreshUsageAfterToken("手动 Token 已保存");
      })
      .catch((error) => {
        setUsageStatus(typeof error === "string" ? error : "保存或验证失败");
      })
      .finally(() => setBusy(false));
  }, [refreshUsageAfterToken, usageToken]);

  const clearUsageToken = React.useCallback(() => {
    setBusy(true);
    void invoke<AppConfig>("clear_usage_token")
      .then((nextConfig) => {
        setConfig(nextConfig);
        setUsageToken("");
        setUsageStatus("已清除用量 Token");
        onUsageCleared();
      })
      .catch((error) => {
        setUsageStatus(typeof error === "string" ? error : "清除失败");
      })
      .finally(() => setBusy(false));
  }, [onUsageCleared]);

  const [mimoStatus, setMimoStatus] = React.useState("");
  const [mimoSyncing, setMimoSyncing] = React.useState(false);

  React.useEffect(() => {
    const unlistenStarted = listen("mimo-sync-started", () => {
      setMimoStatus("请在打开的窗口中登录小米账号，登录后保持窗口打开");
    });
    return () => {
      void unlistenStarted.then((fn) => fn());
    };
  }, []);

  const startMimoSync = React.useCallback(() => {
    setMimoSyncing(true);
    setMimoStatus("正在打开 MiMo 页面…");
    void invoke<boolean>("start_mimo_sync")
      .then((alreadyOpen) => {
        if (alreadyOpen) {
          setMimoStatus("登录窗口已打开，请确认已登录小米账号");
        } else {
          setMimoStatus("请在打开的窗口中登录小米账号，登录后保持窗口打开");
        }
        setMimoSyncing(false);
      })
      .catch((error) => {
        setMimoStatus(typeof error === "string" ? error : "启动同步失败");
        setMimoSyncing(false);
      });
  }, []);

  const saveRefreshInterval = React.useCallback(
    (seconds: number) => {
      const previous = refresh;
      setRefresh(seconds);
      onRefreshIntervalChanged(seconds);
      void invoke<AppConfig>("save_refresh_interval", { refreshIntervalSeconds: seconds })
        .then((nextConfig) => {
          setConfig(nextConfig);
          setRefresh(nextConfig.refreshIntervalSeconds || 60);
          onRefreshIntervalChanged(nextConfig.refreshIntervalSeconds || 60);
        })
        .catch(() => {
          setRefresh(previous);
          onRefreshIntervalChanged(previous);
        });
    },
    [onRefreshIntervalChanged, refresh],
  );

  const saveAutoRefreshEnabled = React.useCallback(
    (enabled: boolean) => {
      const previous = autoRefresh;
      setAutoRefresh(enabled);
      onAutoRefreshChanged(enabled);
      void invoke<AppConfig>("save_auto_refresh_enabled", { autoRefreshEnabled: enabled })
        .then((nextConfig) => {
          setConfig(nextConfig);
          setAutoRefresh(nextConfig.autoRefreshEnabled);
          onAutoRefreshChanged(nextConfig.autoRefreshEnabled);
        })
        .catch(() => {
          setAutoRefresh(previous);
          onAutoRefreshChanged(previous);
        });
    },
    [autoRefresh, onAutoRefreshChanged],
  );

  const saveAutostart = React.useCallback((enabled: boolean) => {
    const previous = autostart;
    setAutostart(enabled);
    void invoke<AppConfig>("save_autostart", { autostart: enabled })
      .then((nextConfig) => {
        setConfig(nextConfig);
        setAutostart(nextConfig.autostart);
      })
      .catch(() => setAutostart(previous));
  }, [autostart]);

  return (
    <section className="settings-panel" data-testid="settings-panel">
      <button className="floating-close settings-close" onClick={onBack} aria-label="返回主面板">
        <X size={20} />
      </button>
      <div className="settings-inner">
        <header className="settings-header" data-tauri-drag-region>
          <ProviderSelect provider={provider} onChange={onProviderChange} />
          <div>
            <p>设置</p>
          </div>
        </header>

        <SettingsSection icon={<KeyRound size={15} />} title="API Key">
          <p>用于调用 DeepSeek API 获取余额和用量数据。当前 Windows 版本会保存在应用本地设置中。</p>
          <p className="muted">API Key 只在当前这台 Windows 电脑本地保留。</p>
          <p className="muted config-path">
            <span>本地位置：</span>
            <span>{configPath}</span>
          </p>
          <div className="key-row">
            <input
              aria-label="API Key"
              type="password"
              value={apiKey}
              placeholder={config?.apiKeyConfigured ? "••••••••••••••••••••••••••••••••••••••••••••••••••" : "sk-..."}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </div>
          <div className="settings-actions">
            <button className="primary" onClick={saveApiKey} disabled={busy || !apiKey.trim()}>
              验证并保存
            </button>
            <span className={config?.apiKeyConfigured ? "configured" : "configured muted-status"}>
              <CheckCircle2 size={17} />
              {config?.apiKeyConfigured ? "已配置" : "未配置"}
            </span>
            <button className="secondary" onClick={clearApiKey} disabled={busy || !config?.apiKeyConfigured}>
              清除 Key
            </button>
          </div>
        </SettingsSection>

        {provider === "deepseek" ? (
          <SettingsSection icon={<BarChart3 size={15} />} title="用量同步 Token">
            <p>用于同步 Token 用量、消费和趋势图。DeepSeek 无官方用量 API，需网页登录 token（与上面的 API Key 不同）。</p>
            <p className="muted">方式一网页登录自动同步</p>
            <div className="settings-actions usage-sync-actions">
              <button className="primary" onClick={startUsageSync} disabled={usageSyncing}>
                {usageSyncing ? "等待登录" : "网页登录自动同步"}
              </button>
              <span className={config?.usageTokenConfigured ? "configured" : "configured muted-status"}>
                <CheckCircle2 size={17} />
                {config?.usageTokenConfigured ? "已配置" : "未配置"}
              </span>
              <button className="secondary" onClick={clearUsageToken} disabled={busy || !config?.usageTokenConfigured}>
                清除 Token
              </button>
            </div>
            <p className="muted">{usageStatus}</p>
            <button
              className="link-button"
              onClick={() => setShowManualPaste((value) => !value)}
            >
              {showManualPaste ? "收起手动粘贴" : "方式二：手动粘贴 token"}
            </button>
            {showManualPaste && (
              <>
                <p className="muted">
                  获取：浏览器登录 platform.deepseek.com，按 F12 打开控制台，输入
                  JSON.parse(localStorage.userToken).value 回车，复制返回的字符串。
                </p>
                <p className="muted">token 会过期，用量查询失败时重新获取一次即可。</p>
                <div className="key-row">
                  <input
                    aria-label="用量 Token"
                    type="password"
                    value={usageToken}
                    placeholder={config?.usageTokenConfigured ? "••••••••••••••••••••••••••••••••••••••••••••••••••" : ""}
                    onChange={(event) => setUsageToken(event.target.value)}
                  />
                </div>
                <div className="settings-actions">
                  <button className="primary" onClick={saveUsageToken} disabled={busy || !usageToken.trim()}>
                    保存 Token
                  </button>
                </div>
              </>
            )}
          </SettingsSection>
        ) : (
          <SettingsSection icon={<BarChart3 size={15} />} title="MiMo 用量同步">
            <p>登录 MiMo 平台后，通过网页代理获取 Token 用量和消费数据。无需手动提取 Cookie。</p>
            <p className="muted">网页登录（需保持窗口打开）</p>
            <div className="settings-actions usage-sync-actions">
              <button className="primary" onClick={startMimoSync} disabled={mimoSyncing}>
                {mimoSyncing ? "打开中…" : "打开 MiMo 登录页"}
              </button>
            </div>
            <p className="muted">{mimoStatus || "点击上方按钮打开 MiMo 平台，登录后保持窗口打开即可使用"}</p>
          </SettingsSection>
        )}

        <SettingsSection icon={<Power size={15} />} title="开机自启">
          <p>开启后，每次登录 Windows 时自动启动 DeepSeek Monitor。</p>
          <Toggle label="登录时自动启动" checked={autostart} onChange={saveAutostart} />
        </SettingsSection>

        <SettingsSection icon={<RefreshCw size={15} />} title="自动刷新">
          <p>开启后，按设定周期自动从 DeepSeek API 拉取最新数据。</p>
          <Toggle label="启用自动刷新" checked={autoRefresh} onChange={saveAutoRefreshEnabled} />
          {autoRefresh && (
            <div className="segmented">
              {refreshOptions.map((option) => (
                <button
                  key={option.value}
                  className={refresh === option.value ? "selected" : ""}
                  onClick={() => saveRefreshInterval(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </SettingsSection>

        <SettingsSection icon={<Info size={15} />} title="关于">
          <div className="version-row">
            <span>当前版本</span>
            <strong>v{appVersion}</strong>
          </div>
        </SettingsSection>

      </div>
    </section>
  );
}

function SettingsSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-section">
      <h2>
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i />
    </label>
  );
}

function ModelDetailPanel({
  model,
  usage,
  usageState,
  onBack,
  provider,
}: {
  model: ModelName;
  usage: UsageResult | MimoUsageResult | null;
  usageState: BalanceState;
  onBack: () => void;
  provider: Provider;
}) {
  const isDeepSeek = provider === "deepseek";
  const isFlash = model === "flash";
  const mimoUsage = !isDeepSeek ? (usage as MimoUsageResult | null) : null;
  const dsUsage = isDeepSeek ? (usage as UsageResult | null) : null;

  let title: string;
  let tintClass: string;
  let cost: string;
  let totalText: string;

  if (isDeepSeek) {
    const data = dsUsage?.models.find((item) => item.key === model) ?? null;
    title = isFlash ? "V4 Flash" : "V4 Pro";
    tintClass = isFlash ? "flash" : "pro";
    cost = data ? fmtMoney(data.cost) : "—";
    totalText = data ? fmtTokensShort(data.totalTokens) : "—";
  } else {
    title = modelDisplayName(model);
    tintClass = modelIcon(model);
    const modelData = mimoUsage?.models.find((m) => m.key === model);
    cost = modelData ? fmtMoney(modelData.cost) : "—";
    totalText = modelData ? fmtTokensShort(modelData.totalTokens) : "—";
  }

  const days = isDeepSeek
    ? recentUsageDays(dsUsage?.days ?? [])
    : (mimoUsage?.days ?? []);
  const points = isDeepSeek
    ? days.map((day) => {
        const d = day as UsageDay;
        const hit = isFlash ? d.flashCacheHit : d.proCacheHit;
        const miss = isFlash ? d.flashCacheMiss : d.proCacheMiss;
        const response = isFlash ? d.flashResponse : d.proResponse;
        return { date: d.date, hit, miss, response, total: hit + miss + response };
      })
    : days.map((day) => {
        const d = day as MimoUsageDay;
        const key = model;
        const modelDay = d.models.find((m) => m.key === key);
        const tokens = modelDay?.totalTokens ?? 0;
        return { date: d.date, hit: 0, miss: 0, response: tokens, total: tokens };
      });
  const maxVal = Math.max(...points.map((point) => point.total), 1);
  const rangeText =
    points.length > 0 ? `${mmdd(points[0].date)} - ${mmdd(points[points.length - 1].date)}` : "";

  const detailModelData = isDeepSeek ? (dsUsage?.models.find((item) => item.key === model) ?? null) : (mimoUsage?.models.find((m) => m.key === model) ?? null);

  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null);
  const MIN_BAR = 3; // 整根柱子的最小可见高度百分比（含空数据占位）

  return (
    <section className="panel detail-panel" data-testid="detail-panel">
      <button className="floating-close" onClick={onBack} aria-label="返回主面板">
        <X size={20} />
      </button>
      <article className="card detail-hero" data-tauri-drag-region>
        <div className={`model-badge large ${tintClass}`}>
          {isDeepSeek ? (isFlash ? <Zap size={34} fill="currentColor" /> : <Brain size={33} />) : <Zap size={34} fill="currentColor" />}
        </div>
        <div>
          <h1>{title}</h1>
          <p>{cost}</p>
        </div>
      </article>

      <div className="detail-metrics">
        <article className="card metric-card">
          <span>API 请求次数</span>
          <strong className={tintClass}>{detailModelData ? fmtInt(detailModelData.requestCount) : "—"}</strong>
        </article>
        <article className="card metric-card">
          <span>Tokens</span>
          <strong className={tintClass}>{totalText}</strong>
        </article>
      </div>

      <article className="card detail-chart">
        <div className="detail-chart-head">
          <div>
            <h2>按日 Token 消耗</h2>
            <span>{rangeText}</span>
          </div>
        </div>
        {usageState === "ok" && points.length > 0 ? (
          <>
            <div className="detail-bars" onMouseLeave={() => setHoveredIdx(null)}>
              {points.map((point, idx) => (
                <div className="detail-bar-column" key={point.date}>
                  {hoveredIdx === idx && point.total > 0 && (
                    <div
                      className={`bar-tooltip${
                        idx <= 1 ? " align-left" : idx >= points.length - 2 ? " align-right" : ""
                      }`}
                    >
                      <div className="bar-tooltip-head">
                        <span className="bar-tooltip-date">{point.date}</span>
                        <strong>{fmtInt(point.total)} tokens</strong>
                      </div>
                      {isDeepSeek && (
                        <>
                          <span className="bar-tooltip-row">
                            <i className="dot hit" />输入（命中缓存）
                            <strong>{fmtInt(point.hit)} tokens</strong>
                          </span>
                          <span className="bar-tooltip-row">
                            <i className="dot miss" />输入（未命中缓存）
                            <strong>{fmtInt(point.miss)} tokens</strong>
                          </span>
                        </>
                      )}
                      <span className="bar-tooltip-row">
                        <i className={`dot ${isDeepSeek ? "response" : "mimo-tokens"}`} />{isDeepSeek ? "输出" : "Tokens"}
                        <strong>{fmtInt(point.response)} tokens</strong>
                      </span>
                    </div>
                  )}
                  <span>{point.total > 0 ? fmtTokensShort(point.total) : ""}</span>
                  <div className="detail-bar-slot">
                    {/* 柱高按当天合计占最大值的比例；内部三段用 flex-grow 按真实 token 数分配，比例精确且永不溢出裁剪 */}
                    <div
                      className="detail-bar-stacked"
                      style={{
                        height: `${point.total > 0 ? Math.max(MIN_BAR, (point.total / maxVal) * 100) : MIN_BAR}%`,
                      }}
                      onMouseEnter={() => setHoveredIdx(idx)}
                      onMouseLeave={() => setHoveredIdx(null)}
                    >
                      {point.total > 0 ? (
                        <>
                          {isDeepSeek && point.hit > 0 && <i className="seg hit" style={{ flexGrow: point.hit }} />}
                          {isDeepSeek && point.miss > 0 && <i className="seg miss" style={{ flexGrow: point.miss }} />}
                          {point.response > 0 && <i className={`seg ${isDeepSeek ? "response" : "mimo-tokens"}`} style={{ flexGrow: point.response }} />}
                        </>
                      ) : (
                        <i className="seg empty" />
                      )}
                    </div>
                  </div>
                  <em>{mmdd(point.date)}</em>
                </div>
              ))}
            </div>
            <div className="chart-legend-bottom">
              {isDeepSeek && (
                <>
                  <span className="chart-legend-item"><i className="dot hit" />命中</span>
                  <span className="chart-legend-item"><i className="dot miss" />未命中</span>
                </>
              )}
              <span className="chart-legend-item"><i className={`dot ${isDeepSeek ? "response" : "mimo-tokens"}`} />{isDeepSeek ? "输出" : "Tokens"}</span>
            </div>
          </>
        ) : (
          <div className="chart-placeholder">
            {usageState === "nokey" ? "未配置用量 Token" : usageState === "loading" ? "查询中…" : "暂无数据"}
          </div>
        )}
      </article>
    </section>
  );
}

// Apply the saved theme before first render to avoid a flash of the wrong skin.
document.documentElement.setAttribute("data-theme", localStorage.getItem("ui-theme") || "dark");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
