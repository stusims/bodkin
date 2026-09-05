# Trading test plan

Every line of code that can move money is, as of 2026-09-05, unexecuted. There are seven send sites:

```
cli-trade.ts        escrow claim
trade/curveTrade.ts curve buy · ERC-20 approve · curve sell
trade/poolTrade.ts  v4 swap (buy) · Permit2 approve · v4 swap (sell)
```

The test suite covers curve math, scoring, exit-rule arithmetic, v4 calldata encoding, the deployer index, feed
failover and RPC error classification — all pure functions. None of it exercises submission, receipts, reverts,
nonces, gas, or the allowance dance.

Dry run does not close that gap. `buyOnPool` returns before `detectRouterLayout` and `encodeV4Swap` are ever
called, and `buyOnCurve` returns before the transaction is built. **A dry run proves the quote, not the send.**

This plan closes it in six stages, cheapest risk first. Stages 0–2 cost nothing.

---

## Stage 0 — unsigned call builders

Split every send site into a builder that returns `{to, data, value}` and a sender that signs it. `encodeV4Swap`
already works this way; the curve, approve and claim paths use `writeContract` and need `encodeFunctionData`.

Do this first: it is what makes both Stage 1 (simulation) and browser-wallet signing possible, and it is a pure
refactor with no behaviour change.

**Done when** every send site is `build*` + `sendCall`, and tests assert each builder's calldata decodes back to
the expected function and arguments.

## Stage 1 — `--simulate`

`detectRouterLayout` already proves the technique: `eth_call` with a `stateOverride` that funds a probe address,
so a swap can be simulated with no key and no gas.

Generalise it. `--simulate` builds the real calldata and `eth_call`s it, reporting success or the decoded revert
reason. With a `PRIVATE_KEY` set it simulates from the real address (true balances and allowances); without one it
simulates from a funded probe.

A sell needs a token balance, so simulating one from a probe address reverts. Simulate sells from a real holder,
or leave them to Stage 2. `claim` is account-scoped — it pays `msg.sender` — so `claim --simulate` needs a key
and is only meaningful for a wallet that has fees accrued.

Reverts are reported, not swallowed. The pons and Uniswap ABIs here declare no custom errors, so a slippage
failure arrives as an undecodable selector; rather than call that unknown, it is printed with its arguments:

```
simulate reverted  curve buy as a funded probe
  0x71c4efed(566880844787501184595951, 1000000000000000000000000000000)
```

— what you would have received, then what you demanded.

**Done when** `buy --simulate` runs green with no key configured, and a deliberately impossible `minOut`
reports the revert rather than claiming success.

## Stage 2 — Anvil fork

```sh
anvil --fork-url https://rpc.mainnet.chain.robinhood.com \
      --fork-block-number <recent> --chain-id 4663 --hardfork shanghai

node scripts/fork-test.mjs        # signs and sends against the fork; refuses a non-local RPC
```

`scripts/fork-test.mjs` finds an ETH-paired launch still on its curve, buys, sells, and checks that a
transaction which must revert is *seen* to revert. Process env beats `.env`, so the script points bodkin at the
fork without touching your config.

A fork receives no new launches, so this tests execution, not detection — detection is already proven by `hunt`.
It has none of the sequencer's 100 ms blocks or arrival ordering either, which is fine: latency is not what is
being tested here.

### What it covers, and what it cannot

Run on 2026-09-05 against a fork at block 55397567:

```
PASS  curve buy sends and settles              26,078,845 tokens
PASS  erc-20 approve + curve sell settle       24842071187658107 wei out
PASS  a reverted buy is detected as reverted   status=reverted, gasUsed=52880
SKIP  v4 buy / permit2 approve / v4 sell       fork runs pre-Cancun (no TSTORE)
```

**Three of the seven send sites now execute.** The other four do not, for two separate reasons:

- **The pool paths cannot run on a fork of this chain.** Robinhood Chain is Arbitrum Nitro: its block headers
  carry `l1BlockNumber`, `sendRoot` and `sendCount`, and no `excessBlobGas`. Anvil derives its EVM spec from
  those headers and settles on a pre-Cancun one whatever `--hardfork` says — `cancun` and `prague` both give
  `Excess blob gas not set` or fall back silently. Confirmed with a six-byte probe: `TSTORE` (`0x600160005D00`)
  and `MCOPY` both return `EVM error NotActivated` while a bare `STOP` runs. Uniswap v4 keeps its lock in
  transient storage, so nothing v4 can execute here. Those paths stay unproven until Stage 4, with
  `buy --simulate` against real mainnet state as the interim evidence.
- **`claim` has nothing to claim.** A fresh anvil account has no accrued fees, so the command correctly stops at
  its guard and the send path is never reached. Testing it needs state overrides on the escrow, or a real
  wallet with fees.

Use the official RPC as `--fork-url`, not publicnode: under anvil's fetch pattern publicnode answers 403 and the
fork dies mid-run.

**Done when** `scripts/fork-test.mjs` reports zero failures — reached, with the four skips above understood
rather than forgotten.

## Stage 3 — first real money, the curve

A fresh wallet holding only what you are willing to lose in the session.

```sh
bodkin buy  <token> 0.001 --live
bodkin sell <token> 100   --live
```

Record quoted vs actual tokens, gas, and the round-trip loss. This is also the first real check of the
integer-order curve math against the contract: `tokensOut` should land inside the slippage bound of `quoteBuy`.

**Done when** a buy and a sell both settle, and the numbers match the quotes.

## Stage 4 — first real money, the graduated pool

Pick a phase-2 token **paired with ETH** — `ethPoolKey` refuses other pairs in v0.1. Same minimal buy and sell.

This is the path the architecture notes flag as settled only by simulation before the first live swap, and the
only one that exercises the Permit2 approval.

**Done when** a v4 buy and sell both settle and the router layout used is recorded.

## Stage 5 — force the exits

Exits have only ever run as dry-run marks. Make one fire quickly and cheaply:

```sh
bodkin snipe --live --eth 0.001 --budget 0.005 --max-open 1 \
  --take-profit 3 --stop-loss 3 --trailing 2 --max-hold 2
```

The point is not the P&L; it is that an automated **sell** executes without a human.

**Done when** a position opens and closes on its own rule, with a receipt.

## Stage 6 — supervised session at defaults

Defaults, session budget, watched start to finish. Then decide whether to keep going.

---

## Alongside

- **Trade log.** Record quote, fill, gas and venue as JSON for every live action, so the evidence accumulates
  instead of being remembered.
- **CI.** There is none. `typecheck` and `test` only run when someone remembers to run them.

## Not covered by any of this

Whether the strategy makes money. This plan tests that the software does what it says; that is a different
question from whether to trade at all.
