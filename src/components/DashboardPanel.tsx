import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { BarChart3, Brain, CalendarDays, CreditCard, Settings, Shirt, SunMedium, X, Zap, RefreshCw } from "lucide-react";
import type { Provider, BalanceData, MimoBalanceData, BalanceState, UsageResult, MimoUsageResult, MimoUsageModel, UsageModel } from "../types";
import { fmtInt, fmtTokensShort, fmtMoney, mmdd, todayStr, dateKey, addDays, modelDisplayName, modelIcon } from "../utils";

// ─── BalanceCard ───────────────────────────────────────────
export function BalanceCard({ balance, state, error, todayCost, monthCost, provider }: {
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
    state === "loading" ? "查询中…"
    : state === "nokey" ? "未配置"
    : state === "error" ? "查询失败"
    : isDeepSeek ? `${symbol}${dsBalance?.totalBalance ?? "0.00"}`
    : `${symbol}${mimoBalance?.availableBalance ?? "0.00"}`;
  const statusText = state === "ok" ? (isDeepSeek && dsBalance?.isAvailable === false ? "余额不足" : "可用") : "—";
  const statusOff = state === "ok" && isDeepSeek && dsBalance != null && !dsBalance.isAvailable;

  return (
    <article className="card balance-card">
      <div className="card-title-row">
        <div className="caption-with-icon"><CreditCard size={15} /><span>账户余额</span></div>
        <div className={`status-pill ${statusOff ? "off" : ""}`}><span />{statusText}</div>
      </div>
      <div className={`balance-amount ${state !== "ok" ? "balance-dim" : ""}`}>{amount}</div>
      {state === "error" && <div className="balance-error">{error}</div>}
      <div className="metric-grid">
        <div className="mini-card">
          <div className="caption-with-icon orange"><SunMedium size={15} /><span>当日消耗</span></div>
          <strong>{todayCost != null ? fmtMoney(todayCost) : "—"}</strong>
        </div>
        <div className="mini-card">
          <div className="caption-with-icon orange"><CalendarDays size={15} /><span>本月消费</span></div>
          <strong>{monthCost != null ? fmtMoney(monthCost) : "—"}</strong>
        </div>
      </div>
    </article>
  );
}

// ─── UsageRow ──────────────────────────────────────────────
export function UsageRow({ modelKey, data, maxTokens, state, onClick, modelDisplay }: {
  modelKey: string;
  data: UsageModel | null;
  maxTokens: number;
  state: BalanceState;
  onClick: () => void;
  modelDisplay?: string;
}) {
  const isFlash = modelKey === "flash";
  const name = modelDisplay ?? (isFlash ? "V4 Flash" : "V4 Pro");
  const tokensText = data ? `${fmtInt(data.totalTokens)} Tokens`
    : state === "loading" ? "查询中…"
    : state === "nokey" ? "未配置 Token"
    : state === "error" ? "用量不可用" : "—";
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
          <div className="progress-track"><i className={isFlash ? "flash-fill" : "pro-fill"} style={{ width }} /></div>
        </div>
        {data && data.cacheHitTokens + data.cacheMissTokens > 0 && (
          <span className={`cache-hit-rate ${isFlash ? "flash" : "pro"}`}>
            缓存命中 {((data.cacheHitTokens / (data.cacheHitTokens + data.cacheMissTokens)) * 100).toFixed(3)}%
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

// ─── UsageChart ────────────────────────────────────────────
export function UsageChart({ usage, state, error, provider }: {
  usage: UsageResult | MimoUsageResult | null;
  state: BalanceState;
  error: string;
  provider: Provider;
}) {
  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null);
  const [weekOffset, setWeekOffset] = React.useState(0);
  const MIN_BAR = 3;
  const DAYS_PER_WEEK = 7;

  const isDeepSeek = provider === "deepseek";
  const dsUsage = isDeepSeek ? (usage as UsageResult | null) : null;
  const mimoUsage = !isDeepSeek ? (usage as MimoUsageResult | null) : null;

  const today = new Date();
  const weekStart = addDays(today, weekOffset * DAYS_PER_WEEK - DAYS_PER_WEEK + 1);
  const days = Array.from({ length: DAYS_PER_WEEK }, (_, i) => dateKey(addDays(weekStart, i)));
  const dsMap = new Map((dsUsage?.days ?? []).map((d) => [d.date, d]));
  const mimoMap = new Map((mimoUsage?.days ?? []).map((d) => [d.date, d]));

  const points = days.map((date) => {
    if (isDeepSeek) {
      const d = dsMap.get(date);
      if (!d) return { date, hit: 0, miss: 0, response: 0, total: 0 };
      const hit = d.flashCacheHit + d.proCacheHit;
      const miss = d.flashCacheMiss + d.proCacheMiss;
      const response = d.flashResponse + d.proResponse;
      return { date, hit, miss, response, total: hit + miss + response };
    } else {
      const d = mimoMap.get(date);
      if (!d) return { date, hit: 0, miss: 0, response: 0, total: 0 };
      const hit = d.models.reduce((s, m) => s + m.cacheHitTokens, 0);
      const miss = d.models.reduce((s, m) => s + m.cacheMissTokens, 0);
      const response = d.models.reduce((s, m) => s + m.responseTokens, 0);
      return { date, hit, miss, response, total: hit + miss + response };
    }
  });

  const maxVal = Math.max(...points.map((p) => p.total), 1);
  const sumHit = points.reduce((s, p) => s + p.hit, 0);
  const sumMiss = points.reduce((s, p) => s + p.miss, 0);
  const sumTotal = points.reduce((s, p) => s + p.total, 0);
  const hitRate = sumHit + sumMiss > 0 ? ((sumHit / (sumHit + sumMiss)) * 100).toFixed(3) : "0";
  const canGoForward = weekOffset < 0;
  const weekLabel = weekOffset === 0 ? "本周" : weekOffset === -1 ? "上周" : `${-weekOffset}周前`;
  const placeholder = state === "loading" ? "查询中…" : state === "nokey" ? "未配置用量 Token" : state === "error" ? error : "暂无数据";

  return (
    <article className="card chart-card">
      <div className="card-title-row">
        <div className="caption-with-icon"><BarChart3 size={16} className="brand-blue" /><span>缓存命中明细</span></div>
        <div className="chart-nav">
          <button className="chart-nav-btn" onClick={() => setWeekOffset((o) => o - 1)} title="上一周">‹</button>
          <span className="chart-nav-label">{weekLabel}</span>
          <button className="chart-nav-btn" onClick={() => setWeekOffset((o) => o + 1)} disabled={!canGoForward} title="下一周">›</button>
        </div>
        <span className="chart-total">{state === "ok" ? `命中率 ${hitRate}% · 合计 ${fmtTokensShort(sumTotal)}` : "—"}</span>
      </div>
      {state === "ok" && points.length > 0 ? (
        <>
          <div className="bars" onMouseLeave={() => setHoveredIdx(null)}>
            {points.map((point, idx) => (
              <div className="bar-column" key={point.date} onMouseEnter={() => setHoveredIdx(idx)}>
                {hoveredIdx === idx && (
                  <div className={`bar-tooltip${idx <= 1 ? " align-left" : idx >= points.length - 2 ? " align-right" : ""}`}>
                    <div className="bar-tooltip-head"><span className="bar-tooltip-date">{point.date}</span><strong>{fmtInt(point.total)} tokens</strong></div>
                    <span className="bar-tooltip-row"><i className="dot hit" />输入（命中缓存）<strong>{fmtInt(point.hit)} tokens</strong></span>
                    <span className="bar-tooltip-row"><i className="dot miss" />输入（未命中缓存）<strong>{fmtInt(point.miss)} tokens</strong></span>
                    <span className="bar-tooltip-row"><i className="dot response" />输出<strong>{fmtInt(point.response)} tokens</strong></span>
                  </div>
                )}
                <span className="bar-value">{point.total > 0 ? fmtTokensShort(point.total) : "0"}</span>
                <div className="bar-slot">
                  <div className="cache-bar" style={{ height: `${point.total > 0 ? Math.max(MIN_BAR, (point.total / maxVal) * 100) : MIN_BAR}%` }}>
                    {point.total > 0 ? (
                      <>
                        {point.hit > 0 && <i className="seg hit" style={{ flexGrow: point.hit }} />}
                        {point.miss > 0 && <i className="seg miss" style={{ flexGrow: point.miss }} />}
                        {point.response > 0 && <i className="seg response" style={{ flexGrow: point.response }} />}
                      </>
                    ) : <i className="seg empty" />}
                  </div>
                </div>
                <span className="bar-day">{mmdd(point.date)}</span>
              </div>
            ))}
          </div>
          <div className="chart-legend-bottom">
            <span className="chart-legend-item"><i className="dot hit" />命中</span>
            <span className="chart-legend-item"><i className="dot miss" />未命中</span>
            <span className="chart-legend-item"><i className="dot response" />输出</span>
          </div>
        </>
      ) : <div className="chart-placeholder">{placeholder}</div>}
    </article>
  );
}

// ─── DashboardPanel ────────────────────────────────────────
export function DashboardPanel({ provider, onProviderChange, balance, balanceState, balanceError, usage, usageState, usageError, onRefresh, onClose, onSettings, onDetail }: {
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
  onDetail: (model: string) => void;
}) {
  const [theme, setTheme] = React.useState<string>(() => localStorage.getItem("ui-theme") || "light");
  const toggleTheme = () => { const next = theme === "dark" ? "light" : "dark"; setTheme(next); localStorage.setItem("ui-theme", next); document.documentElement.setAttribute("data-theme", next); };
  // 首次加载时设置 data-theme 属性，确保 CSS 主题生效
  React.useEffect(() => { document.documentElement.setAttribute("data-theme", theme); }, [theme]);

  const isDeepSeek = provider === "deepseek";
  const dsUsage = isDeepSeek ? (usage as UsageResult | null) : null;
  const mimoUsage = !isDeepSeek ? (usage as MimoUsageResult | null) : null;
  const flash = dsUsage?.models.find((item) => item.key === "flash") ?? null;
  const pro = dsUsage?.models.find((item) => item.key === "pro") ?? null;
  const maxTokens = Math.max(flash?.totalTokens ?? 0, pro?.totalTokens ?? 0, ...(mimoUsage?.models.map((m) => m.totalTokens) ?? []), 1);
  const today = dsUsage?.days.find((day) => day.date === todayStr()) ?? null;
  const mimoToday = mimoUsage?.days.find((day) => day.date === todayStr()) ?? null;
  const todayCost = usageState === "ok" ? (today ? today.totalCost : mimoToday ? mimoToday.totalCost : null) : null;
  const monthCost = usageState === "ok" && usage ? usage.monthCost : null;
  const mimoDefaultModels: MimoUsageModel[] = [
    { key: "mimo-v2.5", name: "MiMo-V2.5", totalTokens: 0, requestCount: 0, cacheHitTokens: 0, cacheMissTokens: 0, responseTokens: 0, cost: 0 },
    { key: "mimo-v2.5-pro", name: "MiMo-V2.5-Pro", totalTokens: 0, requestCount: 0, cacheHitTokens: 0, cacheMissTokens: 0, responseTokens: 0, cost: 0 },
  ];
  const topModels = mimoUsage ? mimoDefaultModels.map((def) => mimoUsage.models.find((m) => m.key === def.key) ?? def) : mimoDefaultModels;

  return (
    <section className="panel dashboard-panel" data-testid="dashboard-panel">
      <header className="panel-header" data-tauri-drag-region>
        <div className="title-lockup" data-tauri-drag-region>
          <ProviderSelect provider={provider} onChange={onProviderChange} />
        </div>
        <div className="header-actions">
          <button aria-label="刷新" onClick={onRefresh}><RefreshCw size={22} /></button>
          <div className="skin-menu-wrap">
            <button aria-label="Toggle theme" className="skin-toggle" title={theme === "dark" ? "Switch to light" : "Switch to dark"} onClick={toggleTheme}><Shirt size={21} /></button>
          </div>
          <button aria-label="设置" onClick={onSettings}><Settings size={23} /></button>
          <button aria-label="关闭" onClick={onClose}><X size={25} /></button>
        </div>
      </header>
      <BalanceCard balance={balance} state={balanceState} error={balanceError} todayCost={todayCost} monthCost={monthCost} provider={provider} />
      <div className="usage-stack">
        {isDeepSeek ? (
          <>
            <UsageRow modelKey="flash" data={flash ? { ...flash, key: "flash" } : null} maxTokens={maxTokens} state={usageState} onClick={() => onDetail("flash")} />
            <UsageRow modelKey="pro" data={pro ? { ...pro, key: "pro" } : null} maxTokens={maxTokens} state={usageState} onClick={() => onDetail("pro")} />
          </>
        ) : topModels.map((m) => (
          <UsageRow key={m.key} modelKey={modelIcon(m.key)} data={{ ...m, key: modelIcon(m.key) }} maxTokens={maxTokens} state={usageState} onClick={() => onDetail(m.key)} modelDisplay={modelDisplayName(m.key)} />
        ))}
      </div>
      <UsageChart usage={usage} state={usageState} error={usageError} provider={provider} />
    </section>
  );
}

// ─── ProviderSelect ────────────────────────────────────────
function ProviderSelect({ provider, onChange }: { provider: Provider; onChange: (p: Provider) => void }) {
  return (
    <button className="provider-toggle" onClick={() => onChange(provider === "deepseek" ? "mimo" : "deepseek")}>
      {provider === "deepseek" ? "DeepSeek Monitor" : "MiMo Monitor"}
    </button>
  );
}
