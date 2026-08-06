import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModelDetailPanel } from "./ModelDetailPanel";
import type { UsageResult } from "../types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({}),
}));

const usage: UsageResult = {
  monthCost: 12.34,
  models: [
    { key: "flash", name: "V4 Flash", totalTokens: 1000000, requestCount: 42, cacheHitTokens: 600000, cacheMissTokens: 200000, responseTokens: 200000, cost: 1.23 },
    { key: "pro", name: "V4 Pro", totalTokens: 0, requestCount: 0, cacheHitTokens: 0, cacheMissTokens: 0, responseTokens: 0, cost: 0 },
  ],
  days: [
    { date: "2026-06-01", flashTokens: 1500, flashCacheHit: 900, flashCacheMiss: 300, flashResponse: 300, proTokens: 0, proCacheHit: 0, proCacheMiss: 0, proResponse: 0, totalTokens: 1500, totalCost: 0.12 },
  ],
};

describe("ModelDetailPanel", () => {
  it("renders model details for flash model", () => {
    render(
      <ModelDetailPanel
        model="flash"
        usage={usage}
        usageState="ok"
        onBack={vi.fn()}
        provider="deepseek"
        currency="cny"
        exchangeRate={0.137}
        efficiencyUnit="currency_per_token"
      />
    );
    expect(screen.getByText("V4 Flash")).toBeInTheDocument();
    expect(screen.getByText("API 请求次数")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("1.0M")).toBeInTheDocument();
    expect(screen.getByText("按日 Token 消耗")).toBeInTheDocument();
  });

  it("renders empty state for no data", () => {
    render(
      <ModelDetailPanel
        model="pro"
        usage={usage}
        usageState="error"
        onBack={vi.fn()}
        provider="deepseek"
        currency="cny"
        exchangeRate={0.137}
        efficiencyUnit="currency_per_token"
      />
    );
    expect(screen.getByText("暂无数据")).toBeInTheDocument();
  });
});
