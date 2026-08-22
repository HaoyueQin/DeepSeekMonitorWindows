import type { UsageDay } from "./types";

export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");

export const fmtTokensShort = (n: number) => {
  if (n >= 1e8) return (n / 1e6).toFixed(0) + "M";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
};

export const fmtMoney = (n: number, currency?: string, rate?: number) => {
  if (currency === "usd" && rate && rate > 0) {
    return "$" + (n * rate).toFixed(2);
  }
  return "¥" + n.toFixed(2);
};

export const mmdd = (date: string) => {
  const parts = date.split("-");
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : date;
};

export const todayStr = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export const addDays = (date: Date, offset: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + offset);
  return next;
};

export const recentUsageDays = (days: UsageDay[], count = 7): UsageDay[] => {
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
        visionTokens: 0,
        visionCacheHit: 0,
        visionCacheMiss: 0,
        visionResponse: 0,
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

export const previousMonth = (date: Date) => {
  const previous = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  return { month: previous.getMonth() + 1, year: previous.getFullYear() };
};

export const modelDisplayName = (key: string): string => {
  const map: Record<string, string> = {
    "mimo-v2.5": "V2.5",
    "mimo-v2.5-pro": "V2.5 Pro",
  };
  return map[key] ?? key;
};

export const modelIcon = (key: string): "flash" | "vision" | "pro" => {
  if (key === "mimo-v2.5-pro") return "pro";
  if (key.startsWith("mimo-")) return "flash";
  if (key === "flash-vision" || key.includes("vision") || key.includes("image")) return "vision";
  if (key.includes("pro")) return "pro";
  return "flash";
};

// ─── 余额缓存工具 ───────────────────────────────────────

/** 认证/配置类错误的关键词：这类失败绝不能用旧缓存兜底，否则 key 失效后界面会一直显示过期余额而不报错 */
const AUTH_LIKE_ERROR_NEEDLES = ["未配置", "无效", "已过期", "401", "403", "认证", "未登录"];
export const isAuthLikeError = (error: unknown): boolean =>
  typeof error === "string" && AUTH_LIKE_ERROR_NEEDLES.some((needle) => error.includes(needle));

/** 缓存条目默认最长可用时长：超过则视为过期，不再作为兜底展示 */
const DEFAULT_CACHE_TTL_MS = 24 * 3600 * 1000;

type WrappedCache<T> = { __dsmWrapped: true; ts: number; data: T };

function unwrapCached<T>(raw: string | null): { data: T; ts: number } | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    // 新格式带时间戳包装；旧版本裸数据无时间戳，视为未知时效（不可作兜底）
    if (parsed && typeof parsed === "object" && (parsed as WrappedCache<T>).__dsmWrapped === true) {
      const wrapped = parsed as WrappedCache<T>;
      return { data: wrapped.data, ts: wrapped.ts };
    }
    return null;
  } catch {
    return null;
  }
}

/** 通用缓存工具：成功写入 localStorage（带时间戳），失败时按规则回退到缓存。
 *  - 认证/配置类错误直接抛出，保证真实状态上屏；
 *  - 其余错误（网络抖动、限流等）回退到 TTL 内的缓存。 */
export async function fetchWithCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts?: { ttlMs?: number },
): Promise<T> {
  try {
    const data = await fetcher();
    try {
      localStorage.setItem(key, JSON.stringify({ __dsmWrapped: true, ts: Date.now(), data }));
    } catch {}
    return data;
  } catch (error) {
    if (isAuthLikeError(error)) throw error;
    const entry = unwrapCached<T>(localStorage.getItem(key));
    const maxAge = opts?.ttlMs ?? DEFAULT_CACHE_TTL_MS;
    if (entry && Date.now() - entry.ts <= maxAge) return entry.data;
    throw error;
  }
}

