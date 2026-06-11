#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { BinanceClient, BinanceApiError } from "./binance/client.js";
import { registerMarketTools } from "./tools/market.js";
import { registerAnalysisTools } from "./tools/analysis.js";
import { registerTradeTools } from "./tools/trade.js";
import { registerSpotAliasTools } from "./tools/spot.js";
import { registerFuturesTools } from "./tools/futures.js";
import { registerCoinFuturesTools } from "./tools/coinFutures.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new BinanceClient(config);

  const server = new McpServer({
    name: "binance-mcp-server",
    version: "0.1.0",
  });

  registerMarketTools(server, client, config);
  registerAnalysisTools(server, client, config);
  registerTradeTools(server, client, config);
  registerSpotAliasTools(server, client, config);
  registerFuturesTools(server, client, config);
  registerCoinFuturesTools(server, client, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const payload = normalizeError(error);
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(1);
});

function normalizeError(error: unknown): unknown {
  if (error instanceof BinanceApiError) {
    return {
      name: error.name,
      message: error.message,
      status: error.status,
      code: error.code,
      payload: error.payload,
    };
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return error;
}
