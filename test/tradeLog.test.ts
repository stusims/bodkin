import { test } from "node:test";
import assert from "node:assert/strict";
import { fillDeltaPct } from "../src/trade/tradeLog.js";

test("a fill exactly on the quote is zero, not a rounding artefact", () => {
  assert.equal(fillDeltaPct(1_000_000n, 1_000_000n), 0);
  assert.equal(fillDeltaPct(10n ** 27n, 10n ** 27n), 0);
});

test("a worse fill is negative and a better one positive", () => {
  assert.equal(fillDeltaPct(1000n, 990n), -1);      // 1% under the quote
  assert.equal(fillDeltaPct(1000n, 1010n), 1);
  assert.equal(fillDeltaPct(10_000n, 9_950n), -0.5);
});

test("token-sized amounts keep their precision instead of collapsing to a float", () => {
  // 24 digits, divisible by 1000, so exactly 0.1% worse with no truncation anywhere.
  const round = 10n ** 24n;
  assert.equal(fillDeltaPct(round, round - round / 1000n), -0.1);

  // A real quote from the curve, 27 digits. `quoted / 1000n` truncates, so the true answer is
  // fractionally under 0.1%; the point is that it stays exact to the reported resolution rather
  // than collapsing to 0 or NaN the way Number(quoted) would.
  const quoted = 566_880_844_787_501_184_595_951n;
  const delta = fillDeltaPct(quoted, quoted - quoted / 1000n);
  assert.ok(delta !== null && delta < 0 && delta > -0.1, `expected just under -0.1%, got ${delta}`);
  assert.equal(delta, -0.0999);
});

test("nothing to compare gives null rather than a misleading zero", () => {
  assert.equal(fillDeltaPct(undefined, 5n), null);
  assert.equal(fillDeltaPct(5n, undefined), null);
  assert.equal(fillDeltaPct(0n, 5n), null, "a zero quote must not divide by zero");
  assert.equal(fillDeltaPct(undefined, undefined), null);
});
