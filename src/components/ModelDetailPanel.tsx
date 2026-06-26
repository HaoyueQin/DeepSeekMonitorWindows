import React from "react";
import { Brain, X, Zap } from "lucide-react";
import type { ModelName, BalanceState, UsageResult, MimoUsageResult, Provider } from "../types";
import { fmtInt, fmtTokensShort, fmtMoney, mmdd, addDays, dateKey, modelDisplayName, modelIcon } from "../utils";

// ─── ModelDetailPanel ──────────────────────────────────────
export function ModelDetailPanel({ model, usage, usageState, onBack, provider }: {
  model: ModelName; usage: UsageResult | MimoUsageResult | null;
  usageState: BalanceState; onBack: () => void; provider: Provider;
}) {
  const isDeepSeek = provider === "deepseek";
  const isFlash = model === "flash";
  const mimoUsage = !isDeepSeek ? (usage as MimoUsageResult | null) : null;
  const dsUsage = isDeepSeek ? (usage as UsageResult | null) : null;

  let title: string; let tintClass: string; let cost: string; let totalText: string;
  if (isDeepSeek) {
    const data = dsUsage?.models.find((i) => i.key === model) ?? null;
    title = isFlash ? "V4 Flash" : "V4 Pro";
    tintClass = isFlash ? "flash" : "pro";
    cost = data ? fmtMoney(data.cost) : "—";
    totalText = data ? fmtTokensShort(data.totalTokens) : "—";
  } else {
    title = modelDisplayName(model);
    tintClass = modelIcon(model);
    const md = mimoUsage?.models.find((m) => m.key === model);
    cost = md ? fmtMoney(md.cost) : "—";
    totalText = md ? fmtTokensShort(md.totalTokens) : "—";
  }

  const detailModelData = isDeepSeek
    ? (dsUsage?.models.find((i) => i.key === model) ?? null)
    : (mimoUsage?.models.find((m) => m.key === model) ?? null);

  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null);
  const [weekOffset, setWeekOffset] = React.useState(0);
  const MIN_BAR = 3;
  const DAYS_PER_WEEK = 7;

  const today = new Date();
  const weekStart = addDays(today, weekOffset * DAYS_PER_WEEK - DAYS_PER_WEEK + 1);
  const dayKeys = Array.from({ length: DAYS_PER_WEEK }, (_, i) => dateKey(addDays(weekStart, i)));

  const dsMap = new Map((dsUsage?.days ?? []).map((d) => [d.date, d]));
  const mimoMap = new Map((mimoUsage?.days ?? []).map((d) => [d.date, d]));

  const points = dayKeys.map((date) => {
    if (isDeepSeek) {
      const d = dsMap.get(date);
      if (!d) return { date, hit: 0, miss: 0, response: 0, total: 0 };
      const hit = isFlash ? d.flashCacheHit : d.proCacheHit;
      const miss = isFlash ? d.flashCacheMiss : d.proCacheMiss;
      const response = isFlash ? d.flashResponse : d.proResponse;
      return { date, hit, miss, response, total: hit + miss + response };
    } else {
      const d = mimoMap.get(date);
      if (!d) return { date, hit: 0, miss: 0, response: 0, total: 0 };
      const md = d.models.find((m) => m.key === model);
      return {
        date,
        hit: md?.cacheHitTokens ?? 0,
        miss: md?.cacheMissTokens ?? 0,
        response: md?.responseTokens ?? 0,
        total: md?.totalTokens ?? 0,
      };
    }
  });

  const maxVal = Math.max(...points.map((p) => p.total), 1);
  const rangeText = `${mmdd(points[0]?.date ?? "")} - ${mmdd(points[points.length - 1]?.date ?? "")}`;
  const canGoForward = weekOffset < 0;
  const weekLabel = weekOffset === 0 ? "本周" : weekOffset === -1 ? "上周" : `${-weekOffset}周前`;

  return (
    <section className="panel detail-panel" data-testid="detail-panel">
      <button className="floating-close" onClick={onBack} aria-label="返回主面板"><X size={20} /></button>
      <article className="card detail-hero" data-tauri-drag-region>
        <div className={`model-badge large ${tintClass}`}>
          {isDeepSeek ? (isFlash ? <Zap size={34} fill="currentColor" /> : <Brain size={33} />) : <Zap size={34} fill="currentColor" />}
        </div>
        <div><h1>{title}</h1><p>{cost}</p></div>
      </article>
      <div className="detail-metrics">
        <article className="card metric-card"><span>API 请求次数</span><strong className={tintClass}>{detailModelData ? fmtInt(detailModelData.requestCount) : "—"}</strong></article>
        <article className="card metric-card"><span>Tokens</span><strong className={tintClass}>{totalText}</strong></article>
      </div>
      <article className="card detail-chart">
        <div className="detail-chart-head">
          <div><h2>按日 Token 消耗</h2><span>{rangeText}</span></div>
          <div className="chart-nav">
            <button className="chart-nav-btn" onClick={() => setWeekOffset((o) => o - 1)} title="上一周">‹</button>
            <span className="chart-nav-label">{weekLabel}</span>
            <button className="chart-nav-btn" onClick={() => setWeekOffset((o) => o + 1)} disabled={!canGoForward} title="下一周">›</button>
          </div>
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
                      {point.total > 0 ? (
                        <>
                          {point.hit > 0 && <i className="seg hit" style={{ flexGrow: point.hit }} />}
                          {point.miss > 0 && <i className="seg miss" style={{ flexGrow: point.miss }} />}
                          {point.response > 0 && <i className="seg response" style={{ flexGrow: point.response }} />}
                        </>
                      ) : <i className="seg empty" />}
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
        ) : (
          <div className="chart-placeholder">
            {usageState === "nokey" ? "未配置用量 Token" : usageState === "loading" ? "查询中…" : "暂无数据"}
          </div>
        )}
      </article>
    </section>
  );
}
