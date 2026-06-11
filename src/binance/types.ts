export interface RateLimitInfo {
  usedWeight: string | null;
  usedWeight1m: string | null;
  orderCount10s: string | null;
  orderCount1d: string | null;
}

export interface BinanceResponse<T> {
  data: T;
  rateLimit: RateLimitInfo;
}

export interface ServerTimeResponse {
  serverTime: number;
}

export interface SymbolPriceTicker {
  symbol: string;
  price: string;
}

export interface AvgPriceResponse {
  mins: number;
  price: string;
  closeTime: number;
}

export interface OrderBookResponse {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

export interface RecentTrade {
  id: number;
  price: string;
  qty: string;
  quoteQty: string;
  time: number;
  isBuyerMaker: boolean;
  isBestMatch: boolean;
}

export interface AggregateTrade {
  a: number;
  p: string;
  q: string;
  f: number;
  l: number;
  T: number;
  m: boolean;
  M: boolean;
}

export type Kline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string,
];

export interface Ticker24hr {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  prevClosePrice: string;
  lastPrice: string;
  lastQty: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  firstId: number;
  lastId: number;
  count: number;
}
