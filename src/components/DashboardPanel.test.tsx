import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardPanel } from "./DashboardPanel";
import type { BalanceData, UsageResult, MimoUsageResult } from "../types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({}),
}));

const balance: BalanceData = {
  isAvailable: true,
  currency: "CNY",
  totalBalance: "88.66",
  grantedBalance: "0",
  toppedUpBalance: "88.66",
};

const usage: UsageResult = {
  monthCost: 12.34,
  models: [
    { key: "flash", name: "V4 Flash", totalTokens: 1000000, requestCount: 10, cacheHitTokens: 600000, cacheMissTokens: 200000, responseTokens: 200000, cost: 1.23 },
    { key: "pro", name: "V4 Pro", totalTokens: 500000, requestCount: 5, cacheHitTokens: 300000, cacheMissTokens: 100000, responseTokens: 100000, cost: 4.56 },
  ],
  days: [
    { date: "2026-06-01", flashTokens: 1000, flashCacheHit: 600, flashCacheMiss: 200, flashResponse: 200, proTokens: 500, proCacheHit: 300, proCacheMiss: 100, proResponse: 100, totalTokens: 1500, totalCost: 0.12 },
  ],
};

const defaultProps = {
  provider: "deepseek" as const,
  onProviderChange: vi.fn(),
  balance,
  balanceState: "ok" as const,
  balanceError: "",
  usage,
  usageState: "ok" as const,
  usageError: "",
  onRefresh: vi.fn(),
  onClose: vi.fn(),
  onSettings: vi.fn(),
  onDetail: vi.fn(),
  currency: "cny" as const,
  exchangeRate: 0.137,
  efficiencyUnit: "currency_per_token" as const,
  balanceHistory: [],
};

describe("DashboardPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.setAttribute("data-theme", "light");
  });

  it("renders balance, model rows and chart", () => {
    render(<DashboardPanel {...defaultProps} />);
    expect(screen.getByText("账户余额")).toBeInTheDocument();
    expect(screen.getByText("¥88.66")).toBeInTheDocument();
    expect(screen.getByText("V4 Flash")).toBeInTheDocument();
    expect(screen.getByText("V4 Pro")).toBeInTheDocument();
    expect(screen.getByText("缓存命中明细")).toBeInTheDocument();
    // 余额走势卡片（无历史数据时显示占位）
    expect(screen.getByText("余额走势")).toBeInTheDocument();
    expect(screen.getByText("暂无余额历史数据")).toBeInTheDocument();
  });

  it("renders loading states", () => {
    render(
      <DashboardPanel
        {...defaultProps}
        balance={null}
        balanceState="loading"
        usage={null}
        usageState="loading"
      />
    );
    expect(screen.getAllByText("查询中…").length).toBeGreaterThan(0);
  });

  it("renders MiMo models when provider is mimo", () => {
    const mimoUsage: MimoUsageResult = {
      monthCost: 0,
      models: [{ key: "mimo-v2.5", name: "MiMo-V2.5", totalTokens: 10, requestCount: 1, cacheHitTokens: 5, cacheMissTokens: 5, responseTokens: 0, cost: 0.01 }],
      days: [],
    };
    render(
      <DashboardPanel
        {...defaultProps}
        provider="mimo"
        usage={mimoUsage}
        usageState="ok"
        balance={{ availableBalance: "10.00", currency: "CNY", totalConsumption: "1", monthlyExpense: "0.5" }}
      />
    );
    expect(screen.getByText("MiMo Monitor")).toBeInTheDocument();
    expect(screen.getByText("V2.5")).toBeInTheDocument();
    expect(screen.getByText("V2.5 Pro")).toBeInTheDocument();
    expect(screen.getByText("¥10.00")).toBeInTheDocument();
  });

  it("switches provider on toggle click", async () => {
    const user = userEvent.setup();
    render(<DashboardPanel {...defaultProps} />);
    // ProviderSelect 按钮包含 "DeepSeek Monitor" 与 ⇄ 箭头
    const toggle = screen.getByRole("button", { name: (n) => n.includes("DeepSeek Monitor") && n.includes("⇄") });
    await user.click(toggle);
    expect(defaultProps.onProviderChange).toHaveBeenCalledWith("mimo");
  });

  it("shows balance history chart when history exists", () => {
    const today = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const d1 = new Date(today); d1.setDate(today.getDate() - 2);
    const d2 = new Date(today); d2.setDate(today.getDate() - 1);
    render(
      <DashboardPanel
        {...defaultProps}
        balanceHistory={[
          { provider: "deepseek", date: iso(d1), balance: 100, currency: "CNY" },
          { provider: "deepseek", date: iso(d2), balance: 99, currency: "CNY" },
          { provider: "deepseek", date: iso(today), balance: 98.5, currency: "CNY" },
        ]}
      />
    );
    // 走势图 SVG 渲染（无占位文本）
    expect(document.querySelector(".balance-history-svg")).not.toBeNull();
    expect(screen.queryByText("暂无余额历史数据")).not.toBeInTheDocument();
  });
});
