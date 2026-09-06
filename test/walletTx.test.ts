import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBuyAmount, requireAddress, type WalletCaps } from "../src/board/walletTx.js";

const caps: WalletCaps = { maxBuyWei: 10n ** 16n }; // 0.01 ETH

test("a buy amount is held to the board's cap", () => {
  assert.equal(parseBuyAmount(0.005, caps), 5_000_000_000_000_000n);
  assert.equal(parseBuyAmount("0.01", caps), 10_000_000_000_000_000n, "exactly the cap is allowed");
  assert.throws(() => parseBuyAmount(0.02, caps), /per-buy cap/);
  assert.throws(() => parseBuyAmount(1000, caps), /per-buy cap/);
});

test("anything that is not a positive number of ETH is refused before it reaches a contract", () => {
  for (const bad of [0, -1, NaN, Infinity, "", "abc", null, undefined, {}]) {
    assert.throws(() => parseBuyAmount(bad as unknown, caps), /positive number|rounds to zero/, `accepted ${JSON.stringify(bad)}`);
  }
});

test("a dust amount rounds to zero rather than sending an empty buy", () => {
  assert.throws(() => parseBuyAmount(1e-15, caps), /rounds to zero/);
});

test("addresses are checksummed, and non-addresses are refused", () => {
  assert.equal(
    requireAddress("0x8807f4626de8ab1f9c4f9ea8ab812401897220cd", "from"),
    "0x8807f4626de8AB1f9c4f9EA8aB812401897220cD",
  );
  for (const bad of ["", "0x", "not-an-address", "0x1234", 42, null, undefined]) {
    assert.throws(() => requireAddress(bad as unknown, "token"), /token is not an address/);
  }
});
