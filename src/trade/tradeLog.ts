import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Address, Hex } from "viem";

/**
 * An append-only record of everything that actually moved money.
 *
 * Marks and quotes are forgotten the moment the terminal scrolls, so "the fills looked about right" is the
 * best anyone can say afterwards. One JSON line per sent transaction fixes that: what was quoted, what
 * arrived, what the gas cost, and the gap between the two. That gap is the number worth watching -- it is
 * the difference between the curve maths being right and merely looking right.
 *
 * Addresses and amounts only. No key material goes near this file, in line with data/ generally.
 */

export interface TradeRecord {
  /** Unix seconds. */
  at: number;
  action: "buy" | "sell" | "approve" | "claim";
  venue: "curve" | "pool" | "escrow";
  token?: Address;
  hash?: Hex;
  /** Decimal strings: bigints do not survive JSON. */
  ethIn?: string;
  tokensQuoted?: string;
  tokensOut?: string;
  tokensIn?: string;
  ethQuoted?: string;
  ethOut?: string;
  minOut?: string;
  gasUsed?: string;
  /** Fill against quote, in percent. Negative means worse than quoted. */
  fillDeltaPct?: number | null;
}

const FILE = resolve(process.cwd(), "data", "trades.jsonl");

/**
 * How far the fill landed from the quote, in percent.
 *
 * Null when there is nothing to compare -- an approve has no quote, and a zero quote would divide by zero.
 * Computed in bigint before touching a float so a 27-digit token amount does not lose its tail.
 */
export function fillDeltaPct(quoted: bigint | undefined, actual: bigint | undefined): number | null {
  if (quoted === undefined || actual === undefined || quoted === 0n) return null;
  return Number(((actual - quoted) * 1_000_000n) / quoted) / 10_000;
}

export function logTrade(r: TradeRecord): void {
  try {
    mkdirSync(resolve(process.cwd(), "data"), { recursive: true });
    appendFileSync(FILE, JSON.stringify(r) + "\n");
  } catch {
    // A trade that settled must never be lost because its receipt could not be written down.
  }
}

export function readTrades(): TradeRecord[] {
  if (!existsSync(FILE)) return [];
  return readFileSync(FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try { return [JSON.parse(line) as TradeRecord]; } catch { return []; }
    });
}
