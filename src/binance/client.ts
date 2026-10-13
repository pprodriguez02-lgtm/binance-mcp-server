import crypto from "node:crypto";
import fetch, { type RequestInit } from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import type { Agent } from "node:http";
import type { AppConfig } from "../config.js";
import type { BinanceResponse, RateLimitInfo } from "./types.js";
import { assertAllowedBinanceUrl } from "./security.js";

export class BinanceApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly code: number | undefined,
    public readonly payload: unknown,
  ) {
    super(message);
    this.name = "BinanceApiError";
  }
}

interface CacheEntry<T> {
  expiresAt: number;
  value: BinanceResponse<T>;
}

export class BinanceClient {
  private readonly exchangeInfoCache = new Map<string, CacheEntry<unknown>>();
  private readonly proxyAgent: Agent | undefined;

  constructor(private readonly config: AppConfig) {
    for (const baseUrl of [config.baseUrl, config.futuresBaseUrl, config.coinFuturesBaseUrl]) {
      assertAllowedBinanceUrl(new URL(baseUrl));
    }
    for (const baseUrl of [config.signedBaseUrl, config.futuresSignedBaseUrl, config.coinFuturesSignedBaseUrl]) {
      assertAllowedBinanceUrl(new URL(baseUrl), true);
    }
    this.proxyAgent = config.proxyUrl ? createProxyAgent(config.proxyUrl) : undefined;
  }

  async get<T>(path: string, params: Record<string, unknown> = {}, options: { cacheTtlMs?: number } = {}): Promise<BinanceResponse<T>> {
    const url = this.buildUrl(path, params);
    const cacheKey = url.toString();

    if (options.cacheTtlMs && options.cacheTtlMs > 0) {
      const cached = this.exchangeInfoCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.value as BinanceResponse<T>;
      }
    }

    const result = await this.request<T>("GET", url);

    if (options.cacheTtlMs && options.cacheTtlMs > 0) {
      this.exchangeInfoCache.set(cacheKey, {
        expiresAt: Date.now() + options.cacheTtlMs,
        value: result as BinanceResponse<unknown>,
      });
    }

    return result;
  }

  async signedGet<T>(path: string, params: Record<string, unknown> = {}): Promise<BinanceResponse<T>> {
    return this.request<T>("GET", this.buildSignedUrl(path, params), true);
  }

  async signedPost<T>(path: string, params: Record<string, unknown> = {}): Promise<BinanceResponse<T>> {
    return this.request<T>("POST", this.buildSignedUrl(path, params), true);
  }

  async signedDelete<T>(path: string, params: Record<string, unknown> = {}): Promise<BinanceResponse<T>> {
    return this.request<T>("DELETE", this.buildSignedUrl(path, params), true);
  }

  async futuresGet<T>(path: string, params: Record<string, unknown> = {}): Promise<BinanceResponse<T>> {
    return this.request<T>("GET", this.buildUrlWithBase(path, params, this.config.futuresBaseUrl));
  }

  async futuresSignedGet<T>(path: string, params: Record<string, unknown> = {}): Promise<BinanceResponse<T>> {
    return this.request<T>("GET", this.buildSignedUrlWithBase(path, params, this.config.futuresSignedBaseUrl), true);
  }

  async futuresSignedPost<T>(path: string, params: Record<string, unknown> = {}): Promise<BinanceResponse<T>> {
    return this.request<T>("POST", this.buildSignedUrlWithBase(path, params, this.config.futuresSignedBaseUrl), true);
  }

  async futuresSignedDelete<T>(path: string, params: Record<string, unknown> = {}): Promise<BinanceResponse<T>> {
    return this.request<T>("DELETE", this.buildSignedUrlWithBase(path, params, this.config.futuresSignedBaseUrl), true);
  }

  async coinFuturesGet<T>(path: string, params: Record<string, unknown> = {}): Promise<BinanceResponse<T>> {
    return this.request<T>("GET", this.buildUrlWithBase(path, params, this.config.coinFuturesBaseUrl));
  }

  async coinFuturesSignedGet<T>(path: string, params: Record<string, unknown> = {}): Promise<BinanceResponse<T>> {
    return this.request<T>("GET", this.buildSignedUrlWithBase(path, params, this.config.coinFuturesSignedBaseUrl), true);
  }

  async coinFuturesSignedPost<T>(path: string, params: Record<string, unknown> = {}): Promise<BinanceResponse<T>> {
    return this.request<T>("POST", this.buildSignedUrlWithBase(path, params, this.config.coinFuturesSignedBaseUrl), true);
  }

  async coinFuturesSignedDelete<T>(path: string, params: Record<string, unknown> = {}): Promise<BinanceResponse<T>> {
    return this.request<T>("DELETE", this.buildSignedUrlWithBase(path, params, this.config.coinFuturesSignedBaseUrl), true);
  }

  private async request<T>(method: string, url: URL, signed = false): Promise<BinanceResponse<T>> {
    assertAllowedBinanceUrl(url, signed);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const response = await fetch(url, this.buildRequestInit(method, controller.signal, signed));
      const text = await response.text();
      const payload = parseResponsePayload(text, response.headers.get("content-type"));

      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && "msg" in payload
          ? String((payload as { msg: unknown }).msg)
          : `Binance API request failed with status ${response.status}`;
        const code = typeof payload === "object" && payload !== null && "code" in payload && typeof (payload as { code: unknown }).code === "number"
          ? (payload as { code: number }).code
          : undefined;
        throw new BinanceApiError(message, response.status, code, payload);
      }

      return {
        data: payload as T,
        rateLimit: extractRateLimitInfo(response.headers),
      };
    } catch (error) {
      if (error instanceof BinanceApiError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new BinanceApiError(`Binance API request timed out after ${this.config.requestTimeoutMs}ms`, undefined, undefined, undefined);
      }
      if (error instanceof Error) {
        throw new BinanceApiError(`Binance API request failed: ${error.message}`, undefined, undefined, undefined);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildRequestInit(method: string, signal: AbortSignal, signed: boolean): RequestInit {
    const init: RequestInit = {
      method,
      signal,
      headers: this.buildHeaders(signed),
      redirect: "error",
    };

    if (this.proxyAgent) {
      init.agent = this.proxyAgent;
    }

    return init;
  }

  private buildHeaders(signed: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "binance-mcp-server/0.1.0",
    };

    if (signed && this.config.apiKey) {
      headers["X-MBX-APIKEY"] = this.config.apiKey;
    }

    return headers;
  }

  private buildSignedUrl(path: string, params: Record<string, unknown>): URL {
    return this.buildSignedUrlWithBase(path, params, this.config.signedBaseUrl);
  }

  private buildSignedUrlWithBase(path: string, params: Record<string, unknown>, baseUrl: string): URL {
    if (!this.config.apiKey || !this.config.apiSecret) {
      throw new BinanceApiError("BINANCE_API_KEY and BINANCE_API_SECRET are required for signed Binance endpoints.", undefined, undefined, undefined);
    }

    const signedParams = {
      recvWindow: this.config.defaultRecvWindow,
      ...params,
      timestamp: Date.now(),
    };
    const url = this.buildUrlWithBase(path, signedParams, baseUrl);
    assertAllowedBinanceUrl(url, true);
    const signature = crypto
      .createHmac("sha256", this.config.apiSecret)
      .update(url.searchParams.toString())
      .digest("hex");
    url.searchParams.set("signature", signature);
    return url;
  }

  private buildUrl(path: string, params: Record<string, unknown>): URL {
    return this.buildUrlWithBase(path, params, this.config.baseUrl);
  }

  private buildUrlWithBase(path: string, params: Record<string, unknown>, baseUrl: string): URL {
    const url = new URL(path, baseUrl);
    assertAllowedBinanceUrl(url);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }
      if (Array.isArray(value)) {
        url.searchParams.set(key, JSON.stringify(value));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }
}

function parseResponsePayload(text: string, contentType: string | null): unknown {
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 500);
    return {
      nonJsonResponse: true,
      contentType,
      snippet,
      hint: contentType?.includes("text/html")
        ? "Binance returned HTML. This usually means the endpoint is unsupported by the configured base URL. For signed account/order endpoints, set BINANCE_SIGNED_BASE_URL to a trading API URL such as https://demo-api.binance.com, https://testnet.binance.vision, or https://api.binance.com."
        : "Binance returned a non-JSON response.",
    };
  }
}

function createProxyAgent(proxyUrl: string): Agent {
  const protocol = new URL(proxyUrl).protocol.toLowerCase();
  if (protocol === "socks5:" || protocol === "socks5h:" || protocol === "socks4:" || protocol === "socks4a:") {
    return new SocksProxyAgent(proxyUrl) as Agent;
  }
  if (protocol === "http:" || protocol === "https:") {
    return new HttpsProxyAgent(proxyUrl) as Agent;
  }
  throw new Error(`Unsupported BINANCE_PROXY_URL protocol: ${protocol}`);
}

interface HeaderReader {
  get(name: string): string | null;
}

function extractRateLimitInfo(headers: HeaderReader): RateLimitInfo {
  return {
    usedWeight: headers.get("x-mbx-used-weight"),
    usedWeight1m: headers.get("x-mbx-used-weight-1m"),
    orderCount10s: headers.get("x-mbx-order-count-10s"),
    orderCount1d: headers.get("x-mbx-order-count-1d"),
  };
}
