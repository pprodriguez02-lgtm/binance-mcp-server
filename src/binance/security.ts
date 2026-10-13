import type { AppConfig } from "../config.js";

const PRODUCTION_HOSTS = new Set([
  "api.binance.com",
  "fapi.binance.com",
  "dapi.binance.com",
  "data-api.binance.vision",
]);

const ALLOWED_HOSTS = new Set([
  ...PRODUCTION_HOSTS,
  "demo-api.binance.com",
  "testnet.binance.vision",
  "testnet.binancefuture.com",
]);

export function assertAllowedBinanceUrl(url: URL, signed = false): void {
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)
    || url.port || url.username || url.password || url.hash) {
    throw new Error("Binance API URLs must use HTTPS on an allowed Binance host, without custom ports, credentials, or fragments.");
  }
  if (signed && url.hostname === "data-api.binance.vision") {
    throw new Error("Signed requests cannot use the public data-api.binance.vision host.");
  }
}

export function requiresProductionTradingPermission(config: AppConfig, baseUrl: string): boolean {
  const url = new URL(baseUrl);
  assertAllowedBinanceUrl(url, true);
  return config.env === "production" || PRODUCTION_HOSTS.has(url.hostname);
}
