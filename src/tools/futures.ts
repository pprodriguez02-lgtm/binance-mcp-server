import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { BinanceClient } from "../binance/client.js";
import { jsonContent, withRateLimit } from "./market.js";
import { intervalSchema, symbolSchema } from "./schemas.js";

const sideSchema = z.enum(["BUY", "SELL"]);
const positionSideSchema = z.enum(["BOTH", "LONG", "SHORT"]);
const futuresOrderTypeSchema = z.enum(["LIMIT", "MARKET", "STOP", "STOP_MARKET", "TAKE_PROFIT", "TAKE_PROFIT_MARKET", "TRAILING_STOP_MARKET"]);
const timeInForceSchema = z.enum(["GTC", "IOC", "FOK", "GTX", "GTD"]);
const workingTypeSchema = z.enum(["MARK_PRICE", "CONTRACT_PRICE"]);
const marginTypeSchema = z.enum(["ISOLATED", "CROSSED"]);

export function registerFuturesTools(server: McpServer, client: BinanceClient, config: AppConfig): void {
  const tool = server.tool.bind(server) as unknown as (...args: unknown[]) => void;

  tool("futures_get_server_time", "USD-M Futures: get futures server time.", {}, async () => {
    const r = await client.futuresGet<unknown>("/fapi/v1/time");
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_get_exchange_info", "USD-M Futures: get exchange info, contract symbols, filters, and trading rules.", { symbol: symbolSchema.optional() }, async (args: Record<string, unknown>) => {
    const r = await client.futuresGet<Record<string, unknown>>("/fapi/v1/exchangeInfo");
    const symbol = args.symbol;
    if (typeof symbol === "string" && Array.isArray(r.data.symbols)) {
      return jsonContent(withRateLimit({ ...r.data, symbols: r.data.symbols.filter((item) => typeof item === "object" && item !== null && (item as { symbol?: string }).symbol === symbol) }, r.rateLimit));
    }
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_get_symbol_price", "USD-M Futures: get latest mark/index contract price ticker.", { symbol: symbolSchema.optional() }, async (args: Record<string, unknown>) => {
    const r = await client.futuresGet<unknown>("/fapi/v1/ticker/price", cleanParams(args));
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_get_24hr_ticker", "USD-M Futures: get 24-hour rolling window price statistics.", { symbol: symbolSchema.optional() }, async (args: Record<string, unknown>) => {
    const r = await client.futuresGet<unknown>("/fapi/v1/ticker/24hr", cleanParams(args));
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_get_order_book", "USD-M Futures: get futures order book depth.", { symbol: symbolSchema, limit: z.number().int().min(5).max(1000).optional() }, async (args: Record<string, unknown>) => {
    const r = await client.futuresGet<unknown>("/fapi/v1/depth", { ...cleanParams(args), limit: args.limit ?? 100 });
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_get_klines", "USD-M Futures: get futures candlestick klines.", { symbol: symbolSchema, interval: intervalSchema, startTime: z.number().int().nonnegative().optional(), endTime: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(1500).optional() }, async (args: Record<string, unknown>) => {
    const r = await client.futuresGet<unknown>("/fapi/v1/klines", { ...cleanParams(args), limit: args.limit ?? 500 });
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_get_mark_price", "USD-M Futures: get mark price and funding info.", { symbol: symbolSchema.optional() }, async (args: Record<string, unknown>) => {
    const r = await client.futuresGet<unknown>("/fapi/v1/premiumIndex", cleanParams(args));
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_get_funding_rate", "USD-M Futures: get funding rate history.", { symbol: symbolSchema.optional(), startTime: z.number().int().nonnegative().optional(), endTime: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(1000).optional() }, async (args: Record<string, unknown>) => {
    const r = await client.futuresGet<unknown>("/fapi/v1/fundingRate", cleanParams(args));
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_get_mark_price_klines", "USD-M Futures: get mark price candlestick klines.", { symbol: symbolSchema, interval: intervalSchema, startTime: z.number().int().nonnegative().optional(), endTime: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(1500).optional() }, async (args: Record<string, unknown>) => {
    const r = await client.futuresGet<unknown>("/fapi/v1/markPriceKlines", { ...cleanParams(args), limit: args.limit ?? 500 });
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_get_index_price_klines", "USD-M Futures: get index price candlestick klines.", { pair: z.string().min(1), interval: intervalSchema, startTime: z.number().int().nonnegative().optional(), endTime: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(1500).optional() }, async (args: Record<string, unknown>) => {
    const r = await client.futuresGet<unknown>("/fapi/v1/indexPriceKlines", { ...cleanParams(args), limit: args.limit ?? 500 });
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_get_premium_index_klines", "USD-M Futures: get premium index candlestick klines.", { symbol: symbolSchema, interval: intervalSchema, startTime: z.number().int().nonnegative().optional(), endTime: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(1500).optional() }, async (args: Record<string, unknown>) => {
    const r = await client.futuresGet<unknown>("/fapi/v1/premiumIndexKlines", { ...cleanParams(args), limit: args.limit ?? 500 });
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_get_leverage_bracket", "USD-M Futures signed: get notional and leverage brackets.", { symbol: symbolSchema.optional(), recvWindow: z.number().int().positive().optional() }, async (args: Record<string, unknown>) => {
    ensureFuturesSignedAllowed(config);
    const r = await client.futuresSignedGet<unknown>("/fapi/v1/leverageBracket", cleanParams(args));
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_get_income_history", "USD-M Futures signed: get futures income history such as funding fee, commission, realized PnL.", { symbol: symbolSchema.optional(), incomeType: z.string().optional(), startTime: z.number().int().nonnegative().optional(), endTime: z.number().int().nonnegative().optional(), page: z.number().int().positive().optional(), limit: z.number().int().min(1).max(1000).optional(), recvWindow: z.number().int().positive().optional() }, async (args: Record<string, unknown>) => {
    ensureFuturesSignedAllowed(config);
    const r = await client.futuresSignedGet<unknown>("/fapi/v1/income", { ...cleanParams(args), limit: args.limit ?? 100 });
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_get_position_mode", "USD-M Futures signed: get current position mode, one-way or hedge mode.", { recvWindow: z.number().int().positive().optional() }, async (args: Record<string, unknown>) => {
    ensureFuturesSignedAllowed(config);
    const r = await client.futuresSignedGet<unknown>("/fapi/v1/positionSide/dual", cleanParams(args));
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_change_position_mode", "USD-M Futures signed: change position mode. dualSidePosition=true means hedge mode. Requires confirm=true.", { dualSidePosition: z.boolean(), recvWindow: z.number().int().positive().optional(), confirm: z.boolean() }, async (args: Record<string, unknown>) => {
    ensureFuturesTradingAllowed(config, args.confirm === true, true);
    const r = await client.futuresSignedPost<unknown>("/fapi/v1/positionSide/dual", cleanOrderParams(args));
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_get_account_info", "USD-M Futures signed: get futures account information.", { recvWindow: z.number().int().positive().optional() }, async (args: Record<string, unknown>) => {
    ensureFuturesSignedAllowed(config);
    const r = await client.futuresSignedGet<unknown>("/fapi/v2/account", cleanParams(args));
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_get_balance", "USD-M Futures signed: get futures account balance.", { recvWindow: z.number().int().positive().optional() }, async (args: Record<string, unknown>) => {
    ensureFuturesSignedAllowed(config);
    const r = await client.futuresSignedGet<unknown>("/fapi/v2/balance", cleanParams(args));
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_get_position_risk", "USD-M Futures signed: get current position risk information.", { symbol: symbolSchema.optional(), recvWindow: z.number().int().positive().optional() }, async (args: Record<string, unknown>) => {
    ensureFuturesSignedAllowed(config);
    const r = await client.futuresSignedGet<unknown>("/fapi/v2/positionRisk", cleanParams(args));
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_get_open_orders", "USD-M Futures signed: get current open futures orders.", { symbol: symbolSchema.optional(), recvWindow: z.number().int().positive().optional() }, async (args: Record<string, unknown>) => {
    ensureFuturesSignedAllowed(config);
    const r = await client.futuresSignedGet<unknown>("/fapi/v1/openOrders", cleanParams(args));
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_get_order", "USD-M Futures signed: query a futures order.", { symbol: symbolSchema, orderId: z.number().int().positive().optional(), origClientOrderId: z.string().optional(), recvWindow: z.number().int().positive().optional() }, async (args: Record<string, unknown>) => {
    ensureFuturesSignedAllowed(config);
    const r = await client.futuresSignedGet<unknown>("/fapi/v1/order", cleanParams(args));
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_place_order", "USD-M Futures signed: place a futures order. Requires BINANCE_ENABLE_TRADING=true and confirm=true.", futuresOrderSchema(true), async (args: Record<string, unknown>) => {
    ensureFuturesTradingAllowed(config, args.confirm === true, true);
    const r = await client.futuresSignedPost<unknown>("/fapi/v1/order", cleanOrderParams(args));
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_test_order", "USD-M Futures signed: validate a futures order without placing it.", futuresOrderSchema(false), async (args: Record<string, unknown>) => {
    ensureFuturesTradingAllowed(config, args.confirm === true, false);
    const r = await client.futuresSignedPost<unknown>("/fapi/v1/order/test", cleanOrderParams(args));
    return jsonContent(withRateLimit({ accepted: true, result: r.data }, r.rateLimit));
  });

  tool("futures_cancel_order", "USD-M Futures signed: cancel one futures order. Requires confirm=true.", { symbol: symbolSchema, orderId: z.number().int().positive().optional(), origClientOrderId: z.string().optional(), recvWindow: z.number().int().positive().optional(), confirm: z.boolean() }, async (args: Record<string, unknown>) => {
    ensureFuturesTradingAllowed(config, args.confirm === true, true);
    const r = await client.futuresSignedDelete<unknown>("/fapi/v1/order", cleanOrderParams(args));
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_cancel_open_orders", "USD-M Futures signed: cancel all open futures orders for a symbol. Requires confirm=true.", { symbol: symbolSchema, recvWindow: z.number().int().positive().optional(), confirm: z.boolean() }, async (args: Record<string, unknown>) => {
    ensureFuturesTradingAllowed(config, args.confirm === true, true);
    const r = await client.futuresSignedDelete<unknown>("/fapi/v1/allOpenOrders", cleanOrderParams(args));
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_place_batch_orders", "USD-M Futures signed: place multiple futures orders. Requires confirm=true.", { batchOrders: z.array(z.object(futuresOrderObjectSchema()).passthrough()).min(1).max(5), recvWindow: z.number().int().positive().optional(), confirm: z.boolean() }, async (args: Record<string, unknown>) => {
    ensureFuturesTradingAllowed(config, args.confirm === true, true);
    const params = cleanOrderParams(args);
    const r = await client.futuresSignedPost<unknown>("/fapi/v1/batchOrders", params);
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_cancel_batch_orders", "USD-M Futures signed: cancel multiple futures orders by orderIdList or origClientOrderIdList. Requires confirm=true.", { symbol: symbolSchema, orderIdList: z.array(z.number().int().positive()).min(1).max(10).optional(), origClientOrderIdList: z.array(z.string()).min(1).max(10).optional(), recvWindow: z.number().int().positive().optional(), confirm: z.boolean() }, async (args: Record<string, unknown>) => {
    ensureFuturesTradingAllowed(config, args.confirm === true, true);
    const r = await client.futuresSignedDelete<unknown>("/fapi/v1/batchOrders", cleanOrderParams(args));
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_change_leverage", "USD-M Futures signed: change initial leverage for a symbol. Requires confirm=true.", { symbol: symbolSchema, leverage: z.number().int().min(1).max(125), recvWindow: z.number().int().positive().optional(), confirm: z.boolean() }, async (args: Record<string, unknown>) => {
    ensureFuturesTradingAllowed(config, args.confirm === true, true);
    const r = await client.futuresSignedPost<unknown>("/fapi/v1/leverage", cleanOrderParams(args));
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });

  tool("futures_change_margin_type", "USD-M Futures signed: change margin type for a symbol. Requires confirm=true.", { symbol: symbolSchema, marginType: marginTypeSchema, recvWindow: z.number().int().positive().optional(), confirm: z.boolean() }, async (args: Record<string, unknown>) => {
    ensureFuturesTradingAllowed(config, args.confirm === true, true);
    const r = await client.futuresSignedPost<unknown>("/fapi/v1/marginType", cleanOrderParams(args));
    return jsonContent(withRateLimit(r.data, r.rateLimit));
  });
}

function futuresOrderObjectSchema(): Record<string, z.ZodTypeAny> {
  return {
    symbol: symbolSchema,
    side: sideSchema,
    positionSide: positionSideSchema.optional(),
    type: futuresOrderTypeSchema,
    timeInForce: timeInForceSchema.optional(),
    quantity: z.string().optional(),
    reduceOnly: z.boolean().optional(),
    price: z.string().optional(),
    newClientOrderId: z.string().optional(),
    stopPrice: z.string().optional(),
    closePosition: z.boolean().optional(),
    activationPrice: z.string().optional(),
    callbackRate: z.string().optional(),
    workingType: workingTypeSchema.optional(),
    priceProtect: z.boolean().optional(),
    newOrderRespType: z.enum(["ACK", "RESULT"]).optional(),
  };
}

function futuresOrderSchema(confirmRequired: boolean): Record<string, unknown> {
  return {
    ...futuresOrderObjectSchema(),
    recvWindow: z.number().int().positive().optional(),
    confirm: confirmRequired ? z.boolean() : z.boolean().optional(),
  };
}

function ensureFuturesSignedAllowed(config: AppConfig): void {
  if (!config.apiKey || !config.apiSecret) throw new Error("BINANCE_API_KEY and BINANCE_API_SECRET are required for Futures signed tools.");
}

function ensureFuturesTradingAllowed(config: AppConfig, confirmed: boolean, writeOperation: boolean): void {
  ensureFuturesSignedAllowed(config);
  if (!config.enableTrading) throw new Error("Futures trading tools are disabled. Set BINANCE_ENABLE_TRADING=true to enable them.");
  if (writeOperation && !confirmed) throw new Error("This Futures write operation requires confirm=true.");
  if (writeOperation && config.env === "production" && !config.allowProductionTrading) throw new Error("Production Futures trading is disabled. Set BINANCE_ALLOW_PRODUCTION_TRADING=true only if you intentionally accept real trading risk.");
}

function cleanOrderParams(args: Record<string, unknown>): Record<string, unknown> {
  const params = cleanParams(args);
  delete params.confirm;
  return params;
}

function cleanParams(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}
