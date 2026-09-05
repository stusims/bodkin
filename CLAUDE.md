@AGENTS.md

## Claude Code notes

- **Never run a `--live` command.** `snipe --live`, `buy --live`,
  `sell --live` and `claim --live` spend real ETH. They are the user's to
  run, never the agent's — not to verify a change, not to "check it works".
  Dry runs and `doctor` are always fine.
- `.claude/` is git-ignored in this repo, so local settings stay out of
  commits. `AGENTS.md` and `CLAUDE.md` are tracked.
- Safe to pre-approve: `npm test`, `npm run typecheck`, `npm run build`,
  `npx bodkin doctor`, and any `git` read command.
- `npm test` takes ~9 s and `npm install` ~1 min — both fine in the
  foreground. `npm run hunt` and `npm run board` are long-running processes:
  start them in the background and read their output, or bound them
  (`hunt --for 60`, `hunt --no-follow`) so they terminate.
- The MSLearn MCP rule in the global config does not apply here — this is a
  Node/viem project with no Microsoft surface.
