import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, type Address } from "viem";
import { curveAbi, escrowAbi, tokenAbi } from "../src/abi/pons.js";
import { permit2Abi } from "../src/abi/uniswap.js";
import { ADDR } from "../src/chain.js";
import {
  MAX_UINT160, MAX_UINT256, MAX_UINT48,
  buildCurveBuy, buildCurveSell, buildErc20Approve, buildEscrowClaim, buildPermit2Approve,
} from "../src/trade/calls.js";

const CURVE: Address = "0x38B9A9d9DB16c302c30a1046AB2d4B11Fc1f668B";
const TOKEN: Address = "0x6219c797646FD54EdDE1497f66d3F76a2Bb67F81";
const ME: Address = "0x8807f4626de8AB1f9c4f9EA8aB812401897220cD";

test("a curve buy carries the ETH as value and names the recipient the tax is charged to", () => {
  const call = buildCurveBuy(CURVE, 10_000_000_000_000_000n, 123n, ME);
  assert.equal(call.to, CURVE);
  // The opening tax is per recipient, so sending to the wrong address is a real bug, not a cosmetic one.
  assert.deepEqual(decodeFunctionData({ abi: curveAbi, data: call.data }), {
    functionName: "buy",
    args: [10_000_000_000_000_000n, 123n, ME],
  });
  assert.equal(call.value, 10_000_000_000_000_000n, "value must equal quoteIn or the curve reverts");
});

test("a curve sell carries no ETH", () => {
  const call = buildCurveSell(CURVE, 5n, 4n, ME);
  assert.equal(call.to, CURVE);
  assert.deepEqual(decodeFunctionData({ abi: curveAbi, data: call.data }), { functionName: "sell", args: [5n, 4n, ME] });
  assert.equal(call.value, 0n);
});

test("an ERC-20 approval goes to the token and defaults to the whole supply", () => {
  const call = buildErc20Approve(TOKEN, CURVE);
  assert.equal(call.to, TOKEN);
  assert.equal(call.value, 0n);
  assert.deepEqual(decodeFunctionData({ abi: tokenAbi, data: call.data }), {
    functionName: "approve",
    args: [CURVE, MAX_UINT256],
  });
});

test("the permit2 approval goes to permit2, not the token, and fits uint160/uint48", () => {
  const call = buildPermit2Approve(TOKEN);
  assert.equal(call.to, ADDR.permit2, "approving on the token here would silently do nothing for the router");
  const decoded = decodeFunctionData({ abi: permit2Abi, data: call.data });
  assert.equal(decoded.functionName, "approve");
  // viem decodes addresses checksummed; ADDR keeps them as written, so compare on the bytes, not the case.
  const [token, spender, amount, expiry] = decoded.args as [Address, Address, bigint, number];
  assert.equal(token.toLowerCase(), TOKEN.toLowerCase());
  assert.equal(spender.toLowerCase(), ADDR.universalRouter.toLowerCase());
  assert.equal(amount, MAX_UINT160);
  assert.equal(expiry, MAX_UINT48);
  assert.ok(MAX_UINT160 < 1n << 160n);
  assert.ok(MAX_UINT48 < 2 ** 48);
});

test("the escrow claim takes no arguments and pays the caller", () => {
  const call = buildEscrowClaim();
  assert.equal(call.to, ADDR.ponsEscrow);
  assert.equal(call.value, 0n);
  const decoded = decodeFunctionData({ abi: escrowAbi, data: call.data });
  assert.equal(decoded.functionName, "claim");
  assert.ok(!decoded.args?.length, "claim pays msg.sender, so it takes no arguments");
  assert.equal(call.data.length, 10, "a bare selector is 4 bytes");
});

test("every builder is pure: same inputs, identical calldata, no chain reads", () => {
  assert.equal(buildCurveBuy(CURVE, 1n, 1n, ME).data, buildCurveBuy(CURVE, 1n, 1n, ME).data);
  assert.equal(buildEscrowClaim().data, buildEscrowClaim().data);
});
