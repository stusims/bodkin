import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters } from "viem";
import { decodeRevert, revertData } from "../src/trade/simulate.js";

const withString = (s: string) =>
  `0x08c379a0${encodeAbiParameters([{ type: "string" }], [s]).slice(2)}` as const;

test("a plain require(string) revert reads back as its message", () => {
  assert.equal(decodeRevert(withString("curve is closed")), "curve is closed");
});

test("a panic reports its code rather than pretending to be a message", () => {
  const data = `0x4e487b71${encodeAbiParameters([{ type: "uint256" }], [0x11n]).slice(2)}` as const;
  assert.equal(decodeRevert(data), "Panic(0x11)");
});

test("an undeclared custom error reports its selector and arguments, not 'unknown'", () => {
  // The real slippage revert seen on the curve: what you got, then what you demanded.
  const data =
    "0x71c4efed" +
    "00000000000000000000000000000000000000000000780aac1386cb444c37ef" +
    "000000000000000000000000000000000000000c9f2c9cd04674edea40000000";
  assert.equal(
    decodeRevert(data as `0x${string}`),
    "0x71c4efed(566880844787501184595951, 1000000000000000000000000000000)",
  );
});

test("a bare selector with no arguments still names itself", () => {
  assert.equal(decodeRevert("0xdeadbeef"), "0xdeadbeef");
});

test("revert data is found however deeply viem wrapped it", () => {
  // The gate rethrows the JSON-RPC error with `data`; viem then wraps it several layers up.
  const inner = Object.assign(new Error("execution reverted"), { data: "0xdeadbeef00" });
  const wrapped = Object.assign(new Error("outer"), { cause: Object.assign(new Error("mid"), { cause: inner }) });
  assert.equal(revertData(wrapped), "0xdeadbeef00");
});

test("an error carrying no revert data returns nothing rather than guessing", () => {
  assert.equal(revertData(new Error("fetch failed")), undefined);
  assert.equal(revertData(undefined), undefined);
  // A short or non-hex `data` is not a revert payload.
  assert.equal(revertData(Object.assign(new Error("x"), { data: "0x12" })), undefined);
});
