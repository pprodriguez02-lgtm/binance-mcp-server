import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { BinanceClient } from "../binance/client.js";
import type {
  AggregateTrade,
  AvgPriceResponse,
  Kline,
  OrderBookResponse,
  RecentTrade,
  ServerTimeResponse,
  SymbolPriceTicker,
  Ticker24hr,
} from "../binance/types.js";
import { clampLimit, intervalSchema, orderBookLimitSchema, rawOptionSchema, symbolSchema } from "./schemas.js";

export function registerMarketTools(server: McpServer, client: BinanceClient, config: AppConfig): void {
  server.tool(
    "get_server_time",
    "Get Binance server time.",
    { ...rawOptionSchema },
    async ({ raw }) => {
      const response = await client.get<ServerTimeResponse>("/api/v3/time");
      return jsonContent(raw ? withRateLimit(response.data, response.rateLimit) : withRateLimit({ serverTime: response.data.serverTime, isoTime: new Date(response.data.serverTime).toISOString() }, response.rateLimit));
    },
  );

  server.tool(
    "get_exchange_info",
    "Get Binance Spot exchange information, trading rules, and symbol filters. exchangeInfo is cached according to BINANCE_EXCHANGE_INFO_CACHE_TTL_MS.",
    {
      symbol: symbolSchema.optional(),
      symbols: z.array(symbolSchema).min(1).optional(),
      permissions: z.array(z.string().min(1)).optional(),
      ...rawOptionSchema,
    },
    async ({ symbol, symbols, permissions, raw }) => {
      const response = await client.get<unknown>(
        "/api/v3/exchangeInfo",
        { symbol, symbols, permissions },
        { cacheTtlMs: config.exchangeInfoCacheTtlMs },
      );
      return jsonContent(withRateLimit(raw ? response.data : formatExchangeInfo(response.data), response.rateLimit));
    },
  );

  server.tool(
    "get_symbol_price",
    "Get latest symbol price. If symbol is omitted, returns all market prices.",
    {
      symbol: symbolSchema.optional(),
      symbols: z.array(symbolSchema).min(1).optional(),
      ...rawOptionSchema,
    },
    async ({ symbol, symbols, raw }) => {
      const response = await client.get<SymbolPriceTicker | SymbolPriceTicker[]>("/api/v3/ticker/price", { symbol, symbols });
      return jsonContent(withRateLimit(raw ? response.data : formatSymbolPrice(response.data), response.rateLimit));
    },
  );

  server.tool(
    "get_24hr_ticker",
    "Get 24-hour rolling window price change statistics for one or more symbols. A symbol or symbols list is required to avoid large responses.",
    {
      symbol: symbolSchema.optional(),
      symbols: z.array(symbolSchema).min(1).optional(),
      type: z.enum(["FULL", "MINI"]).optional(),
      ...rawOptionSchema,
    },
    async ({ symbol, symbols, type, raw }) => {
      requireSymbolOrSymbols(symbol, symbols);
      const response = await client.get<Ticker24hr | Ticker24hr[]>("/api/v3/ticker/24hr", { symbol, symbols, type });
      return jsonContent(withRateLimit(raw ? response.data : format24hrTicker(response.data), response.rateLimit));
    },
  );

  server.tool(
    "get_order_book",
    "Get order book depth for a symbol.",
    {
      symbol: symbolSchema,
      limit: orderBookLimitSchema.optional(),
      ...rawOptionSchema,
    },
    async ({ symbol, limit, raw }) => {
      const response = await client.get<OrderBookResponse>("/api/v3/depth", { symbol, limit: limit ?? 100 });
      return jsonContent(withRateLimit(raw ? response.data : formatOrderBook(response.data), response.rateLimit));
    },
  );

  server.tool(
    "get_recent_trades",
    "Get recent trades for a symbol.",
    {
      symbol: symbolSchema,
      limit: z.number().int().min(1).max(1000).optional(),
      ...rawOptionSchema,
    },
    async ({ symbol, limit, raw }) => {
      const response = await client.get<RecentTrade[]>("/api/v3/trades", { symbol, limit: limit ?? 100 });
      return jsonContent(withRateLimit(raw ? response.data : response.data.map(formatRecentTrade), response.rateLimit));
    },
  );

  server.tool(
    "get_aggregate_trades",
    "Get compressed aggregate trades for a symbol.",
    {
      symbol: symbolSchema,
      fromId: z.number().int().nonnegative().optional(),
      startTime: z.number().int().nonnegative().optional(),
      endTime: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(1000).optional(),
      ...rawOptionSchema,
    },
    async ({ symbol, fromId, startTime, endTime, limit, raw }) => {
      const response = await client.get<AggregateTrade[]>("/api/v3/aggTrades", { symbol, fromId, startTime, endTime, limit: limit ?? 100 });
      return jsonContent(withRateLimit(raw ? response.data : response.data.map(formatAggregateTrade), response.rateLimit));
    },
  );

  server.tool(
    "get_klines",
    "Get candlestick bars for a symbol. Limit is capped by BINANCE_MAX_KLINES_LIMIT.",
    {
      symbol: symbolSchema,
      interval: intervalSchema,
      startTime: z.number().int().nonnegative().optional(),
      endTime: z.number().int().nonnegative().optional(),
      timeZone: z.string().optional(),
      limit: z.number().int().min(1).optional(),
      ...rawOptionSchema,
    },
    async ({ symbol, interval, startTime, endTime, timeZone, limit, raw }) => {
      const response = await client.get<Kline[]>("/api/v3/klines", {
        symbol,
        interval,
        startTime,
        endTime,
        timeZone,
        limit: clampLimit(limit, 500, config.maxKlinesLimit),
      });
      return jsonContent(withRateLimit(raw ? response.data : response.data.map(formatKline), response.rateLimit));
    },
  );

  server.tool(
    "get_avg_price",
    "Get current average price for a symbol.",
    {
      symbol: symbolSchema,
      ...rawOptionSchema,
    },
    async ({ symbol, raw }) => {
      const response = await client.get<AvgPriceResponse>("/api/v3/avgPrice", { symbol });
      return jsonContent(withRateLimit(raw ? response.data : response.data, response.rateLimit));
    },
  );

  server.tool(
    "get_ui_klines",
    "Get UI-optimized candlestick bars for a symbol. Limit is capped by BINANCE_MAX_KLINES_LIMIT.",
    {
      symbol: symbolSchema,
      interval: intervalSchema,
      startTime: z.number().int().nonnegative().optional(),
      endTime: z.number().int().nonnegative().optional(),
      timeZone: z.string().optional(),
      limit: z.number().int().min(1).optional(),
      ...rawOptionSchema,
    },
    async ({ symbol, interval, startTime, endTime, timeZone, limit, raw }) => {
      const response = await client.get<Kline[]>("/api/v3/uiKlines", {
        symbol,
        interval,
        startTime,
        endTime,
        timeZone,
        limit: clampLimit(limit, 500, config.maxKlinesLimit),
      });
      return jsonContent(withRateLimit(raw ? response.data : response.data.map(formatKline), response.rateLimit));
    },
  );
}

export function jsonContent(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

export function withRateLimit<T>(data: T, rateLimit: unknown): { data: T; rateLimit: unknown } {
  return { data, rateLimit };
}

function requireSymbolOrSymbols(symbol: string | undefined, symbols: string[] | undefined): void {
  if (!symbol && (!symbols || symbols.length === 0)) {
    throw new Error("Either symbol or symbols is required for this tool.");
  }
}

function formatExchangeInfo(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || !("symbols" in payload) || !Array.isArray((payload as { symbols: unknown }).symbols)) {
    return payload;
  }

  const exchangeInfo = payload as { timezone?: string; serverTime?: number; rateLimits?: unknown; symbols: Array<Record<string, unknown>> };
  return {
    timezone: exchangeInfo.timezone,
    serverTime: exchangeInfo.serverTime,
    rateLimits: exchangeInfo.rateLimits,
    symbols: exchangeInfo.symbols.map((symbol) => ({
      symbol: symbol.symbol,
      status: symbol.status,
      baseAsset: symbol.baseAsset,
      quoteAsset: symbol.quoteAsset,
      baseAssetPrecision: symbol.baseAssetPrecision,
      quoteAssetPrecision: symbol.quoteAssetPrecision,
      orderTypes: symbol.orderTypes,
      icebergAllowed: symbol.icebergAllowed,
      ocoAllowed: symbol.ocoAllowed,
      filters: symbol.filters,
      permissions: symbol.permissions,
    })),
  };
}

function formatSymbolPrice(payload: SymbolPriceTicker | SymbolPriceTicker[]): unknown {
  if (Array.isArray(payload)) {
    return payload.map((item) => ({ ...item, priceNumber: Number(item.price) }));
  }
  return { ...payload, priceNumber: Number(payload.price) };
}

function format24hrTicker(payload: Ticker24hr | Ticker24hr[]): unknown {
  if (Array.isArray(payload)) {
    return payload.map(formatSingle24hrTicker);
  }
  return formatSingle24hrTicker(payload);
}

function formatSingle24hrTicker(ticker: Ticker24hr): unknown {
  return {
    symbol: ticker.symbol,
    priceChange: Number(ticker.priceChange),
    priceChangePercent: Number(ticker.priceChangePercent),
    weightedAvgPrice: Number(ticker.weightedAvgPrice),
    lastPrice: Number(ticker.lastPrice),
    bidPrice: Number(ticker.bidPrice),
    askPrice: Number(ticker.askPrice),
    openPrice: Number(ticker.openPrice),
    highPrice: Number(ticker.highPrice),
    lowPrice: Number(ticker.lowPrice),
    volume: Number(ticker.volume),
    quoteVolume: Number(ticker.quoteVolume),
    count: ticker.count,
    openTime: ticker.openTime,
    closeTime: ticker.closeTime,
  };
}

function formatOrderBook(orderBook: OrderBookResponse): unknown {
  const bestBid = orderBook.bids[0];
  const bestAsk = orderBook.asks[0];
  const bestBidPrice = bestBid ? Number(bestBid[0]) : null;
  const bestAskPrice = bestAsk ? Number(bestAsk[0]) : null;
  return {
    lastUpdateId: orderBook.lastUpdateId,
    bestBid: bestBid ? { price: Number(bestBid[0]), quantity: Number(bestBid[1]) } : null,
    bestAsk: bestAsk ? { price: Number(bestAsk[0]), quantity: Number(bestAsk[1]) } : null,
    spread: bestBidPrice !== null && bestAskPrice !== null ? bestAskPrice - bestBidPrice : null,
    bids: orderBook.bids.map(([price, quantity]) => ({ price: Number(price), quantity: Number(quantity) })),
    asks: orderBook.asks.map(([price, quantity]) => ({ price: Number(price), quantity: Number(quantity) })),
  };
}

function formatRecentTrade(trade: RecentTrade): unknown {
  return {
    id: trade.id,
    price: Number(trade.price),
    quantity: Number(trade.qty),
    quoteQuantity: Number(trade.quoteQty),
    time: trade.time,
    isoTime: new Date(trade.time).toISOString(),
    isBuyerMaker: trade.isBuyerMaker,
    isBestMatch: trade.isBestMatch,
  };
}

function formatAggregateTrade(trade: AggregateTrade): unknown {
  return {
    aggregateTradeId: trade.a,
    price: Number(trade.p),
    quantity: Number(trade.q),
    firstTradeId: trade.f,
    lastTradeId: trade.l,
    time: trade.T,
    isoTime: new Date(trade.T).toISOString(),
    isBuyerMaker: trade.m,
    isBestMatch: trade.M,
  };
}

export function formatKline(kline: Kline): unknown {
  return {
    openTime: kline[0],
    openTimeIso: new Date(kline[0]).toISOString(),
    open: Number(kline[1]),
    high: Number(kline[2]),
    low: Number(kline[3]),
    close: Number(kline[4]),
    volume: Number(kline[5]),
    closeTime: kline[6],
    closeTimeIso: new Date(kline[6]).toISOString(),
    quoteAssetVolume: Number(kline[7]),
    numberOfTrades: kline[8],
    takerBuyBaseAssetVolume: Number(kline[9]),
    takerBuyQuoteAssetVolume: Number(kline[10]),
  };
}
