# Agent workflow

Every task moves through the same four beats, each backed by a skill from
the global skills collection (see [Skill sources](#skill-sources)).

## Workflow

1. **Isolate — `/new-feature`.** Every new feature starts in a fresh Git
   worktree branched from `origin/main` so agents can work in parallel
   without conflicts. Never build on `main`.
2. **Build — `/code-structure`.** Write code to the service-layer
   architecture: actions/boundaries orchestrate the "why/when", a service
   layer owns the reusable "how", with explicit inputs and structured
   returns. In this repo that seam already exists and must be respected:
   `cli.ts` / `cli-trade.ts` / `board/` are boundaries that decide *why and
   when*; `pons/`, `trade/`, `score.ts`, `snipe.ts` and `util/` own the
   *how* and stay free of terminal formatting and process exits.
3. **Prove — `/evidence-driven-testing`.** Verify with the checks below plus
   runtime evidence. Capture the **before** state while reproducing the
   issue — prior to fixing it, when it is cheapest — and the **after** once
   the change works. This is a terminal and local-web product: evidence is a
   `hunt` / `snipe` dry-run transcript, a board screenshot, or a measured
   number pair (timing, tax bps, quote), never a prose claim.
4. **Ship — `/before-and-after`, then `/greploop`.** Open the PR with
   before/after proof embedded in the description. Run `/greploop` — or
   `/greploop-apps` when the PR exceeds Greptile's file-count limit — until
   Greptile reports **5/5 with zero unresolved comments**. Finish by
   presenting the PR URL.

Ship-beat notes:

- `/before-and-after` drives the `@vercel/before-and-after` CLI. `--markdown`
  uploads the pair and prints a PR-ready table; it also accepts existing
  PNGs, so evidence gathered while developing can be reused as-is.
- The board is the only screenshot surface (`http://127.0.0.1:4663`). For
  terminal work, paste the transcript instead of an image.
- The default upload host (0x0.st) is public. Never upload a shot that shows
  a wallet address, a balance, or `.env` contents — pass `--upload-url`, or
  redact first.

## Remotes

This checkout is a **fork**. Two remotes, and the difference matters:

| Remote | Repo | Use |
|---|---|---|
| `origin` | `stusims/bodkin` | ours — branches and PRs go here |
| `upstream` | `Phosphenq/bodkin` | the original — read-only, never push |

`main` tracks `origin/main`. Branch from `origin/main` and open PRs against
`origin` unless a task explicitly says to contribute upstream.

To pick up upstream changes:

```sh
git fetch upstream && git rebase upstream/main    # on main, then push to origin
```

Never push to `upstream` — we have no write access to it, and a task that
seems to need one should stop and ask.

## Multi-agent rules

- Never commit directly to `main`.
- One worktree and one branch per task and per agent — never reuse or modify
  another agent's worktree, branch, or uncommitted work.
- **Scope check** before starting: skim open PRs' changed files
  (`gh pr list`, `gh pr diff <n> --name-only`) and look for uncommitted work
  in shared checkouts. On overlap, stop and ask for direction.
- Never force-push to `main` — and never plain `--force` anywhere; only
  `--force-with-lease`, only on your own task branch.
- Resolve `package-lock.json` conflicts by regenerating (`npm install`),
  never by hand-merging.
- Worktrees don't isolate shared resources. Two agents cannot both hold
  `BOARD_PORT=4663`; start yours with `--port` and confirm the page you are
  reading belongs to *your* process. `data/positions.json` is shared per
  checkout too — a second engine writing it will corrupt the first's view.
- If a conflict can't be resolved confidently, stop and report instead of
  guessing.

## Completing a task

1. Keep changes limited to the assigned task.
2. Run the checks (see [Commands & checks](#commands--checks)).
3. Assemble the evidence captured along the way into before/after pairs.
4. Commit with a clear message, rebase onto the latest `main`, and rerun the
   checks.
5. Push (`git push -u origin <branch>`; after rebasing an already-pushed
   branch, `--force-with-lease`).
6. Open the PR. The body must explain what changed, how it was tested (every
   claim backed by evidence), before/after proof, and any risks or follow-up
   work.
7. Run `/greploop` (or `/greploop-apps`) until **5/5 with zero unresolved
   comments**.
8. End by presenting the PR URL.

Do not merge the PR unless explicitly instructed. Keep the worktree until
the PR is merged or closed.

## Commands & checks

Run all three before opening a PR. All were verified green on a clean clone
(2026-09-05): typecheck silent, 23/23 tests passing, build emits `dist/`.

```sh
npm install            # npm + committed package-lock.json; Node >= 20
npm run typecheck      # tsc --noEmit, strict
npm test               # node --test via tsx; 23 checks, no network
npm run build          # tsc -> dist/, then copies board/index.html
```

Single test file, for a tight loop:

```sh
node --import tsx --test test/curve.test.ts
```

Running the app (every flag is in [docs/COMMANDS.md](./docs/COMMANDS.md)):

```sh
npm start -- doctor --probe   # or: npx bodkin doctor --probe
npm run hunt                  # live launch feed, no key needed
npm run board                 # http://127.0.0.1:4663, dry run
```

There is no linter and no CI in this repo: `npm run typecheck` and `npm test`
are the whole gate, so both must be clean locally. Nothing else will catch a
regression.

## Hard invariants

- **`src/trade/wallet.ts` is the only file that may touch `PRIVATE_KEY`.**
  Never read it elsewhere, never log it, never write it to `data/` or into an
  error message.
- **Dry run is the default.** `snipe`, `buy`, `sell`, `claim` and `board`
  quote and log without sending unless `--live` is passed explicitly. Never
  add a path that spends without `--live`, and never make `--live` something
  the board page can switch on — it is a launch flag, not a button.
- **The four walls around a live session stay intact**: the typed `arm`
  confirmation, the per-buy size, the position cap, and the session budget.
  Do not weaken or bypass any of them, or add a flag that skips one.
- **The board binds 127.0.0.1 only** and exposes exactly four verbs (pause,
  resume, close a position, edit a bounded rule). No route may initiate a
  buy.
- **Curve math follows the protocol's integer order.** `src/pons/curve.ts`
  reproduces `PonsV2BondingCurve.buy/sell` step by step so `minTokensOut`
  matches the contract's rounding. Do not "simplify" it to floating point or
  reorder its operations — a mismatch means reverted or badly filled trades.
- **Every RPC call goes through the gate** in `src/util/rpcGate.ts`. Do not
  construct a bare viem client or hit an endpoint directly: the public RPCs
  429 above ~8 concurrent calls, count each call inside a JSON-RPC batch, and
  challenge noisy clients. No JSON-RPC batching.
- **Numbers come from chain state, not an API.** Every figure on screen must
  trace to a read. Do not introduce a third-party price or metadata service.
- Never commit `.env`, `data/`, or `dist/` — all are git-ignored; keep it so.

## Environment quick reference

- **Node >= 20** (`engines`), TypeScript 7, ESM throughout
  (`"type": "module"`, `moduleResolution: NodeNext`). `tsx` runs the sources
  directly, so there is no build step in the dev loop.
- **Package manager: npm**; `package-lock.json` is committed.
- Three runtime dependencies only — `viem`, `commander`, `ws`. Keep it that
  way; a fourth is a decision, not a detail (the README advertises the count).
- **`.env`**: `cp .env.example .env`. Works out of the box against the public
  RPCs with no key. `PRIVATE_KEY` is needed *only* for `--live`, `sell`,
  `wallet` and `claim`; every other command runs without it.
- Chain id **4663** (Robinhood Chain). Defaults are two public RPCs
  (publicnode for state, the official Robinhood RPC for logs) plus
  publicnode's free websocket for detection; `RPC_WS_URL=off` falls back to
  300 ms polling.
- **Port 4663** for the board (`BOARD_PORT`), loopback only.
- `data/` holds the positions store. No database, no daemon, no service.

## Local test infrastructure

- `npm test` needs **no network and no key** — 23 checks across `test/`
  covering curve quotes, the opening-tax cap, scoring, the sniper's refusals,
  the launch-farm fingerprint, the enrichment limiter, the deployer index, v4
  pool ids and both router layouts, and every exit rule.
- New logic in `pons/`, `score.ts`, `snipe.ts` or `trade/` is expected to land
  with a test in the same style: pure functions, fixture inputs, no RPC.
- `scripts/board-check.py` checks the board page.
- To reset local state, delete `data/`; it is rebuilt on the next run.
- `bodkin doctor --probe` is the cheapest confirmation that the RPC, the live
  pons parameters and the v4 quoter all answer.

## Can't be tested locally

- **Live trading.** `--live` signs and sends real transactions with real ETH.
  Never run it to "verify" a change, and never claim a live path works
  because a dry run did. A dry run exercises the same reads and the same
  decision; that is the honest limit of local verification.
- **Real launch timing.** Entry latency and tax-at-entry figures come from
  watching real launches arrive over the websocket. They cannot be reproduced
  from fixtures — cite the recorded numbers rather than inventing new ones.
- **Public-RPC rate-limit behaviour** (429s, the penalty box, the challenge
  path) only appears under real load against the public endpoints.
- **Graduated-pool swaps** need a token that has actually graduated; the v4
  router parameter layout is settled by simulation before the first live
  swap, not by a unit test.

## Skill sources

| Skill | Source |
|---|---|
| `new-feature`, `code-structure`, `evidence-driven-testing` | [michaelshimeles/skills](https://github.com/michaelshimeles/skills) |
| `before-and-after` | vendored from [vercel-labs/before-and-after](https://github.com/vercel-labs/before-and-after) |
| `greploop` | vendored from [greptileai/skills](https://github.com/greptileai/skills) |
| `greploop-apps` | local variant of greploop for huge PRs; no separate upstream |

All six are installed globally in `~/.claude/skills/`.
