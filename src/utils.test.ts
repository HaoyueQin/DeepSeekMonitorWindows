import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fmtInt, fmtTokensShort, fmtMoney, mmdd, todayStr, dateKey, addDays, modelDisplayName, modelIcon, fetchWithCache, isAuthLikeError } from "./utils";

describe("fmtInt", () => {
  it("formats integers with locale separators", () => {
    expect(fmtInt(102614051)).toBe("102,614,051");
    expect(fmtInt(0)).toBe("0");
    expect(fmtInt(999)).toBe("999");
  });
  it("rounds decimals", () => {
    expect(fmtInt(1234.6)).toBe("1,235");
    expect(fmtInt(1234.4)).toBe("1,234");
  });
});

describe("fmtTokensShort", () => {
  it("formats millions", () => {
    expect(fmtTokensShort(102614051)).toBe("103M");
    expect(fmtTokensShort(1500000)).toBe("1.5M");
  });
  it("formats thousands", () => {
    expect(fmtTokensShort(425581)).toBe("425.6K");
    expect(fmtTokensShort(5000)).toBe("5.0K");
  });
  it("formats small numbers", () => {
    expect(fmtTokensShort(100)).toBe("100");
    expect(fmtTokensShort(0)).toBe("0");
  });
});

describe("fmtMoney", () => {
  it("formats with yen symbol and 2 decimals", () => {
    expect(fmtMoney(4.637495)).toBe("¥4.64");
    expect(fmtMoney(0)).toBe("¥0.00");
    expect(fmtMoney(42.55)).toBe("¥42.55");
  });
});

describe("mmdd", () => {
  it("extracts month/day from YYYY-MM-DD", () => {
    expect(mmdd("2026-06-25")).toBe("6/25");
    expect(mmdd("2026-01-01")).toBe("1/1");
  });
  it("returns original if format is wrong", () => {
    expect(mmdd("invalid")).toBe("invalid");
  });
});

describe("todayStr", () => {
  it("returns YYYY-MM-DD format", () => {
    const result = todayStr();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("dateKey", () => {
  it("formats Date to YYYY-MM-DD", () => {
    expect(dateKey(new Date(2026, 5, 25))).toBe("2026-06-25");
    expect(dateKey(new Date(2026, 0, 1))).toBe("2026-01-01");
  });
});

describe("addDays", () => {
  it("adds days correctly", () => {
    const base = new Date(2026, 5, 25);
    expect(dateKey(addDays(base, 1))).toBe("2026-06-26");
    expect(dateKey(addDays(base, -1))).toBe("2026-06-24");
    expect(dateKey(addDays(base, 0))).toBe("2026-06-25");
  });
  it("handles month boundaries", () => {
    const base = new Date(2026, 5, 1);
    expect(dateKey(addDays(base, -1))).toBe("2026-05-31");
  });
});

describe("modelDisplayName", () => {
  it("maps known keys", () => {
    expect(modelDisplayName("mimo-v2.5")).toBe("V2.5");
    expect(modelDisplayName("mimo-v2.5-pro")).toBe("V2.5 Pro");
  });
  it("returns original for unknown keys", () => {
    expect(modelDisplayName("unknown")).toBe("unknown");
  });
});

describe("modelIcon", () => {
  it("returns pro for pro models", () => {
    expect(modelIcon("mimo-v2.5-pro")).toBe("pro");
    expect(modelIcon("flash-pro")).toBe("pro");
  });
  it("returns flash for non-pro models", () => {
    expect(modelIcon("mimo-v2.5")).toBe("flash");
    expect(modelIcon("flash")).toBe("flash");
  });
  it("returns vision for vision/image models", () => {
    expect(modelIcon("flash-vision")).toBe("vision");
    expect(modelIcon("some-vision-model")).toBe("vision");
    expect(modelIcon("deepseek-image-input")).toBe("vision");
  });
});

describe("isAuthLikeError", () => {
  it("detects auth/config failures that must not be masked by cache", () => {
    expect(isAuthLikeError("API Key 无效或已过期")).toBe(true);
    expect(isAuthLikeError("未配置 API Key")).toBe(true);
    expect(isAuthLikeError("HTTP 状态码 401")).toBe(true);
    expect(isAuthLikeError("认证失败：token 无效：HTTP 401")).toBe(true);
    expect(isAuthLikeError("MiMo 未登录，请在弹出的窗口中完成登录后重试")).toBe(true);
  });
  it("does not classify transient errors as auth-like", () => {
    expect(isAuthLikeError("网络请求失败：connection reset")).toBe(false);
    expect(isAuthLikeError("请求过于频繁，请稍后再试")).toBe(false);
    expect(isAuthLikeError(42)).toBe(false);
  });
});

describe("fetchWithCache", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("stores successful results with a timestamp wrapper", async () => {
    const data = await fetchWithCache("t-key", async () => ({ balance: 1 }));
    expect(data).toEqual({ balance: 1 });
    const raw = JSON.parse(localStorage.getItem("t-key")!);
    expect(raw.__dsmWrapped).toBe(true);
    expect(raw.data).toEqual({ balance: 1 });
    expect(typeof raw.ts).toBe("number");
  });

  it("falls back to fresh cache on non-auth errors", async () => {
    localStorage.setItem("t-key", JSON.stringify({ __dsmWrapped: true, ts: Date.now(), data: { balance: 9 } }));
    const data = await fetchWithCache("t-key", async () => { throw "网络请求失败：timeout"; });
    expect(data).toEqual({ balance: 9 });
  });

  it("propagates auth-like errors instead of serving stale balance", async () => {
    localStorage.setItem("t-key", JSON.stringify({ __dsmWrapped: true, ts: Date.now(), data: { balance: 9 } }));
    await expect(
      fetchWithCache("t-key", async () => { throw "API Key 无效或已过期"; })
    ).rejects.toBe("API Key 无效或已过期");
  });

  it("ignores cache older than ttl", async () => {
    const stale = Date.now() - 25 * 3600 * 1000; // 超过默认 24h TTL
    localStorage.setItem("t-key", JSON.stringify({ __dsmWrapped: true, ts: stale, data: { balance: 3 } }));
    await expect(
      fetchWithCache("t-key", async () => { throw "网络请求失败：offline"; })
    ).rejects.toBe("网络请求失败：offline");
  });

  it("respects custom ttlMs", async () => {
    const almostExpired = Date.now() - 10 * 60 * 1000; // 10 分钟前
    localStorage.setItem("t-key", JSON.stringify({ __dsmWrapped: true, ts: almostExpired, data: { balance: 5 } }));
    await expect(
      fetchWithCache("t-key", async () => { throw "网络错误"; }, { ttlMs: 5 * 60 * 1000 })
    ).rejects.toBe("网络错误");
    const ok = await fetchWithCache("t-key", async () => { throw "网络错误"; }, { ttlMs: 60 * 60 * 1000 });
    expect(ok).toEqual({ balance: 5 });
  });
});
