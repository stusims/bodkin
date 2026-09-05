/**
 * Stage 3 of docs/TRADING-TEST-PLAN.md: the first real money, as small and as guarded as possible.
 *
 * A minimal round trip on one curve -- simulate, buy, wait, sell -- recording quoted vs actual at each
 * step. Its job is not to make money. Its job is to prove that the code which has only ever run against
 * a fork does the same thing against the real chain, for the cost of two lots of gas and a round-trip fee.
 *
 *   node scripts/first-trade.mjs <token> [eth]        # default 0.001 ETH
 *
 * It will not run without I_HAVE_READ_THE_PLAN=yes in the environment, it refuses anything above 0.005
 * ETH, and it refuses a wallet holding more than 0.05 ETH -- use a burner funded with what you can lose.
 * Every step is printed before it is sent, and the simulation must pass before the buy is signed.
 */
import { formatEther, parseEther } from "viem";

const CEILING = parseEther("0.005");      // the most this script will ever spend in one buy
const WALLET_CEILING = parseEther("0.05"); // refuse to touch a wallet that is not a burner

const token = process.argv[2];
const amount = parseEther(process.argv[3] ?? "0.001");

if (!token || !/^0x[0-9a-fA-F]{40}$/.test(token)) {
  console.error("usage: node scripts/first-trade.mjs <token> [eth]\n\nRead docs/TRADING-TEST-PLAN.md first: this spends real ETH.");
  process.exit(2);
}
if (process.env.I_HAVE_READ_THE_PLAN !== "yes") {
  console.error("refusing to run.\n\nThis script signs real transactions with real ETH. Read docs/TRADING-TEST-PLAN.md,\nthen set I_HAVE_READ_THE_PLAN=yes to confirm you meant it.");
  process.exit(2);
}
if (amount > CEILING) {
  console.error(`refusing ${formatEther(amount)} ETH: this script is capped at ${formatEther(CEILING)} ETH. A first trade should be boring.`);
  process.exit(2);
}

const { publicClient, ADDR } = await import("../dist/chain.js");
const { factoryAbi } = await import("../dist/abi/pons.js");
const { getAccount } = await import("../dist/trade/wallet.js");
const { buyOnCurve, sellOnCurve } = await import("../dist/trade/curveTrade.js");
const { tokenBalance } = await import("../dist/trade/poolTrade.js");
const { buildCurveBuy } = await import("../dist/trade/calls.js");
const { simulateAsSigner } = await import("../dist/trade/simulate.js");
const { minOutFromRate, quoteBuy, readCurveState } = await import("../dist/pons/curve.js");
const { readTrades } = await import("../dist/trade/tradeLog.js");

const acct = getAccount();
if (!acct) { console.error("PRIVATE_KEY is not set; this stage needs a funded burner wallet."); process.exit(2); }

const chainId = await publicClient.getChainId();
const balance = await publicClient.getBalance({ address: acct.address });
console.log(`chain ${chainId}  wallet ${acct.address}  balance ${formatEther(balance)} ETH`);
if (balance > WALLET_CEILING) {
  console.error(`\nrefusing: this wallet holds ${formatEther(balance)} ETH, more than the ${formatEther(WALLET_CEILING)} ETH a burner should.\nUse a fresh wallet funded with only what you are willing to lose.`);
  process.exit(2);
}
if (balance < amount * 2n) { console.error(`balance will not cover the buy plus gas and the sell`); process.exit(2); }

const rec = await publicClient.readContract({ address: ADDR.ponsFactory, abi: factoryAbi, functionName: "getLaunchedToken", args: [token] });
if (!rec.exists) { console.error("not a pons v2 token"); process.exit(2); }
if (rec.phase !== 0) { console.error(`token is in phase ${rec.phase}; stage 3 is the curve. The pool is stage 4.`); process.exit(2); }
if (rec.pairToken !== "0x0000000000000000000000000000000000000000") { console.error("this token is not ETH-paired"); process.exit(2); }

// 1. Simulate the exact buy first. If it will not execute, nothing is signed.
const state = await readCurveState(rec.curve, acct.address);
const q = quoteBuy(state, amount);
const minOut = minOutFromRate(q.tokensOut, 300);
console.log(`\nquote  ${formatEther(amount)} ETH -> ${q.tokensOut} tokens (min ${minOut}), opening tax ${Number(state.openingTaxBps) / 100}%`);
if (state.openingTaxBps > 300n) { console.error(`opening tax is ${Number(state.openingTaxBps) / 100}% right now; wait for it to decay before buying by hand`); process.exit(2); }

const sim = await simulateAsSigner(buildCurveBuy(rec.curve, amount, minOut, acct.address), acct.address);
if (!sim.ok) { console.error(`simulation reverted, so nothing was sent: ${sim.reason}`); process.exit(1); }
console.log("simulate ok — the buy would execute against current state");

// 2. Buy.
console.log(`\nbuying ${formatEther(amount)} ETH…`);
const bought = await buyOnCurve(rec.curve, amount, 300, false);
console.log(`bought  ${bought.tokensOut} tokens  gas ${bought.gasUsed}  ${bought.hash}`);

// 3. Sit for a moment, then sell everything back.
await new Promise((r) => setTimeout(r, 5_000));
const held = await tokenBalance(token, acct.address);
console.log(`\nholding ${held} tokens; selling all of it back`);
const sold = await sellOnCurve(rec.curve, token, held, 300, false);
console.log(`sold    ${formatEther(sold.ethOut)} ETH  gas ${sold.gasUsed}  ${sold.hash}`);

// 4. What the round trip actually cost.
const after = await publicClient.getBalance({ address: acct.address });
const trades = readTrades().slice(-3);
console.log(`\nround trip  in ${formatEther(amount)} ETH  out ${formatEther(sold.ethOut)} ETH  net ${formatEther(after - balance)} ETH including gas`);
for (const t of trades) {
  console.log(`  ${t.action.padEnd(7)} ${t.venue.padEnd(5)} fill vs quote ${t.fillDeltaPct === null || t.fillDeltaPct === undefined ? "n/a" : t.fillDeltaPct.toFixed(3) + "%"}  gas ${t.gasUsed ?? "?"}`);
}
console.log("\nwritten to data/trades.jsonl — this is the evidence stage 3 asks for.");
