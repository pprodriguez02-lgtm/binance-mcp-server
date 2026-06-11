import { z } from "zod";

export const rawOptionSchema = {
  raw: z.boolean().optional().describe("Return the raw Binance API payload instead of an AI-friendly formatted response."),
};

export const symbolSchema = z.string().trim().min(1).transform((value) => value.toUpperCase());

export const intervalSchema = z.enum([
  "1s",
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "8h",
  "12h",
  "1d",
  "3d",
  "1w",
  "1M",
]);

export const orderBookLimitSchema = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(20),
  z.literal(50),
  z.literal(100),
  z.literal(500),
  z.literal(1000),
  z.literal(5000),
]);

export function clampLimit(value: number | undefined, defaultValue: number, maxValue: number): number {
  const limit = value ?? defaultValue;
  return Math.max(1, Math.min(limit, maxValue));
}
