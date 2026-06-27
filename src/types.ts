export type ViewName = "dashboard" | "settings" | "detail";
export type ModelName = "flash" | "pro" | (string & {});
export type Provider = "deepseek" | "mimo";

export type AppConfig = {
  apiKeyConfigured: boolean;
  apiKeyPreview: string | null;
  usageTokenConfigured: boolean;
  provider: Provider;
  mimoTokenConfigured: boolean;
  refreshIntervalSeconds: number;
  autoRefreshEnabled: boolean;
  autostart: boolean;
  configPath: string;
  lowBalanceNotify: boolean;
  lowBalanceThreshold: number;
  theme: "light" | "dark" | "system";
  currency: "cny" | "usd";
  efficiencyUnit: "token_per_currency" | "currency_per_token";
  defaultProvider: Provider;
  mimoRefreshIntervalSeconds: number;
  notifyCooldownMinutes: number;
};

export type BalanceData = {
  isAvailable: boolean;
  currency: string;
  totalBalance: string;
  grantedBalance: string;
  toppedUpBalance: string;
};

export type BalanceState = "loading" | "ok" | "error" | "nokey";

export type UsageModel = {
  key: string;
  name: string;
  totalTokens: number;
  requestCount: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  responseTokens: number;
  cost: number;
};

export type UsageDay = {
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

export type UsageResult = {
  models: UsageModel[];
  days: UsageDay[];
  monthCost: number;
};

export type MimoBalanceData = {
  availableBalance: string;
  currency: string;
  totalConsumption: string;
  monthlyExpense: string;
};

export type MimoUsageModel = {
  key: string;
  name: string;
  totalTokens: number;
  requestCount: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  responseTokens: number;
  cost: number;
};

export type MimoUsageDay = {
  date: string;
  totalTokens: number;
  totalCost: number;
  models: Array<{
    key: string;
    totalTokens: number;
    cacheHitTokens: number;
    cacheMissTokens: number;
    responseTokens: number;
    totalCost: number;
  }>;
};

export type MimoUsageResult = {
  models: MimoUsageModel[];
  days: MimoUsageDay[];
  monthCost: number;
};
