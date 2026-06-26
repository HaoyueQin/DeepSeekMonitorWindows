import { describe, it, expect } from "vitest";
import { fmtInt, fmtTokensShort, fmtMoney, mmdd, todayStr, dateKey, addDays, modelDisplayName, modelIcon } from "./utils";

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
});
