@AGENTS.md

## Claude Code

`AGENTS.md` above is the source and is shared with other agents — put changes
there, not here. This file exists because Claude Code reads `CLAUDE.md` and not
`AGENTS.md`, and a nested `CLAUDE.md` is what makes these rules load when Claude
touches files in this repo. Without it they were opened by hand roughly once per
hundred edits.

- **This checkout may be a worktree**, at
  `lock-control-systems/worktrees/<slug>/<repo>`. Nothing above a worktree
  carries the Lock Control workspace rules, so if `ls work/` fails, you are in
  one: the board and the cross-repo rules live in `lock-control-systems/code/`
  (`AGENTS.md`, `work/README.md`). Prefer working on a worktree by path from
  there rather than starting a session inside it.
- **Nested `CLAUDE.md` files are not re-injected after `/compact`.** If a long
  session stops honouring these rules, re-read this file.
