import { test } from "node:test";
import assert from "node:assert/strict";
import { isTransientRpcError } from "../src/util/rpcGate.js";
import { retry } from "../src/util/retry.js";

test("a log query timeout is transient however the endpoint codes it", () => {
  // What the logs endpoint actually returns for a wide eth_getLogs range: an invalid-params
  // code carrying a timeout message. Read by code alone it looks like a client mistake.
  assert.equal(isTransientRpcError({ code: -32602, message: "log query timed out" }), true);
  assert.equal(isTransientRpcError({ code: -32000, message: "request timeout" }), true);
  assert.equal(isTransientRpcError({ code: 429, message: "too many requests" }), true);
});

test("a real client error still throws instead of burning retries", () => {
  assert.equal(isTransientRpcError({ code: -32602, message: "invalid argument 0: hex string too long" }), false);
  assert.equal(isTransientRpcError({ code: 3, message: "execution reverted" }), false);
  assert.equal(isTransientRpcError({}), false);
});

test("retry treats 'timed out' as transient, not just 'timeout'", async () => {
  let calls = 0;
  const value = await retry(async () => {
    calls++;
    if (calls === 1) throw new Error("Missing or invalid parameters.\n\nDetails: log query timed out");
    return "ok";
  }, 3, 1);
  assert.equal(value, "ok");
  assert.equal(calls, 2, "the first failure should have been retried");
});

test("retry gives up loudly on an error that is not transient", async () => {
  let calls = 0;
  await assert.rejects(
    () => retry(async () => { calls++; throw new Error("execution reverted"); }, 3, 1),
    /execution reverted/,
  );
  assert.equal(calls, 1, "a reverted call should not be retried");
});
