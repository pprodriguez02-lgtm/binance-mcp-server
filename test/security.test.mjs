import assert from "node:assert/strict";
import https from "node:https";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { BinanceClient } from "../dist/binance/client.js";
import { registerTradeTools } from "../dist/tools/trade.js";
import { registerSpotAliasTools } from "../dist/tools/spot.js";
import { registerFuturesTools } from "../dist/tools/futures.js";
import { registerCoinFuturesTools } from "../dist/tools/coinFutures.js";

function config(overrides = {}) {
  return {
    env: "demo",
    baseUrl: "https://demo-api.binance.com",
    signedBaseUrl: "https://demo-api.binance.com",
    futuresBaseUrl: "https://testnet.binancefuture.com",
    futuresSignedBaseUrl: "https://testnet.binancefuture.com",
    coinFuturesBaseUrl: "https://testnet.binancefuture.com",
    coinFuturesSignedBaseUrl: "https://testnet.binancefuture.com",
    apiKey: "FAKE_TEST_KEY", apiSecret: "FAKE_TEST_SECRET",
    requestTimeoutMs: 1000, defaultRecvWindow: 5000,
    enableTrading: true, allowProductionTrading: false,
    ...overrides,
  };
}

// Intercept the transport: exercise node-fetch without opening network sockets.
function mockTransport(t, status = 200, location = "https://example.com/leak") {
  const calls = [];
  t.mock.method(https, "request", (url, options) => {
    calls.push({ url, options });
    const request = new Writable({ write(_chunk, _encoding, done) { done(); } });
    request.abort = () => request.destroy();
    request.setTimeout = () => request;
    request.on("finish", () => {
      const response = new PassThrough();
      response.statusCode = status;
      response.headers = { "content-type": "application/json", location };
      response.rawHeaders = ["Content-Type", "application/json", "Location", location];
      request.emit("response", response);
      response.end("{}");
    });
    return request;
  });
  return calls;
}

test("reject unsafe destinations in every configurable API URL", () => {
  const fields = ["baseUrl", "signedBaseUrl", "futuresBaseUrl", "futuresSignedBaseUrl", "coinFuturesBaseUrl", "coinFuturesSignedBaseUrl"];
  const unsafe = [
    "http://api.binance.com", "https://example.com", "https://api.binance.com.example.com",
    "https://evil.api.binance.com", "https://api.binance.com:8443",
    "https://user:password@api.binance.com", "https://api.binance.com/#fragment",
  ];
  for (const field of fields) {
    for (const url of unsafe) assert.throws(() => new BinanceClient(config({ [field]: url })), /Binance API URLs/);
  }
  assert.doesNotThrow(() => new BinanceClient(config({ baseUrl: "https://data-api.binance.vision" })));
  assert.throws(() => new BinanceClient(config({ signedBaseUrl: "https://data-api.binance.vision" })), /Signed requests/);
});

test("absolute request paths cannot escape the host allowlist", async (t) => {
  const calls = mockTransport(t);
  const client = new BinanceClient(config());
  await assert.rejects(() => client.get("https://example.com/leak"), /Binance API URLs/);
  await assert.rejects(() => client.signedGet("//example.com/leak"), /Binance API URLs/);
  assert.equal(calls.length, 0);
});

test("public calls omit the key; all signed methods send a signature and key, never the secret", async (t) => {
  const calls = mockTransport(t);
  const client = new BinanceClient(config());
  for (const method of ["get", "futuresGet", "coinFuturesGet"]) {
    await client[method]("/test");
    assert.equal(calls.at(-1).options.headers["x-mbx-apikey"], undefined);
  }
  for (const method of ["signedGet", "signedPost", "signedDelete", "futuresSignedGet", "futuresSignedPost", "futuresSignedDelete", "coinFuturesSignedGet", "coinFuturesSignedPost", "coinFuturesSignedDelete"]) {
    await client[method]("/test");
    assert.equal(calls.at(-1).options.headers["x-mbx-apikey"], "FAKE_TEST_KEY");
    assert.match(new URL(calls.at(-1).url).searchParams.get("signature"), /^[a-f0-9]{64}$/);
  }
  assert.ok(!JSON.stringify(calls).includes("FAKE_TEST_SECRET"));
});

test("redirects are rejected before a second request, even to another allowed host", async (t) => {
  for (const destination of ["https://example.com/leak", "https://api.binance.com/redirect"]) {
    for (const status of [301, 302, 303, 307, 308]) {
      const calls = mockTransport(t, status, destination);
      const client = new BinanceClient(config());
      await assert.rejects(() => client.signedGet("/api/v3/account"), /redirect/);
      assert.equal(calls.length, 1);
      t.mock.restoreAll();
    }
  }
});

test("every trading write checks actual production destination, environment, enable flag, and confirmation", async () => {
  const families = [
    [registerTradeTools, "signedBaseUrl", "https://api.binance.com"],
    [registerSpotAliasTools, "signedBaseUrl", "https://api.binance.com"],
    [registerFuturesTools, "futuresSignedBaseUrl", "https://fapi.binance.com"],
    [registerCoinFuturesTools, "coinFuturesSignedBaseUrl", "https://dapi.binance.com"],
  ];
  for (const [register, field, productionUrl] of families) {
    const current = config();
    const demoUrl = current[field];
    const handlers = new Map();
    let requests = 0;
    const client = new Proxy({}, { get: () => async () => { requests++; return { data: {}, rateLimit: {} }; } });
    register({ tool: (...args) => handlers.set(args[0], args.at(-1)) }, client, current);
    const writes = [...handlers].filter(([name]) => /(^|_)(place|cancel|change)_/.test(name));
    assert.ok(writes.length > 0);
    for (const [name, handler] of writes) {
      const args = { symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: "0.001", confirm: true };
      requests = 0;
      for (const env of ["demo", "testnet"]) {
        Object.assign(current, { env, [field]: productionUrl, allowProductionTrading: false, enableTrading: true });
        await assert.rejects(() => handler(args), /Production.*disabled/, name);
      }
      Object.assign(current, { env: "production", [field]: demoUrl });
      await assert.rejects(() => handler(args), /Production.*disabled/, name);
      Object.assign(current, { env: "demo", [field]: demoUrl, enableTrading: false });
      await assert.rejects(() => handler(args), /disabled/, name);
      current.enableTrading = true;
      await assert.rejects(() => handler({ ...args, confirm: false }), /confirm=true/, name);
      assert.equal(requests, 0, name);
      await handler(args);
      Object.assign(current, { [field]: productionUrl, allowProductionTrading: true });
      await handler(args);
      assert.equal(requests, 2, name);
    }
  }
});
