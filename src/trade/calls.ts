import { encodeFunctionData, type Address, type Hex } from "viem";
import { curveAbi, escrowAbi, tokenAbi } from "../abi/pons.js";
import { permit2Abi } from "../abi/uniswap.js";
import { ADDR } from "../chain.js";

/**
 * Every transaction bodkin can send, as unsigned calldata.
 *
 * Building a call and signing it are separate steps on purpose. The same `{to, data, value}` can be
 * eth_call'd for free to prove it works (see simulate.ts), signed here with the key from .env, or handed
 * to a browser wallet that signs it without bodkin ever holding a key. Nothing in this file signs, sends,
 * reads chain state, or needs an account: it is pure encoding, so it is cheap to test exhaustively.
 *
 * `encodeV4Swap` in ./v4.ts is the same shape and belongs to this set; it lives there because the pool key
 * and the router's two parameter layouts are v4 concerns.
 */

export interface TxCall {
  to: Address;
  data: Hex;
  /** Native ETH sent with the call. Zero for everything except a curve buy and a v4 buy. */
  value: bigint;
}

/** Approve the whole supply. The curve and Permit2 both pull tokens, and re-approving per trade costs a transaction. */
export const MAX_UINT256 = (1n << 256n) - 1n;
export const MAX_UINT160 = (1n << 160n) - 1n;
export const MAX_UINT48 = Number((1n << 48n) - 1n);

/** Buy on the bonding curve. `recipient` matters: the opening tax is charged per recipient, not per sender. */
export function buildCurveBuy(curve: Address, ethIn: bigint, minOut: bigint, recipient: Address): TxCall {
  return {
    to: curve,
    data: encodeFunctionData({ abi: curveAbi, functionName: "buy", args: [ethIn, minOut, recipient] }),
    value: ethIn,
  };
}

/** Sell back to the bonding curve. Needs an ERC-20 allowance to the curve first. */
export function buildCurveSell(curve: Address, tokensIn: bigint, minOut: bigint, recipient: Address): TxCall {
  return {
    to: curve,
    data: encodeFunctionData({ abi: curveAbi, functionName: "sell", args: [tokensIn, minOut, recipient] }),
    value: 0n,
  };
}

/** Plain ERC-20 approval: token -> spender (the curve, or Permit2 on the pool side). */
export function buildErc20Approve(token: Address, spender: Address, amount = MAX_UINT256): TxCall {
  return {
    to: token,
    data: encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [spender, amount] }),
    value: 0n,
  };
}

/** The second half of the Permit2 dance: Permit2 -> UniversalRouter, with an expiry. */
export function buildPermit2Approve(
  token: Address,
  spender: Address = ADDR.universalRouter,
  amount: bigint = MAX_UINT160,
  expiration: number = MAX_UINT48,
): TxCall {
  return {
    to: ADDR.permit2,
    data: encodeFunctionData({ abi: permit2Abi, functionName: "approve", args: [token, spender, amount, expiration] }),
    value: 0n,
  };
}

/** Claim accrued creator fees from the pons escrow. Pays to the caller, so it takes no arguments. */
export function buildEscrowClaim(): TxCall {
  return {
    to: ADDR.ponsEscrow,
    data: encodeFunctionData({ abi: escrowAbi, functionName: "claim" }),
    value: 0n,
  };
}
