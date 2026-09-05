# The board

`bodkin board` runs the sniper engine and serves one page on `http://127.0.0.1:4663`. It binds loopback only; nothing outside your machine can
reach it. Dry run unless you started it with `--live`.

**It opens as a feed.** Launches arrive, get scored and explained, and nothing fires until you press **start demo** (dry-run buys, no key
needed) or, with `--live`, **arm live sniping** (confirmed once in the terminal at start and once more on the button). **stop** returns to
the feed; positions keep being marked and closed by their exit rules either way.

<p align="center"><img src="../assets/board.png" alt="the board: launches, positions, rules" width="100%"></p>

## Reading it

**Header.** The mode pill shows `feed only`, `demo trading`, `LIVE · not armed` or `LIVE · armed`. The subtitle shows how many launches
the chain produced in the last five minutes. The clock is UTC, the same clock the feed uses.

**The pulse.** The engine sends a tick every ten seconds with the feed's state and the RPC gate's state. A yellow bar under the header says
when the chain has been quiet for two minutes or an RPC endpoint is benched; a red bar says the engine itself has not answered for 35 s,
which means its console window is gone or stuck: close it and start bodkin again. Every button waits at most eight seconds for the engine and
says so if it hears nothing, instead of dying silently.

**Five numbers.** Launches seen this session · fired · open positions · realized PnL in ETH for the session · uptime. A tile flashes yellow
when its number changes.

**Launches.** Newest first. Each row: time, name and symbol with a copy-contract button, pair asset, dev buy as a share of supply, creator tax,
score with a bar (lime ≥ 75, white ≥ 45, grey below), `FIRE` or `pass`, and the first reason the rules refused it with a `+n` for the rest.
A `FIRE` row flashes yellow on arrival. Click any row for the drawer.

**Drawer.** The whole read of that launch: contract, links to pons, the explorer, Axiom (by the pons curve address, which is how Axiom
keys a Robinhood Chain market) and FOMO (its page needs a signed-in FOMO session), and the token's own X / web / Telegram when the launch declared them; the description; the decision and
every rule that refused it; score and verdict; dev buy; creator tax; who receives the fees; exempt wallets; the deployer's record; the
opening tax at read time; curve progress; read latency and block; and every scoring line with its points. `esc` closes it.

**Positions.** Open positions with a live mark every five seconds: PnL, size, venue (curve or pool), peak, and a **close now** button.
Closed positions stay for fifteen minutes with their exit reason. In `--live` mode the button asks for confirmation first.

**Rules.** The rules the engine is running. Five of them have steppers and can be edited while it runs: min score, max open, tax ceiling,
dev share, exempt wallets. An edit applies to the next launch and shows as a toast. The buy size and the exits are launch flags, so they are
shown but not editable here.

## Controls

| Control | What it does |
|---|---|
| **start demo / stop demo** (`p`) | dry-run buys on or off; launches keep arriving and scoring either way, positions keep being managed |
| **arm live sniping / disarm** (`p`, only with `--live`) | real buys on or off, with a confirmation on the button |
| **sound** | a short beep on every fire; off by default |
| **all / fire / eth pairs** (`a`, `f`) | filter the feed |
| **search** (`/`) | filter by name, symbol or contract |
| **⧉** | copy a contract to the clipboard |
| **close now** | sell the position at the current quote, whatever the exit rules say |
| **− / +** on a rule | change the running engine, bounded to sane ranges |
| `esc` | close the drawer |

## The API behind the buttons

All on `127.0.0.1` only.

| Method | Path | Effect |
|---|---|---|
| GET | `/` | the page |
| GET | `/events` | server-sent events: `hello`, `tick` (every 10 s), `launch`, `fire`, `mark`, `exit`, `paused`, `rules`, `index` |
| GET | `/api/state` | a snapshot: mode, paused, rules, counters, positions, ETH/USD, feed and RPC health, the last 100 events |
| POST | `/api/start`, `/api/stop` | firing on / off (`/api/resume` and `/api/pause` are the same verbs) |
| POST | `/api/close/<positionId>` | sell a position now |
| POST | `/api/rules` | body `{"minScore": 70}` etc.; only the five editable rules, clamped to their bounds |
| POST | `/api/tx/buy` | **`--wallet` only.** body `{from, token, eth, slippageBps?}` → an unsigned plan; sends nothing |
| POST | `/api/tx/sell` | **`--wallet` only.** body `{from, token, pct, slippageBps?}` → a plan, approvals first if needed |
| POST | `/api/tx/claim` | **`--wallet` only.** body `{from}` → an unsigned escrow claim |

No route makes the engine buy. Firing is the engine's decision under the rules on screen, and `--live` is a launch flag, not a
button, so a page left open cannot be turned into a sniper by anything on it.

Cross-origin POSTs are refused on every route, so another page in your browser cannot drive the board.

## Trading it yourself, with a wallet

```
bodkin board --wallet --max-buy 0.02
```

The page gains a **connect wallet** button and, in the drawer of any launch, a buy amount with **buy**, **sell all** and **sell half**.
It finds your wallet through EIP-6963 (falling back to `window.ethereum`), puts it on chain 4663 — Phantom ships Robinhood Chain, others
may need `wallet_addEthereumChain` — and then, for each action, asks bodkin what to send.

Bodkin answers with a **plan**: an ordered list of unsigned steps, each `{label, to, data, value}`. A curve buy is one step; a pool sell
can be three, because the router pulls tokens through Permit2 and both approvals may be missing. Your wallet shows each one and you sign
or refuse; a refusal stops the run where it is rather than carrying on.

What this does *not* change: bodkin holds no key on this path, cannot broadcast, and the automated sniper is untouched — it still needs
`PRIVATE_KEY` in `.env`, because it fires 1.6–2.1 s after detection and cannot wait for anyone to click. `--max-buy` caps one buy from
the page and is enforced before the transaction is built. The whole thing is off unless you pass `--wallet`.

## Two things hidden in the page

Click the mark five times, or type the old code on the keyboard, and see who runs across the footer once the tax is gone.
