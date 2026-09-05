import { BaseError, ContractFunctionRevertedError, decodeAbiParameters, type Address, type Hex } from "viem";
import { publicClient } from "../chain.js";
import type { TxCall } from "./calls.js";

/**
 * Prove a transaction before spending anything on it.
 *
 * `eth_call` runs the same code the miner would, against current state, and costs nothing. With a
 * `stateOverride` funding the sender it does not even need a wallet: this is how `detectRouterLayout`
 * settles which UniversalRouter parameter layout the chain expects, and the same trick works for every
 * call bodkin can build.
 *
 * What this proves: the calldata is well formed, the contract accepts it, and the trade does not revert
 * at this moment. What it does not prove: that it will still hold a block later. On a chain sealing every
 * 100 ms with an opening tax decaying over three seconds, a simulation is evidence, not a guarantee.
 */

/** An address that holds nothing and is nobody, for simulating without a key. Same one v4.ts probes with. */
export const PROBE: Address = "0x000000000000000000000000000000000000bEEF";

export interface SimResult {
  ok: boolean;
  from: Address;
  /** Decoded revert reason, or the plain error, when ok is false. */
  reason?: string;
  /** Raw return data when the call succeeded and returned something. */
  data?: `0x${string}`;
}

const ERROR_STRING = "0x08c379a0"; // Error(string)
const PANIC = "0x4e487b71"; // Panic(uint256)

/**
 * Find the revert payload wherever it ended up. Our RPC gate rethrows the JSON-RPC error object with `data`
 * on it, and viem then wraps that several layers deep, so the useful bytes sit below the "unknown reason"
 * viem reports at the top.
 */
export function revertData(e: unknown): Hex | undefined {
  let node = e as { data?: unknown; cause?: unknown } | undefined;
  for (let depth = 0; node && depth < 8; depth++) {
    const d = node.data;
    if (typeof d === "string" && d.startsWith("0x") && d.length >= 10) return d as Hex;
    node = node.cause as typeof node;
  }
  return undefined;
}

/**
 * Say what the revert was.
 *
 * The pons and Uniswap ABIs here declare no custom errors, so most reverts arrive as an undecodable
 * selector. Rather than call that "unknown", report the selector with its arguments: a slippage failure
 * reads clearly as `0x71c4efed(566881…, 1000000…)` — what you got, then what you demanded.
 */
export function decodeRevert(data: Hex): string {
  const selector = data.slice(0, 10);
  const body = `0x${data.slice(10)}` as Hex;
  try {
    if (selector === ERROR_STRING) return decodeAbiParameters([{ type: "string" }], body)[0] as string;
    if (selector === PANIC) return `Panic(0x${(decodeAbiParameters([{ type: "uint256" }], body)[0] as bigint).toString(16)})`;
  } catch { /* fall through to the raw form */ }
  const words = (data.slice(10).match(/.{64}/g) ?? []).map((w) => BigInt(`0x${w}`).toString());
  return words.length ? `${selector}(${words.join(", ")})` : selector;
}

/** Pull the most specific message available: a named contract error, then the raw revert, then viem's text. */
function explain(e: unknown): string {
  if (e instanceof BaseError) {
    const reverted = e.walk((err) => err instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      const args = reverted.data?.args;
      if (name) return args?.length ? `${name}(${args.join(", ")})` : name;
      if (reverted.reason) return reverted.reason;
    }
  }
  const data = revertData(e);
  if (data) return decodeRevert(data);
  if (e instanceof BaseError) return e.shortMessage || e.message;
  return (e as Error)?.message ?? String(e);
}

/**
 * Simulate one call. Pass `fundWith` to top the sender up for the duration of the call, which is what makes
 * a keyless simulation possible; leave it off to simulate against the sender's real balance, which is the
 * honest test before a live trade.
 */
export async function simulateCall(call: TxCall, from: Address, opts: { fundWith?: bigint } = {}): Promise<SimResult> {
  try {
    const res = await publicClient.call({
      account: from,
      to: call.to,
      data: call.data,
      value: call.value,
      ...(opts.fundWith === undefined ? {} : { stateOverride: [{ address: from, balance: opts.fundWith }] }),
    });
    return { ok: true, from, data: res.data };
  } catch (e) {
    return { ok: false, from, reason: explain(e) };
  }
}

/**
 * Simulate as the configured signer when there is one, otherwise as a funded probe.
 *
 * The difference matters: with a key this runs against your real balance and allowances, so a failure is a
 * real failure. Without one, the balance is invented and anything needing an existing token balance or
 * allowance (a sell, mainly) will still refuse — simulate those from an address that actually holds the token.
 */
export async function simulateAsSigner(call: TxCall, signer: Address | null, headroom = 10n ** 18n): Promise<SimResult> {
  if (signer) return simulateCall(call, signer);
  return simulateCall(call, PROBE, { fundWith: call.value + headroom });
}
