import { getAddress, isAddress, type Address, type Hex } from "viem";
import { BPS, factoryAbi, tokenAbi } from "../abi/pons.js";
import { permit2Abi } from "../abi/uniswap.js";
import { ADDR, ZERO, publicClient, robinhood } from "../chain.js";
import { minOutFromRate, quoteBuy, quoteSell, readCurveState } from "../pons/curve.js";
import { buildCurveBuy, buildCurveSell, buildErc20Approve, buildEscrowClaim, buildPermit2Approve } from "../trade/calls.js";
import { tokenBalance } from "../trade/poolTrade.js";
import { detectRouterLayout, encodeV4Swap, poolKeyFor, quoteV4 } from "../trade/v4.js";

/**
 * Transactions the board hands to a browser wallet.
 *
 * This is the whole of the wallet path: bodkin works out *what* to send and the person's wallet decides
 * whether to sign it. No key is read here, none is held, and nothing in this file can broadcast — the page
 * passes each step to the wallet, which shows it and asks. That is why this route may exist at all while
 * the automated engine still needs a key in .env: unattended sniping cannot wait for a human to click.
 *
 * A sell can need up to three transactions (ERC-20 approve, Permit2 approve, then the swap), so every plan
 * is an ordered list of steps and the page sends them one at a time.
 */

export interface TxStep {
  label: string;
  to: Address;
  data: Hex;
  /** Hex quantity, ready for eth_sendTransaction. */
  value: Hex;
}

export interface TxPlan {
  chainId: number;
  from: Address;
  venue: "curve" | "pool" | "escrow";
  steps: TxStep[];
  /** What the person is agreeing to, in units they can read, so the page can show it before the wallet does. */
  quote?: { inLabel: string; outLabel: string; minOutLabel: string };
}

export interface WalletCaps {
  /** The most ETH one board buy may spend. A cap here is not a substitute for the wallet's own confirmation. */
  maxBuyWei: bigint;
}

const hex = (n: bigint): Hex => `0x${n.toString(16)}`;
const step = (label: string, call: { to: Address; data: Hex; value: bigint }): TxStep => ({ label, to: call.to, data: call.data, value: hex(call.value) });

/** Reject anything that is not a plain address before it reaches a contract read. */
export function requireAddress(v: unknown, what: string): Address {
  if (typeof v !== "string" || !isAddress(v)) throw new Error(`${what} is not an address`);
  return getAddress(v);
}

/** Parse an ETH amount from the page and hold it to the cap. Rejects NaN, negatives and silly precision. */
export function parseBuyAmount(v: unknown, caps: WalletCaps): bigint {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error("amount must be a positive number of ETH");
  const wei = BigInt(Math.round(n * 1e9)) * 10n ** 9n; // gwei precision is plenty and avoids float dust
  if (wei <= 0n) throw new Error("amount rounds to zero");
  if (wei > caps.maxBuyWei) throw new Error(`amount is above the board's per-buy cap of ${Number(caps.maxBuyWei) / 1e18} ETH`);
  return wei;
}

const fmt = (wei: bigint, dp = 4) => (Number(wei) / 1e18).toFixed(dp);
const fmtTok = (t: bigint) => (Number(t) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 0 });

async function record(token: Address) {
  const rec = await publicClient.readContract({ address: ADDR.ponsFactory, abi: factoryAbi, functionName: "getLaunchedToken", args: [token] });
  if (!rec.exists) throw new Error("not a pons v2 token");
  return rec;
}

/** ETH-paired pools only, same restriction the CLI has in v0.1. */
async function ethPoolKey(token: Address) {
  const { key, pairToken, phase } = await poolKeyFor(token);
  if (phase !== 2) throw new Error(`token is in phase ${phase}, no pool to trade`);
  if (pairToken !== ZERO) throw new Error("pool is paired with a token, not ETH; the board trades ETH pairs only");
  return key;
}

export async function planBuy(from: Address, token: Address, ethIn: bigint, slippageBps: number): Promise<TxPlan> {
  const rec = await record(token);
  if (rec.phase === 0) {
    const state = await readCurveState(rec.curve, from);
    const q = quoteBuy(state, ethIn);
    const minOut = minOutFromRate(q.tokensOut, slippageBps);
    return {
      chainId: robinhood.id, from, venue: "curve",
      steps: [step("buy on the curve", buildCurveBuy(rec.curve, ethIn, minOut, from))],
      quote: { inLabel: `${fmt(ethIn)} ETH`, outLabel: `${fmtTok(q.tokensOut)} tokens`, minOutLabel: `${fmtTok(minOut)} tokens` },
    };
  }
  const key = await ethPoolKey(token);
  const quoted = await quoteV4(key, true, ethIn);
  const minOut = (quoted * (BPS - BigInt(slippageBps))) / BPS;
  const layout = await detectRouterLayout(key);
  return {
    chainId: robinhood.id, from, venue: "pool",
    steps: [step("buy on the v4 pool", encodeV4Swap(key, true, ethIn, minOut, layout))],
    quote: { inLabel: `${fmt(ethIn)} ETH`, outLabel: `${fmtTok(quoted)} tokens`, minOutLabel: `${fmtTok(minOut)} tokens` },
  };
}

export async function planSell(from: Address, token: Address, pct: number, slippageBps: number): Promise<TxPlan> {
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw new Error("percent must be between 0 and 100");
  const balance = await tokenBalance(token, from);
  if (balance === 0n) throw new Error("this wallet holds none of that token");
  const tokensIn = (balance * BigInt(Math.round(pct * 100))) / 10_000n;
  if (tokensIn === 0n) throw new Error("that percentage rounds to zero tokens");

  const rec = await record(token);
  const steps: TxStep[] = [];

  if (rec.phase === 0) {
    const state = await readCurveState(rec.curve, from);
    if (state.graduated || state.readyToGraduate) throw new Error("the curve is closed; sell on the pool once it has graduated");
    const allowance = await publicClient.readContract({ address: token, abi: tokenAbi, functionName: "allowance", args: [from, rec.curve] });
    if (allowance < tokensIn) steps.push(step("approve the curve to move your tokens", buildErc20Approve(token, rec.curve)));
    const ethQuoted = quoteSell(state, tokensIn);
    steps.push(step("sell on the curve", buildCurveSell(rec.curve, tokensIn, minOutFromRate(ethQuoted, slippageBps), from)));
    return {
      chainId: robinhood.id, from, venue: "curve", steps,
      quote: { inLabel: `${fmtTok(tokensIn)} tokens`, outLabel: `${fmt(ethQuoted)} ETH`, minOutLabel: `${fmt(minOutFromRate(ethQuoted, slippageBps))} ETH` },
    };
  }

  // Pool side: the router pulls the token through Permit2, so both approvals may be needed first.
  const key = await ethPoolKey(token);
  const erc20 = await publicClient.readContract({ address: token, abi: tokenAbi, functionName: "allowance", args: [from, ADDR.permit2] });
  if (erc20 < tokensIn) steps.push(step("approve Permit2 to move your tokens", buildErc20Approve(token, ADDR.permit2)));
  const [p2amount, p2exp] = await publicClient.readContract({ address: ADDR.permit2, abi: permit2Abi, functionName: "allowance", args: [from, token, ADDR.universalRouter] });
  if (p2amount < tokensIn || p2exp < Math.floor(Date.now() / 1000) + 600) steps.push(step("let Permit2 fund the router", buildPermit2Approve(token)));
  const quoted = await quoteV4(key, false, tokensIn);
  const minOut = (quoted * (BPS - BigInt(slippageBps))) / BPS;
  const layout = await detectRouterLayout(key);
  steps.push(step("sell on the v4 pool", encodeV4Swap(key, false, tokensIn, minOut, layout)));
  return {
    chainId: robinhood.id, from, venue: "pool", steps,
    quote: { inLabel: `${fmtTok(tokensIn)} tokens`, outLabel: `${fmt(quoted)} ETH`, minOutLabel: `${fmt(minOut)} ETH` },
  };
}

export function planClaim(from: Address): TxPlan {
  return { chainId: robinhood.id, from, venue: "escrow", steps: [step("claim your creator fees", buildEscrowClaim())] };
}
