import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { BinanceClient } from "../binance/client.js";
import type { Kline, OrderBookResponse, Ticker24hr } from "../binance/types.js";
import { clampLimit, intervalSchema, orderBookLimitSchema, symbolSchema } from "./schemas.js";
import { jsonContent, withRateLimit } from "./market.js";

interface NumericKline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteAssetVolume: number;
  numberOfTrades: number;
  takerBuyBaseAssetVolume: number;
  takerBuyQuoteAssetVolume: number;
}

export function registerAnalysisTools(server: McpServer, client: BinanceClient, config: AppConfig): void {
  server.tool(
    "summarize_24hr_ticker",
    "Get an AI-friendly 24-hour market summary for a symbol.",
    {
      symbol: symbolSchema,
    },
    async ({ symbol }) => {
      const response = await client.get<Ticker24hr>("/api/v3/ticker/24hr", { symbol, type: "FULL" });
      const ticker = response.data;
      const lastPrice = Number(ticker.lastPrice);
      const highPrice = Number(ticker.highPrice);
      const lowPrice = Number(ticker.lowPrice);
      const openPrice = Number(ticker.openPrice);
      const amplitudePercent = openPrice > 0 ? ((highPrice - lowPrice) / openPrice) * 100 : null;

      return jsonContent(withRateLimit({
        symbol: ticker.symbol,
        window: {
          openTime: ticker.openTime,
          openTimeIso: new Date(ticker.openTime).toISOString(),
          closeTime: ticker.closeTime,
          closeTimeIso: new Date(ticker.closeTime).toISOString(),
        },
        price: {
          open: openPrice,
          high: highPrice,
          low: lowPrice,
          last: lastPrice,
          weightedAverage: Number(ticker.weightedAvgPrice),
          change: Number(ticker.priceChange),
          changePercent: Number(ticker.priceChangePercent),
          amplitudePercent,
        },
        bestQuote: {
          bidPrice: Number(ticker.bidPrice),
          bidQuantity: Number(ticker.bidQty),
          askPrice: Number(ticker.askPrice),
          askQuantity: Number(ticker.askQty),
          spread: Number(ticker.askPrice) - Number(ticker.bidPrice),
        },
        volume: {
          baseAssetVolume: Number(ticker.volume),
          quoteAssetVolume: Number(ticker.quoteVolume),
          tradeCount: ticker.count,
        },
      }, response.rateLimit));
    },
  );

  server.tool(
    "summarize_order_book",
    "Get an AI-friendly order book depth summary for a symbol.",
    {
      symbol: symbolSchema,
      limit: orderBookLimitSchema.optional(),
      levelsForSummary: z.number().int().min(1).max(100).optional(),
    },
    async ({ symbol, limit, levelsForSummary }) => {
      const response = await client.get<OrderBookResponse>("/api/v3/depth", { symbol, limit: limit ?? 100 });
      const orderBook = response.data;
      const levels = Math.min(levelsForSummary ?? 20, orderBook.bids.length, orderBook.asks.length);
      const bidLevels = orderBook.bids.slice(0, levels).map(([price, quantity]) => ({ price: Number(price), quantity: Number(quantity), quote: Number(price) * Number(quantity) }));
      const askLevels = orderBook.asks.slice(0, levels).map(([price, quantity]) => ({ price: Number(price), quantity: Number(quantity), quote: Number(price) * Number(quantity) }));
      const totalBidQuote = sum(bidLevels.map((item) => item.quote));
      const totalAskQuote = sum(askLevels.map((item) => item.quote));
      const bestBid = bidLevels[0] ?? null;
      const bestAsk = askLevels[0] ?? null;

      return jsonContent(withRateLimit({
        symbol,
        lastUpdateId: orderBook.lastUpdateId,
        levelsAnalyzed: levels,
        bestBid,
        bestAsk,
        spread: bestBid && bestAsk ? bestAsk.price - bestBid.price : null,
        spreadPercent: bestBid && bestAsk ? ((bestAsk.price - bestBid.price) / ((bestAsk.price + bestBid.price) / 2)) * 100 : null,
        depth: {
          totalBidBaseQuantity: sum(bidLevels.map((item) => item.quantity)),
          totalAskBaseQuantity: sum(askLevels.map((item) => item.quantity)),
          totalBidQuoteValue: totalBidQuote,
          totalAskQuoteValue: totalAskQuote,
          bidAskQuoteRatio: totalAskQuote > 0 ? totalBidQuote / totalAskQuote : null,
        },
        largestBidLevel: maxBy(bidLevels, (item) => item.quote),
        largestAskLevel: maxBy(askLevels, (item) => item.quote),
      }, response.rateLimit));
    },
  );

  server.tool(
    "summarize_klines",
    "Get an AI-friendly candlestick summary without complex technical indicators.",
    {
      symbol: symbolSchema,
      interval: intervalSchema,
      startTime: z.number().int().nonnegative().optional(),
      endTime: z.number().int().nonnegative().optional(),
      timeZone: z.string().optional(),
      limit: z.number().int().min(1).optional(),
    },
    async ({ symbol, interval, startTime, endTime, timeZone, limit }) => {
      const response = await client.get<Kline[]>("/api/v3/klines", {
        symbol,
        interval,
        startTime,
        endTime,
        timeZone,
        limit: clampLimit(limit, 200, config.maxKlinesLimit),
      });
      const klines = response.data.map(toNumericKline);
      if (klines.length === 0) {
        return jsonContent(withRateLimit({ symbol, interval, count: 0 }, response.rateLimit));
      }

      const first = klines[0];
      const last = klines[klines.length - 1];
      if (!first || !last) {
        return jsonContent(withRateLimit({ symbol, interval, count: 0 }, response.rateLimit));
      }

      const highest = maxBy(klines, (item) => item.high);
      const lowest = minBy(klines, (item) => item.low);
      const maxVolume = maxBy(klines, (item) => item.volume);
      const bullishCount = klines.filter((item) => item.close > item.open).length;
      const bearishCount = klines.filter((item) => item.close < item.open).length;
      const flatCount = klines.length - bullishCount - bearishCount;
      const priceChange = last.close - first.open;
      const priceChangePercent = first.open > 0 ? (priceChange / first.open) * 100 : null;

      return jsonContent(withRateLimit({
        symbol,
        interval,
        count: klines.length,
        window: {
          openTime: first.openTime,
          openTimeIso: new Date(first.openTime).toISOString(),
          closeTime: last.closeTime,
          closeTimeIso: new Date(last.closeTime).toISOString(),
        },
        price: {
          firstOpen: first.open,
          lastClose: last.close,
          highest,
          lowest,
          change: priceChange,
          changePercent: priceChangePercent,
          range: highest && lowest ? highest.high - lowest.low : null,
          rangePercentOfFirstOpen: highest && lowest && first.open > 0 ? ((highest.high - lowest.low) / first.open) * 100 : null,
        },
        candles: {
          bullishCount,
          bearishCount,
          flatCount,
        },
        volume: {
          totalBaseVolume: sum(klines.map((item) => item.volume)),
          averageBaseVolume: average(klines.map((item) => item.volume)),
          totalQuoteVolume: sum(klines.map((item) => item.quoteAssetVolume)),
          averageQuoteVolume: average(klines.map((item) => item.quoteAssetVolume)),
          maxVolume,
        },
        trades: {
          totalTrades: sum(klines.map((item) => item.numberOfTrades)),
          averageTradesPerCandle: average(klines.map((item) => item.numberOfTrades)),
        },
      }, response.rateLimit));
    },
  );

  server.tool(
    "analyze_technical_indicators",
    "Calculate MA, EMA, RSI, MACD, and Bollinger Bands for a symbol and interval.",
    {
      symbol: symbolSchema,
      interval: intervalSchema,
      limit: z.number().int().min(50).optional(),
      indicators: z.array(z.enum(["MA", "EMA", "RSI", "MACD", "BOLL"])).min(1).optional(),
      maPeriods: z.array(z.number().int().min(2).max(500)).optional(),
      emaPeriods: z.array(z.number().int().min(2).max(500)).optional(),
      rsiPeriods: z.array(z.number().int().min(2).max(100)).optional(),
      macdFastPeriod: z.number().int().min(2).max(100).optional(),
      macdSlowPeriod: z.number().int().min(3).max(300).optional(),
      macdSignalPeriod: z.number().int().min(2).max(100).optional(),
      bollPeriod: z.number().int().min(2).max(200).optional(),
      bollMultiplier: z.number().positive().max(10).optional(),
    },
    async (args) => {
      const response = await client.get<Kline[]>("/api/v3/klines", {
        symbol: args.symbol,
        interval: args.interval,
        limit: clampLimit(args.limit, 200, config.maxKlinesLimit),
      });
      const klines = response.data.map(toNumericKline);
      const closes = klines.map((item) => item.close);
      const snapshot = buildTechnicalIndicators(closes, {
        indicators: args.indicators ?? ["MA", "EMA", "RSI", "MACD", "BOLL"],
        maPeriods: args.maPeriods ?? [7, 25, 99],
        emaPeriods: args.emaPeriods ?? [12, 26],
        rsiPeriods: args.rsiPeriods ?? [14],
        macdFastPeriod: args.macdFastPeriod ?? 12,
        macdSlowPeriod: args.macdSlowPeriod ?? 26,
        macdSignalPeriod: args.macdSignalPeriod ?? 9,
        bollPeriod: args.bollPeriod ?? 20,
        bollMultiplier: args.bollMultiplier ?? 2,
      });
      return jsonContent(withRateLimit({
        symbol: args.symbol,
        interval: args.interval,
        count: klines.length,
        latestKline: klines[klines.length - 1] ?? null,
        indicators: snapshot,
        signals: buildIndicatorSignals(closes, snapshot),
      }, response.rateLimit));
    },
  );

  server.tool(
    "analyze_multi_timeframe_trend",
    "Analyze trend across multiple timeframes such as 15m, 1h, 4h, and 1d.",
    {
      symbol: symbolSchema,
      intervals: z.array(intervalSchema).min(1).max(6).optional(),
      limit: z.number().int().min(50).optional(),
    },
    async ({ symbol, intervals, limit }) => {
      const selectedIntervals = intervals ?? ["15m", "1h", "4h", "1d"];
      const responses = await Promise.all(selectedIntervals.map(async (interval) => {
        const response = await client.get<Kline[]>("/api/v3/klines", {
          symbol,
          interval,
          limit: clampLimit(limit, 200, config.maxKlinesLimit),
        });
        return { interval, response, klines: response.data.map(toNumericKline) };
      }));
      const timeframes = responses.map((item) => buildTrendSnapshot(item.interval, item.klines));
      return jsonContent(withRateLimit({
        symbol,
        intervals: selectedIntervals,
        timeframes,
        consensus: buildTrendConsensus(timeframes),
      }, responses.map((item) => ({ interval: item.interval, rateLimit: item.response.rateLimit }))));
    },
  );

  server.tool(
    "compare_symbols",
    "Compare multiple symbols by price change, volatility, volume, and simple trend strength.",
    {
      symbols: z.array(symbolSchema).min(2).max(20),
      interval: intervalSchema.optional(),
      limit: z.number().int().min(2).optional(),
    },
    async ({ symbols, interval, limit }) => {
      const effectiveInterval = interval ?? "1d";
      const effectiveLimit = clampLimit(limit, 7, Math.min(config.maxKlinesLimit, 500));
      const responses = await Promise.all(symbols.map(async (symbol) => {
        const response = await client.get<Kline[]>("/api/v3/klines", { symbol, interval: effectiveInterval, limit: effectiveLimit });
        return { symbol, response, klines: response.data.map(toNumericKline) };
      }));
      const comparisons = responses.map((item) => buildSymbolComparison(item.symbol, effectiveInterval, item.klines));
      return jsonContent(withRateLimit({
        interval: effectiveInterval,
        limit: effectiveLimit,
        comparisons,
        rankings: {
          byChangePercent: rankBy(comparisons, "changePercent"),
          byVolatility: rankBy(comparisons, "rangePercent"),
          byQuoteVolume: rankBy(comparisons, "totalQuoteVolume"),
        },
      }, responses.map((item) => ({ symbol: item.symbol, rateLimit: item.response.rateLimit }))));
    },
  );
}

function toNumericKline(kline: Kline): NumericKline {
  return {
    openTime: kline[0],
    open: Number(kline[1]),
    high: Number(kline[2]),
    low: Number(kline[3]),
    close: Number(kline[4]),
    volume: Number(kline[5]),
    closeTime: kline[6],
    quoteAssetVolume: Number(kline[7]),
    numberOfTrades: kline[8],
    takerBuyBaseAssetVolume: Number(kline[9]),
    takerBuyQuoteAssetVolume: Number(kline[10]),
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]): number | null {
  return values.length > 0 ? sum(values) / values.length : null;
}

function maxBy<T>(items: T[], mapper: (item: T) => number): T | null {
  let best: T | null = null;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const value = mapper(item);
    if (value > bestValue) {
      best = item;
      bestValue = value;
    }
  }
  return best;
}

function minBy<T>(items: T[], mapper: (item: T) => number): T | null {
  let best: T | null = null;
  let bestValue = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const value = mapper(item);
    if (value < bestValue) {
      best = item;
      bestValue = value;
    }
  }
  return best;
}


type IndicatorSnapshot = Record<string, unknown>;
type RankedComparison = Record<string, unknown> & { symbol: string };

function buildTechnicalIndicators(closes: number[], options: {
  indicators: string[];
  maPeriods: number[];
  emaPeriods: number[];
  rsiPeriods: number[];
  macdFastPeriod: number;
  macdSlowPeriod: number;
  macdSignalPeriod: number;
  bollPeriod: number;
  bollMultiplier: number;
}): IndicatorSnapshot {
  const result: IndicatorSnapshot = {};
  if (options.indicators.includes("MA")) result.ma = Object.fromEntries(options.maPeriods.map((period) => [`MA${period}`, lastValue(simpleMovingAverage(closes, period))]));
  if (options.indicators.includes("EMA")) result.ema = Object.fromEntries(options.emaPeriods.map((period) => [`EMA${period}`, lastValue(exponentialMovingAverage(closes, period))]));
  if (options.indicators.includes("RSI")) result.rsi = Object.fromEntries(options.rsiPeriods.map((period) => [`RSI${period}`, calculateRsi(closes, period)]));
  if (options.indicators.includes("MACD")) result.macd = calculateMacd(closes, options.macdFastPeriod, options.macdSlowPeriod, options.macdSignalPeriod);
  if (options.indicators.includes("BOLL")) result.boll = calculateBollingerBands(closes, options.bollPeriod, options.bollMultiplier);
  return result;
}

function buildIndicatorSignals(closes: number[], snapshot: IndicatorSnapshot): unknown {
  const latestClose = closes[closes.length - 1] ?? null;
  const ma = snapshot.ma as Record<string, number | null> | undefined;
  const rsi = snapshot.rsi as Record<string, number | null> | undefined;
  const macd = snapshot.macd as { histogram?: number | null } | undefined;
  const boll = snapshot.boll as { upper?: number | null; lower?: number | null; middle?: number | null } | undefined;
  const rsiValue = (rsi ? Object.values(rsi).find((value): value is number => typeof value === "number") : null) ?? null;
  return {
    latestClose,
    movingAverageBias: latestClose === null || !ma ? [] : Object.entries(ma).filter((entry): entry is [string, number] => typeof entry[1] === "number").map(([name, value]) => ({ name, value, closeAbove: latestClose > value })),
    rsiState: rsiValue === null ? "unknown" : rsiValue >= 70 ? "overbought" : rsiValue <= 30 ? "oversold" : "neutral",
    macdState: macd?.histogram === null || macd?.histogram === undefined ? "unknown" : macd.histogram > 0 ? "bullish" : macd.histogram < 0 ? "bearish" : "neutral",
    bollingerState: latestClose === null || !boll || boll.upper === null || boll.upper === undefined || boll.lower === null || boll.lower === undefined || boll.middle === null || boll.middle === undefined ? "unknown" : latestClose > boll.upper ? "above_upper_band" : latestClose < boll.lower ? "below_lower_band" : latestClose > boll.middle ? "upper_half" : "lower_half",
  };
}

function buildTrendSnapshot(interval: string, klines: NumericKline[]): RankedComparison {
  const first = klines[0];
  const last = klines[klines.length - 1];
  if (!first || !last) return { symbol: interval, interval, count: 0, classification: "insufficient_data" };
  const closes = klines.map((item) => item.close);
  const high = Math.max(...klines.map((item) => item.high));
  const low = Math.min(...klines.map((item) => item.low));
  const change = last.close - first.open;
  const changePercent = first.open > 0 ? (change / first.open) * 100 : null;
  const indicators = buildTechnicalIndicators(closes, { indicators: ["MA", "EMA", "RSI", "MACD"], maPeriods: [20, 50], emaPeriods: [12, 26], rsiPeriods: [14], macdFastPeriod: 12, macdSlowPeriod: 26, macdSignalPeriod: 9, bollPeriod: 20, bollMultiplier: 2 });
  return {
    symbol: interval,
    interval,
    count: klines.length,
    window: { openTime: first.openTime, openTimeIso: new Date(first.openTime).toISOString(), closeTime: last.closeTime, closeTimeIso: new Date(last.closeTime).toISOString() },
    price: { firstOpen: first.open, lastClose: last.close, change, changePercent, high, low, rangePercent: first.open > 0 ? ((high - low) / first.open) * 100 : null },
    volume: { total: sum(klines.map((item) => item.volume)), average: average(klines.map((item) => item.volume)), latest: last.volume },
    indicators,
    classification: classifyTrend(last.close, changePercent, indicators),
  };
}

function buildTrendConsensus(timeframes: RankedComparison[]): unknown {
  const counts = timeframes.reduce<Record<string, number>>((acc, item) => {
    const key = String(item.classification ?? "unknown");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const bullish = (counts.strong_bullish ?? 0) + (counts.bullish ?? 0);
  const bearish = (counts.strong_bearish ?? 0) + (counts.bearish ?? 0);
  const neutral = counts.neutral ?? 0;
  return { overall: bullish > bearish && bullish >= neutral ? "bullish" : bearish > bullish && bearish >= neutral ? "bearish" : "mixed", counts, note: "Based on price change, MA position, RSI, and MACD histogram." };
}

function buildSymbolComparison(symbol: string, interval: string, klines: NumericKline[]): RankedComparison {
  const first = klines[0];
  const last = klines[klines.length - 1];
  if (!first || !last) return { symbol, interval, count: 0, changePercent: null, rangePercent: null, totalQuoteVolume: 0 };
  const high = Math.max(...klines.map((item) => item.high));
  const low = Math.min(...klines.map((item) => item.low));
  const change = last.close - first.open;
  const changePercent = first.open > 0 ? (change / first.open) * 100 : null;
  const rangePercent = first.open > 0 ? ((high - low) / first.open) * 100 : null;
  const indicators = buildTechnicalIndicators(klines.map((item) => item.close), { indicators: ["MA", "RSI"], maPeriods: [7, 20], emaPeriods: [12, 26], rsiPeriods: [14], macdFastPeriod: 12, macdSlowPeriod: 26, macdSignalPeriod: 9, bollPeriod: 20, bollMultiplier: 2 });
  return { symbol, interval, count: klines.length, firstOpen: first.open, lastClose: last.close, high, low, change, changePercent, rangePercent, totalBaseVolume: sum(klines.map((item) => item.volume)), totalQuoteVolume: sum(klines.map((item) => item.quoteAssetVolume)), averageQuoteVolume: average(klines.map((item) => item.quoteAssetVolume)), bullishCandles: klines.filter((item) => item.close > item.open).length, bearishCandles: klines.filter((item) => item.close < item.open).length, indicators, relativeStrength: classifyRelativeStrength(changePercent, indicators) };
}

function classifyTrend(close: number, changePercent: number | null, indicators: IndicatorSnapshot): string {
  const ma = indicators.ma as Record<string, number | null> | undefined;
  const rsi = indicators.rsi as Record<string, number | null> | undefined;
  const macd = indicators.macd as { histogram?: number | null } | undefined;
  let score = 0;
  if (changePercent !== null) score += changePercent > 2 ? 2 : changePercent > 0 ? 1 : changePercent < -2 ? -2 : changePercent < 0 ? -1 : 0;
  for (const key of ["MA20", "MA50"]) if (typeof ma?.[key] === "number") score += close > ma[key] ? 1 : -1;
  if (typeof rsi?.RSI14 === "number") score += rsi.RSI14 > 60 ? 1 : rsi.RSI14 < 40 ? -1 : 0;
  if (typeof macd?.histogram === "number") score += macd.histogram > 0 ? 1 : macd.histogram < 0 ? -1 : 0;
  return score >= 4 ? "strong_bullish" : score >= 2 ? "bullish" : score <= -4 ? "strong_bearish" : score <= -2 ? "bearish" : "neutral";
}

function classifyRelativeStrength(changePercent: number | null, indicators: IndicatorSnapshot): string {
  const rsi = indicators.rsi as Record<string, number | null> | undefined;
  let score = 0;
  if (changePercent !== null) score += changePercent > 0 ? 1 : changePercent < 0 ? -1 : 0;
  if (typeof rsi?.RSI14 === "number") score += rsi.RSI14 > 55 ? 1 : rsi.RSI14 < 45 ? -1 : 0;
  return score >= 2 ? "strong" : score > 0 ? "moderate" : score < -1 ? "weak" : "neutral";
}

function simpleMovingAverage(values: number[], period: number): Array<number | null> { return values.map((_, index) => index + 1 < period ? null : average(values.slice(index + 1 - period, index + 1))); }
function exponentialMovingAverage(values: number[], period: number): Array<number | null> {
  if (values.length < period) return values.map(() => null);
  const result: Array<number | null> = values.map(() => null);
  const multiplier = 2 / (period + 1);
  let prev: number | null = average(values.slice(0, period));
  result[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    const value = values[i];
    if (prev === null || value === undefined) continue;
    prev = (value - prev) * multiplier + prev;
    result[i] = prev;
  }
  return result;
}
function calculateRsi(values: number[], period: number): number | null { if (values.length <= period) return null; let gains = 0, losses = 0; for (let i = 1; i <= period; i += 1) { const change = values[i]! - values[i - 1]!; if (change >= 0) gains += change; else losses -= change; } let avgGain = gains / period, avgLoss = losses / period; for (let i = period + 1; i < values.length; i += 1) { const change = values[i]! - values[i - 1]!; avgGain = ((avgGain * (period - 1)) + Math.max(change, 0)) / period; avgLoss = ((avgLoss * (period - 1)) + Math.max(-change, 0)) / period; } return avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)); }
function calculateMacd(values: number[], fastPeriod: number, slowPeriod: number, signalPeriod: number): unknown { if (fastPeriod >= slowPeriod || values.length < slowPeriod + signalPeriod) return { fastPeriod, slowPeriod, signalPeriod, macd: null, signal: null, histogram: null }; const fast = exponentialMovingAverage(values, fastPeriod), slow = exponentialMovingAverage(values, slowPeriod); const series = values.map((_, i) => typeof fast[i] === "number" && typeof slow[i] === "number" ? fast[i]! - slow[i]! : null); const signal = exponentialMovingAverage(series.filter((value): value is number => typeof value === "number"), signalPeriod); const macd = lastValue(series), sig = lastValue(signal); return { fastPeriod, slowPeriod, signalPeriod, macd, signal: sig, histogram: macd !== null && sig !== null ? macd - sig : null }; }
function calculateBollingerBands(values: number[], period: number, multiplier: number): unknown { if (values.length < period) return { period, multiplier, middle: null, upper: null, lower: null, bandwidthPercent: null, percentB: null }; const window = values.slice(-period), middle = average(window)!; const std = Math.sqrt(average(window.map((value) => (value - middle) ** 2)) ?? 0); const upper = middle + multiplier * std, lower = middle - multiplier * std, latest = values[values.length - 1] ?? null; return { period, multiplier, middle, upper, lower, bandwidthPercent: middle > 0 ? ((upper - lower) / middle) * 100 : null, percentB: latest !== null && upper !== lower ? (latest - lower) / (upper - lower) : null }; }
function lastValue(values: Array<number | null>): number | null {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i];
    if (typeof value === "number") return value;
  }
  return null;
}
function rankBy(items: RankedComparison[], key: string): unknown[] { return [...items].sort((a, b) => Number(b[key] ?? Number.NEGATIVE_INFINITY) - Number(a[key] ?? Number.NEGATIVE_INFINITY)).map((item) => ({ symbol: item.symbol, [key]: item[key] })); }
