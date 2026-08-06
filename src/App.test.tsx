import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "./main";
import type { AppConfig, BalanceData, UsageResult } from "./types";

// mock Tauri IPC（hoisted 确保 mock factory 可引用）
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  getVersion: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));

const config: AppConfig = {
  apiKeyConfigured: true,
  apiKeyPreview: "sk-abc...7890",
  usageTokenConfigured: true,
  provider: "deepseek",
  mimoTokenConfigured: false,
  refreshIntervalSeconds: 60,
  autoRefreshEnabled: false,
  autostart: false,
  configPath: "C:\\fake\\config.json",
  lowBalanceNotify: false,
  lowBalanceThreshold: 5,
  theme: "light",
  currency: "cny",
  efficiencyUnit: "currency_per_token",
  defaultProvider: "deepseek",
  mimoRefreshIntervalSeconds: 0,
  notifyCooldownMinutes: 30,
  alwaysOnTop: false,
  autoClearOldCache: true,
  usageHistoryMonths: 12,
};

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

beforeEach(() => {
  localStorage.clear();
  mocks.listen.mockResolvedValue(() => {});
  mocks.getVersion.mockResolvedValue("2.6.0");
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "get_app_config": return config;
      case "fetch_balance": return balance;
      case "fetch_usage": return usage;
      case "get_balance_history": return [];
      default: return {};
    }
  });
});

describe("App 集成流程", () => {
  it("启动后加载配置、余额与用量并渲染主面板", async () => {
    render(<App />);
    // 等待余额与用量渲染
    await waitFor(() => expect(screen.getByText("¥88.66")).toBeInTheDocument());
    expect(screen.getByText("V4 Flash")).toBeInTheDocument();
    expect(screen.getByText("V4 Pro")).toBeInTheDocument();
    expect(screen.getByText("缓存命中明细")).toBeInTheDocument();
    // 余额与用量命令被调用
    expect(mocks.invoke).toHaveBeenCalledWith("fetch_balance");
    // 12 个月用量并行请求
    const usageCalls = mocks.invoke.mock.calls.filter(([cmd]) => cmd === "fetch_usage");
    expect(usageCalls.length).toBe(12);
  });

  it("配置读取失败时降级为默认值并仍尝试加载", async () => {
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_config") throw new Error("配置损坏");
      if (cmd === "fetch_balance") return balance;
      if (cmd === "fetch_usage") return usage;
      return {};
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText("¥88.66")).toBeInTheDocument());
  });

  it("余额查询失败时展示错误状态", async () => {
    mocks.invoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "get_app_config": return config;
        case "fetch_balance": throw new Error("网络错误");
        case "fetch_usage": return usage;
        case "get_balance_history": return [];
        default: return {};
      }
    });
    render(<App />);
    await waitFor(() => expect(screen.getAllByText("查询失败").length).toBeGreaterThan(0));
  });
});

