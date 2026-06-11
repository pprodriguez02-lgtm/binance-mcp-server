import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { BinanceClient } from "../binance/client.js";
import { jsonContent, withRateLimit } from "./market.js";
import { symbolSchema } from "./schemas.js";

const sideSchema = z.enum(["BUY", "SELL"]);
const orderTypeSchema = z.enum(["LIMIT", "MARKET", "STOP_LOSS", "STOP_LOSS_LIMIT", "TAKE_PROFIT", "TAKE_PROFIT_LIMIT", "LIMIT_MAKER"]);
const timeInForceSchema = z.enum(["GTC", "IOC", "FOK"]);
const responseTypeSchema = z.enum(["ACK", "RESULT", "FULL"]);

const orderParamsSchema = {
  symbol: symbolSchema,
  side: sideSchema,
  type: orderTypeSchema,
  quantity: z.string().optional(),
  quoteOrderQty: z.string().optional(),
  price: z.string().optional(),
  timeInForce: timeInForceSchema.optional(),
  stopPrice: z.string().optional(),
  trailingDelta: z.number().int().positive().optional(),
  icebergQty: z.string().optional(),
  newClientOrderId: z.string().optional(),
  newOrderRespType: responseTypeSchema.optional(),
  selfTradePreventionMode: z.string().optional(),
  recvWindow: z.number().int().positive().optional(),
};

export function registerTradeTools(server: McpServer, client: BinanceClient, config: AppConfig): void {
  const tool = server.tool.bind(server) as unknown as (...args: unknown[]) => void;

  tool(
    "test_order",
    "Validate a signed Spot order without placing it. Requires API key/secret and trading enabled.",
    {
      ...orderParamsSchema,
      confirm: z.boolean().optional(),
    },
    async (args: Record<string, unknown>) => {
      ensureTradingAllowed(config, args.confirm === true, false);
      const response = await client.signedPost<unknown>("/api/v3/order/test", cleanOrderParams(args));
      return jsonContent(withRateLimit({ accepted: true, result: response.data }, response.rateLimit));
    },
  );

  tool(
    "place_order",
    "Place a signed Spot order. Requires BINANCE_ENABLE_TRADING=true and confirm=true. Production trading additionally requires BINANCE_ALLOW_PRODUCTION_TRADING=true.",
    {
      ...orderParamsSchema,
      confirm: z.boolean(),
    },
    async (args: Record<string, unknown>) => {
      ensureTradingAllowed(config, args.confirm === true, true);
      const response = await client.signedPost<unknown>("/api/v3/order", cleanOrderParams(args));
      return jsonContent(withRateLimit(response.data, response.rateLimit));
    },
  );

  tool(
    "get_order",
    "Query a signed Spot order by orderId or origClientOrderId.",
    {
      symbol: symbolSchema,
      orderId: z.number().int().positive().optional(),
      origClientOrderId: z.string().optional(),
      recvWindow: z.number().int().positive().optional(),
    },
    async (args: Record<string, unknown>) => {
      ensureSignedReadAllowed(config);
      const response = await client.signedGet<unknown>("/api/v3/order", cleanParams(args));
      return jsonContent(withRateLimit(response.data, response.rateLimit));
    },
  );

  tool(
    "get_open_orders",
    "Query signed open Spot orders. Symbol is optional; omitting it may return all open orders.",
    {
      symbol: symbolSchema.optional(),
      recvWindow: z.number().int().positive().optional(),
    },
    async (args: Record<string, unknown>) => {
      ensureSignedReadAllowed(config);
      const response = await client.signedGet<unknown>("/api/v3/openOrders", cleanParams(args));
      return jsonContent(withRateLimit(response.data, response.rateLimit));
    },
  );

  tool(
    "cancel_order",
    "Cancel a signed Spot order. Requires trading enabled and confirm=true.",
    {
      symbol: symbolSchema,
      orderId: z.number().int().positive().optional(),
      origClientOrderId: z.string().optional(),
      newClientOrderId: z.string().optional(),
      recvWindow: z.number().int().positive().optional(),
      confirm: z.boolean(),
    },
    async (args: Record<string, unknown>) => {
      ensureTradingAllowed(config, args.confirm === true, true);
      const response = await client.signedDelete<unknown>("/api/v3/order", cleanParams(args));
      return jsonContent(withRateLimit(response.data, response.rateLimit));
    },
  );

  tool(
    "cancel_open_orders",
    "Cancel all open Spot orders on a symbol. Requires trading enabled and confirm=true.",
    {
      symbol: symbolSchema,
      recvWindow: z.number().int().positive().optional(),
      confirm: z.boolean(),
    },
    async (args: Record<string, unknown>) => {
      ensureTradingAllowed(config, args.confirm === true, true);
      const response = await client.signedDelete<unknown>("/api/v3/openOrders", cleanParams(args));
      return jsonContent(withRateLimit(response.data, response.rateLimit));
    },
  );

  tool(
    "get_account_info",
    "Query signed Spot account information. Requires API key/secret.",
    {
      omitZeroBalances: z.boolean().optional(),
      recvWindow: z.number().int().positive().optional(),
    },
    async (args: Record<string, unknown>) => {
      ensureSignedReadAllowed(config);
      const response = await client.signedGet<unknown>("/api/v3/account", cleanParams(args));
      return jsonContent(withRateLimit(response.data, response.rateLimit));
    },
  );
}

function ensureSignedReadAllowed(config: AppConfig): void {
  if (config.signedBaseUrl.includes("data-api.binance.vision")) {
    throw new Error("Signed tools cannot use data-api.binance.vision. Set BINANCE_SIGNED_BASE_URL to a trading API URL such as https://demo-api.binance.com, https://testnet.binance.vision, or https://api.binance.com.");
  }
  if (!config.apiKey || !config.apiSecret) {
    throw new Error("BINANCE_API_KEY and BINANCE_API_SECRET are required for signed tools.");
  }
}

function ensureTradingAllowed(config: AppConfig, confirmed: boolean, writeOperation: boolean): void {
  ensureSignedReadAllowed(config);
  if (!config.enableTrading) {
    throw new Error("Trading tools are disabled. Set BINANCE_ENABLE_TRADING=true to enable test/order/cancel tools.");
  }
  if (writeOperation && !confirmed) {
    throw new Error("This write operation requires confirm=true.");
  }
  if (writeOperation && config.env === "production" && !config.allowProductionTrading) {
    throw new Error("Production trading is disabled. Set BINANCE_ALLOW_PRODUCTION_TRADING=true only if you intentionally accept real trading risk.");
  }
}

function cleanOrderParams(args: Record<string, unknown>): Record<string, unknown> {
  const params = cleanParams(args);
  delete params.confirm;
  return params;
}

function cleanParams(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}
