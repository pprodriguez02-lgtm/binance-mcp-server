# Binance MCP Server

Binance Spot market data and guarded trading MCP server for AI analysis and demo/testnet order workflows.

## Scope

This server exposes public REST market data endpoints, AI-friendly analysis tools, and guarded signed Spot order tools. Trading tools are disabled by default and require explicit environment flags plus `confirm: true` for write operations. Production trading has a separate safety gate.

Supported environments:

- `demo` -> `https://demo-api.binance.com`
- `testnet` -> `https://testnet.binance.vision`
- `production` -> `https://api.binance.com`

`BINANCE_BASE_URL` can override the built-in URL mapping for public market data. `BINANCE_SIGNED_BASE_URL` can override the URL for signed account/order endpoints. This lets you use `https://data-api.binance.vision` for public market data while using `https://demo-api.binance.com`, `https://testnet.binance.vision`, or `https://api.binance.com` for signed endpoints.

API destinations must use HTTPS with the standard port and one of these exact hosts: `api.binance.com`, `fapi.binance.com`, `dapi.binance.com`, `data-api.binance.vision`, `demo-api.binance.com`, `testnet.binance.vision`, or `testnet.binancefuture.com`. Redirects are rejected. The public `data-api.binance.vision` host cannot receive signed requests.

## Tools

### Spot market data

Existing unprefixed tools are Spot-compatible and kept for backward compatibility. New `spot_*` aliases make account type explicit.

- `spot_get_server_time`
- `spot_get_exchange_info`
- `spot_get_symbol_price`
- `spot_get_24hr_ticker`
- `spot_get_order_book`
- `spot_get_recent_trades`
- `spot_get_aggregate_trades`
- `spot_get_klines`
- `spot_get_avg_price`
- `spot_get_ui_klines`

Backward-compatible unprefixed Spot tools:
- `get_server_time`
- `get_exchange_info`
- `get_symbol_price`
- `get_24hr_ticker`
- `get_order_book`
- `get_recent_trades`
- `get_aggregate_trades`
- `get_klines`
- `get_avg_price`
- `get_ui_klines`

### AI-friendly summaries

- `summarize_24hr_ticker`
- `summarize_order_book`
- `summarize_klines`
- `analyze_technical_indicators`
- `analyze_multi_timeframe_trend`
- `compare_symbols`

### Spot trading and signed account tools

- `spot_get_account_info`
- `spot_get_open_orders`
- `spot_get_order`
- `spot_test_order`
- `spot_place_order`
- `spot_cancel_order`
- `spot_cancel_open_orders`

Backward-compatible unprefixed Spot signed tools:
- `test_order`
- `place_order`
- `get_order`
- `get_open_orders`
- `cancel_order`
- `cancel_open_orders`
- `get_account_info`

### USD-M Futures market tools

- `futures_get_server_time`
- `futures_get_exchange_info`
- `futures_get_symbol_price`
- `futures_get_24hr_ticker`
- `futures_get_order_book`
- `futures_get_klines`
- `futures_get_mark_price`
- `futures_get_funding_rate`
- `futures_get_mark_price_klines`
- `futures_get_index_price_klines`
- `futures_get_premium_index_klines`

### USD-M Futures account, position, and trading tools

- `futures_get_account_info`
- `futures_get_balance`
- `futures_get_position_risk`
- `futures_get_open_orders`
- `futures_get_order`
- `futures_get_leverage_bracket`
- `futures_get_income_history`
- `futures_get_position_mode`
- `futures_change_position_mode`
- `futures_test_order`
- `futures_place_order`
- `futures_place_batch_orders`
- `futures_cancel_order`
- `futures_cancel_batch_orders`
- `futures_cancel_open_orders`
- `futures_change_leverage`
- `futures_change_margin_type`

### COIN-M Futures market tools

- `coin_futures_get_server_time`
- `coin_futures_get_exchange_info`
- `coin_futures_get_symbol_price`
- `coin_futures_get_24hr_ticker`
- `coin_futures_get_order_book`
- `coin_futures_get_klines`
- `coin_futures_get_continuous_klines`
- `coin_futures_get_mark_price`
- `coin_futures_get_funding_rate`
- `coin_futures_get_open_interest`

### COIN-M Futures account, position, and trading tools

- `coin_futures_get_account_info`
- `coin_futures_get_balance`
- `coin_futures_get_position_risk`
- `coin_futures_get_income_history`
- `coin_futures_get_leverage_bracket`
- `coin_futures_get_position_mode`
- `coin_futures_change_position_mode`
- `coin_futures_get_open_orders`
- `coin_futures_get_order`
- `coin_futures_test_order`
- `coin_futures_place_order`
- `coin_futures_cancel_order`
- `coin_futures_cancel_open_orders`
- `coin_futures_change_leverage`
- `coin_futures_change_margin_type`

## Install

```bash
npm install
npm run build
```

## Development

```bash
npm run dev
```

## Configuration

Create a `.env` file if you want local overrides. `.env` and its variants are excluded from Git; only a credential-free `.env.example` may be committed.

```env
BINANCE_ENV=demo
BINANCE_BASE_URL=
BINANCE_SIGNED_BASE_URL=
BINANCE_FUTURES_BASE_URL=
BINANCE_FUTURES_SIGNED_BASE_URL=
BINANCE_COIN_FUTURES_BASE_URL=
BINANCE_COIN_FUTURES_SIGNED_BASE_URL=
BINANCE_API_KEY=
BINANCE_API_SECRET=
BINANCE_SECRET_KEY=
BINANCE_PROXY_URL=
BINANCE_DEFAULT_RECV_WINDOW=5000
BINANCE_ENABLE_TRADING=false
BINANCE_ALLOW_PRODUCTION_TRADING=false
BINANCE_REQUEST_TIMEOUT_MS=10000
BINANCE_EXCHANGE_INFO_CACHE_TTL_MS=300000
BINANCE_MAX_KLINES_LIMIT=1000
BINANCE_DEBUG=false
```

## Cursor MCP configuration

After building the project, add a server similar to this in your Cursor MCP configuration:

```json
{
  "mcpServers": {
    "binance": {
      "command": "node",
      "args": [
        "{YOUR_PROJECT_PATH}/dist/index.js"
      ],
      "env": {
        "BINANCE_ENV": "production",
        "BINANCE_BASE_URL": "https://data-api.binance.vision",
        "BINANCE_SIGNED_BASE_URL": "https://api.binance.com",
        "BINANCE_ENABLE_TRADING": "false",
        "BINANCE_ALLOW_PRODUCTION_TRADING": "false",
        "BINANCE_PROXY_URL": "socks5h://127.0.0.1:1080",
        "BINANCE_API_KEY": "{YOUR_BINANCE_API_KEY}",
        "BINANCE_API_SECRET": "{YOUR_BINANCE_API_SECRET}",
        "BINANCE_REQUEST_TIMEOUT_MS": "10000",
        "BINANCE_MAX_KLINES_LIMIT": "1000"
      }
    }
  }
}
```

## Trading safety

Signed account and order tools require `BINANCE_API_KEY` and `BINANCE_API_SECRET`. Trading write operations are disabled by default.

For Demo/Testnet trading:

```env
BINANCE_ENV=demo
BINANCE_API_KEY=your_key
BINANCE_API_SECRET=your_secret
BINANCE_SIGNED_BASE_URL=https://demo-api.binance.com
BINANCE_ENABLE_TRADING=true
BINANCE_ALLOW_PRODUCTION_TRADING=false
```

For production trading, `BINANCE_ALLOW_PRODUCTION_TRADING=true` is also required. This applies when either `BINANCE_ENV=production` or the signed destination is a production host, even with `BINANCE_ENV=demo` or `testnet`. Only enable it if you intentionally accept real trading risk. The `confirm=true` tool argument is not a separate human approval prompt.

Test an order without placing it:

```json
{
  "symbol": "BTCUSDT",
  "side": "BUY",
  "type": "LIMIT",
  "timeInForce": "GTC",
  "quantity": "0.001",
  "price": "50000",
  "confirm": true
}
```

Place an order:

```json
{
  "symbol": "BTCUSDT",
  "side": "BUY",
  "type": "LIMIT",
  "timeInForce": "GTC",
  "quantity": "0.001",
  "price": "50000",
  "confirm": true
}
```

## Analysis examples

Technical indicators:

```json
{
  "symbol": "BTCUSDT",
  "interval": "1h",
  "limit": 200,
  "indicators": ["MA", "EMA", "RSI", "MACD", "BOLL"]
}
```

Multi-timeframe trend:

```json
{
  "symbol": "BTCUSDT",
  "intervals": ["15m", "1h", "4h", "1d"],
  "limit": 200
}
```

Compare symbols:

```json
{
  "symbols": ["BTCUSDT", "ETHUSDT", "BNBUSDT"],
  "interval": "1d",
  "limit": 7
}
```

## Notes

- `get_symbol_price` can return all market prices when `symbol` is omitted.
- Other large market tools require `symbol` or `symbols` to avoid excessive MCP context usage.
- Most tools accept `raw: true` to return the original Binance API payload.
- Only signed requests include the `X-MBX-APIKEY` header. Public market data requests do not send credentials and can be used without API keys.
- `BINANCE_PROXY_URL` can route all Binance REST requests through a proxy, for example `socks5://127.0.0.1:1080`, `socks5h://127.0.0.1:1080`, `http://127.0.0.1:7890`, or `https://127.0.0.1:7890`.
- `BINANCE_API_SECRET` is used locally to sign private account and trading requests; the secret itself is not sent.
- Responses include a `rateLimit` object extracted from Binance response headers when available.
- `exchangeInfo` is cached according to `BINANCE_EXCHANGE_INFO_CACHE_TTL_MS`.
