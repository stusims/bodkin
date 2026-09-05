/**
 * Stage 2 of docs/TRADING-TEST-PLAN.md: run the real --live paths against a forked chain.
 *
 * Start a fork first, pinned to a recent block:
 *
 *   anvil --fork-url https://rpc.mainnet.chain.robinhood.com \
 *         --fork-block-number <recent> --chain-id 4663 --hardfork shanghai
 *
 * then:  node scripts/fork-test.mjs [token]
 *
 * Refuses to run against anything but a local fork, because every step here signs and sends.
 */
import { createWalletClient, http, parseAbi, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.FORK_RPC ?? "http://127.0.0.1:8545";
// anvil's first account. Publicly known and worthless -- never put a real key here.
const KEY = process.env.FORK_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

if (!/127\.0\.0\.1|localhost/.test(RPC)) {
  console.error(`refusing to run: FORK_RPC is ${RPC}, which is not a local fork. This script signs and sends.`);
  process.exit(2);
}
process.env.RPC_URL = RPC;
process.env.RPC_WS_URL = "off";
process.env.PRIVATE_KEY = KEY;
process.env.RPC_IN_FLIGHT ??= "20";
process.env.RPC_SPACING_MS ??= "0";
process.env.RPC_LOGS_SPACING_MS ??= "0";

const { publicClient, robinhood, ADDR } = await import("../dist/chain.js");
const { buildCurveBuy } = await import("../dist/trade/calls.js");
const { buyOnCurve, sellOnCurve } = await import("../dist/trade/curveTrade.js");
const { tokenBalance } = await import("../dist/trade/poolTrade.js");
const { factoryAbi } = await import("../dist/abi/pons.js");

const results = [];
const ok = (name, detail = "") => { results.push(["PASS", name, detail]); console.log(`PASS  ${name}${detail ? `  (${detail})` : ""}`); };
const bad = (name, detail) => { results.push(["FAIL", name, detail]); console.log(`FAIL  ${name}  ${detail}`); };
const skip = (name, why) => { results.push(["SKIP", name, why]); console.log(`SKIP  ${name}  ${why}`); };

const chainId = await publicClient.getChainId();
if (chainId !== 4663) { console.error(`fork reports chain ${chainId}, expected 4663 (start anvil with --chain-id 4663)`); process.exit(2); }
const acct = privateKeyToAccount(KEY);
console.log(`fork ${RPC}  chain ${chainId}  block ${await publicClient.getBlockNumber()}  signer ${acct.address}\n`);

/** Uniswap v4 needs transient storage. A fork of an Arbitrum header runs pre-Cancun, so probe before trying. */
async function hasTransientStorage() {
  try { await publicClient.call({ data: "0x600160005D00" }); return true; } catch { return false; }
}

/** Pick a token still on its curve and paired with ETH; the pool paths need a graduated one instead. */
async function findCurveToken() {
  if (process.argv[2]) return process.argv[2];
  const head = await publicClient.getBlockNumber();
  const logs = await publicClient.getLogs({
    address: ADDR.ponsFactory,
    event: parseAbi(["event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)"])[0],
    fromBlock: head - 2000n,
    toBlock: head,
  });
  for (const l of logs.reverse()) {
    if (l.args.pairToken === "0x0000000000000000000000000000000000000000") return l.args.token;
  }
  return null;
}

const token = await findCurveToken();
if (!token) { console.error("no ETH-paired launch found in the last 2000 blocks; pass a token address as an argument"); process.exit(2); }
const rec = await publicClient.readContract({ address: ADDR.ponsFactory, abi: factoryAbi, functionName: "getLaunchedToken", args: [token] });
if (!rec.exists || rec.phase !== 0) { console.error(`${token} is not a phase-0 pons token on this fork`); process.exit(2); }
console.log(`token ${token}  curve ${rec.curve}\n`);

// 1. curve buy
let bought;
try {
  bought = await buyOnCurve(rec.curve, parseEther("0.05"), 300, false);
  if (!bought.hash || !bought.tokensOut) throw new Error("no hash or no tokens out");
  ok("curve buy sends and settles", `${bought.tokensOut} tokens, ${bought.hash.slice(0, 12)}…`);
} catch (e) { bad("curve buy sends and settles", e.message); }

// 2. erc-20 approve + curve sell (sellOnCurve calls ensureAllowance itself)
try {
  const bal = await tokenBalance(token, acct.address);
  if (bal === 0n) throw new Error("nothing to sell; the buy above must have failed");
  const sold = await sellOnCurve(rec.curve, token, bal / 2n, 300, false);
  if (!sold.hash) throw new Error("no hash");
  ok("erc-20 approve + curve sell settle", `${sold.ethOut} wei out, ${sold.hash.slice(0, 12)}…`);
} catch (e) { bad("erc-20 approve + curve sell settle", e.message); }

// 3. a reverting transaction is seen as reverted, not silently accepted
try {
  const wc = createWalletClient({ account: acct, chain: robinhood, transport: http(RPC) });
  const impossible = buildCurveBuy(rec.curve, 10n ** 16n, 10n ** 30n, acct.address);
  // explicit gas so it is broadcast rather than refused at estimation: the point is the on-chain revert
  const hash = await wc.sendTransaction({ to: impossible.to, data: impossible.data, value: impossible.value, gas: 500_000n });
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  if (rc.status === "success") throw new Error("an impossible minOut was accepted, which should be impossible");
  ok("a reverted buy is detected as reverted", `status=${rc.status}, gasUsed=${rc.gasUsed}`);
} catch (e) { bad("a reverted buy is detected as reverted", e.message); }

// 4. the pool paths, if the fork can run them at all
if (await hasTransientStorage()) {
  skip("v4 buy / permit2 approve / v4 sell", "fork supports TSTORE: wire these up, they are now testable here");
} else {
  skip("v4 buy / permit2 approve / v4 sell", "fork runs pre-Cancun (no TSTORE); Uniswap v4 cannot execute -- see the plan");
}

const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.filter((r) => r[0] === "PASS").length} passed, ${failed} failed, ${results.filter((r) => r[0] === "SKIP").length} skipped`);
process.exit(failed ? 1 : 0);
