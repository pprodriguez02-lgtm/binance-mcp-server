import "dotenv/config";

export type BinanceEnv = "demo" | "testnet" | "production";

const DEFAULT_BASE_URLS: Record<BinanceEnv, string> = {
  demo: "https://demo-api.binance.com",
  testnet: "https://testnet.binance.vision",
  production: "https://api.binance.com",
};

const DEFAULT_FUTURES_BASE_URLS: Record<BinanceEnv, string> = {
  demo: "https://testnet.binancefuture.com",
  testnet: "https://testnet.binancefuture.com",
  production: "https://fapi.binance.com",
};

const DEFAULT_COIN_FUTURES_BASE_URLS: Record<BinanceEnv, string> = {
  demo: "https://testnet.binancefuture.com",
  testnet: "https://testnet.binancefuture.com",
  production: "https://dapi.binance.com",
};

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumberEnv(name: string, defaultValue: number): number {
  const value = readEnv(name);
  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }
  return parsed;
}

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const value = readEnv(name);
  if (!value) return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readBinanceEnv(): BinanceEnv {
  const value = readEnv("BINANCE_ENV") ?? "demo";
  if (value === "demo" || value === "testnet" || value === "production") {
    return value;
  }
  throw new Error("BINANCE_ENV must be one of: demo, testnet, production.");
}

export interface AppConfig {
  env: BinanceEnv;
  baseUrl: string;
  signedBaseUrl: string;
  futuresBaseUrl: string;
  futuresSignedBaseUrl: string;
  coinFuturesBaseUrl: string;
  coinFuturesSignedBaseUrl: string;
  apiKey: string | undefined;
  apiSecret: string | undefined;
  proxyUrl: string | undefined;
  requestTimeoutMs: number;
  defaultRecvWindow: number;
  enableTrading: boolean;
  allowProductionTrading: boolean;
  exchangeInfoCacheTtlMs: number;
  maxKlinesLimit: number;
  debug: boolean;
}

export function loadConfig(): AppConfig {
  const env = readBinanceEnv();
  return {
    env,
    baseUrl: readEnv("BINANCE_BASE_URL") ?? DEFAULT_BASE_URLS[env],
    signedBaseUrl: readEnv("BINANCE_SIGNED_BASE_URL") ?? DEFAULT_BASE_URLS[env],
    futuresBaseUrl: readEnv("BINANCE_FUTURES_BASE_URL") ?? DEFAULT_FUTURES_BASE_URLS[env],
    futuresSignedBaseUrl: readEnv("BINANCE_FUTURES_SIGNED_BASE_URL") ?? readEnv("BINANCE_FUTURES_BASE_URL") ?? DEFAULT_FUTURES_BASE_URLS[env],
    coinFuturesBaseUrl: readEnv("BINANCE_COIN_FUTURES_BASE_URL") ?? DEFAULT_COIN_FUTURES_BASE_URLS[env],
    coinFuturesSignedBaseUrl: readEnv("BINANCE_COIN_FUTURES_SIGNED_BASE_URL") ?? readEnv("BINANCE_COIN_FUTURES_BASE_URL") ?? DEFAULT_COIN_FUTURES_BASE_URLS[env],
    apiKey: readEnv("BINANCE_API_KEY"),
    apiSecret: readEnv("BINANCE_API_SECRET") ?? readEnv("BINANCE_SECRET_KEY"),
    proxyUrl: readEnv("BINANCE_PROXY_URL"),
    requestTimeoutMs: readNumberEnv("BINANCE_REQUEST_TIMEOUT_MS", 10_000),
    defaultRecvWindow: readNumberEnv("BINANCE_DEFAULT_RECV_WINDOW", 5_000),
    enableTrading: readBooleanEnv("BINANCE_ENABLE_TRADING", false),
    allowProductionTrading: readBooleanEnv("BINANCE_ALLOW_PRODUCTION_TRADING", false),
    exchangeInfoCacheTtlMs: readNumberEnv("BINANCE_EXCHANGE_INFO_CACHE_TTL_MS", 300_000),
    maxKlinesLimit: readNumberEnv("BINANCE_MAX_KLINES_LIMIT", 1_000),
    debug: (readEnv("BINANCE_DEBUG") ?? "false").toLowerCase() === "true",
  };
}
