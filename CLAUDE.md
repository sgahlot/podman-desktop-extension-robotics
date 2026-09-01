# Podman Desktop Extension for Physical AI

## Project Context
- Building a Podman Desktop extension for Physical AI robotics development
- Epic: APPENG-5763
- MVP target: ROSCon Toronto demo, September 2026
- Plan doc: `docs/podman-extension-plan.md`
- Design doc: `docs/design.adoc`
- Story docs: `docs/stories/`
- `.internal/` is git-ignored (private files, not pushed to public repo)

## Tech Stack
- Podman Desktop extension framework
- TypeScript / Svelte
- Target: Fedora + ROS2 Jazzy ecosystem

## Environment
- Requires Node.js >= 24.0.0 and npm >= 11.0.0 (matches Podman Desktop's own requirement; node/npm should be available on PATH)
- Team members may use any Node version manager (fnm, nvm, brew, etc.) — the project has no dependency on a specific one

## Workflow Rules
- Always reference the Jira key (e.g., APPENG-5768) when working on a task. **If not told
  which ticket to work on, infer it from the current branch name** — worktree branches are
  named `feature/APPENG-<NNNN>-<slug>`, so `git branch --show-current` gives you the key
  without having to ask. Read the ticket via the Atlassian tools, transition it to **In
  Progress** if it isn't already, then proceed with analysis and implementation.
- Check the plan doc for context on what each story/sub-task requires
- Ask questions before starting a new task if the scope or approach is unclear
- Keep this rules doc updated as decisions are made
- **Delegate to sub-agents by default:** run tasks through sub-agents (Agent tool) unless
  it's genuinely not necessary. This includes searches/research (grep sweeps, "where is X
  documented"), implementation, edits, and validation runs — anything that would otherwise
  read many files or produce large tool output into the main context. Do NOT do this work
  inline in the main context just because it seems quick. Only stay inline when delegation
  is clearly wasteful: a single trivial edit/command, or when the needed result is already
  in the main context. Always verify a sub-agent's output before relying on it.
- **Zero-errors-on-merge:** before pushing/merging any branch back to `main`, it must be
  clean on `npm run typecheck`, `npm run lint:check`, `npm run svelte:check`,
  `npm run format:check`, and `npm test` (all packages) — fix pre-existing errors
  encountered along the way too, even if unrelated to the branch's own feature scope,
  rather than letting them keep sitting on `main`
- **Commit/push freely on feature branches, no approval needed:** on any branch other than
  `main`, commit and push as soon as work reaches a safe/working state — do not wait for the
  user to test or explicitly say "go ahead" first. **`main` is the only branch that requires
  the user's own testing before anything is committed or pushed to it** (see the
  Merge-to-main rule below — the whole branch gets tested before it merges into `main`,
  which is what makes committing freely on the branch itself safe). If you're ever unsure
  whether you're "on main," check with `git branch --show-current` before assuming either way.
- **Merge-to-main before Closed:** never transition a sub-task to **Closed** until its branch
  is merged to `main`. Required sequence: user-tested → merge the branch to `main` with a
  **merge commit** (`--no-ff`, so the branch's commit SHAs stay reachable from `main` and every
  Jira commit link keeps resolving even after the branch is deleted) → zero-errors gate green on
  the integrated `main` → post a comment on the Jira citing the **merge commit id** as a Markdown
  commit link → then transition to Closed. Use **Review** (transition id 41) for
  code-complete-but-untested; In Progress until testing starts. Only merged branches are safe to
  delete.
- **Merges into `main` only happen from the `main/` worktree:** git allows a given branch to be
  checked out in exactly one worktree at a time, and `main` is always checked out in `main/` by
  convention — a feature-branch worktree can never `git checkout main` itself, so it cannot run
  the merge. When a feature branch is ready (user-tested, gate-green), perform the actual
  `git merge --no-ff` + zero-errors-gate-on-integrated-`main` + push + Jira comment/Closed
  sequence from the **`main/` worktree's session**, not the feature worktree's — if you're
  working in a feature worktree and the branch is ready to merge, say so and hand off (ask the
  user to continue in the `main/` worktree's session) rather than attempting the merge yourself.
  Worktrees of the same repo share one object database, so this needs no push to origin first —
  `main/` can merge a feature branch's local commits immediately. This doesn't change the rule
  above about committing/pushing the feature branch itself freely from within its own worktree;
  only the merge-**into**-`main` step is `main/`-only. Only run `git worktree remove <path>` for
  a feature worktree after its branch is merged, and only once nothing is still actively using
  that worktree (e.g. no live Claude Code session still `cd`'d into it).
- **If this checkout is a git worktree sibling (not `main/`) and `physical-ai/node_modules`
  doesn't exist yet, it's a brand-new worktree — do this one-time setup before anything
  else, in order:**
  1. Copy `node_modules` from `../main/physical-ai/node_modules` into this worktree's
     `physical-ai/node_modules` (npm workspace symlinks are relative, so this is safe
     across sibling worktrees at the same depth) — much faster than a from-scratch
     install — then run `npm install` once to reconcile any branch-specific dependency
     drift.
  2. Symlink `.internal` in from `main/`: `ln -s ../main/.internal .internal` (run from the
     worktree root). `.internal/` is private and git-ignored, and lives ONLY in `main/` —
     never copy or regenerate it elsewhere. The symlink is invisible to git under the same
     ignore pattern.
  3. **Give this worktree's Podman Desktop extension a unique identity before it's ever
     loaded into PD:** run `scripts/apply-worktree-identity.sh <NNNN>` from this worktree's
     root (e.g. `scripts/apply-worktree-identity.sh 6250`). A name/displayName-only suffix
     is NOT enough — the extension's command id (`physical-ai.open`) and all
     `physical-ai.*` configuration keys are also hardcoded and shared across every
     worktree by default; two worktrees loaded at once under the same command/config
     namespace collide in Podman Desktop's extension host and leave **both** stuck at
     "Starting" with no Stop/Start recovery (only a full PD quit+relaunch clears it —
     confirmed to happen even when only the top-level name/displayName were suffixed).
     The script namespaces name, displayName, command id, and config namespace together,
     rebuilds the backend, and marks every file it touches `skip-worktree` (local-only,
     never committed).
  4. **Before running the zero-errors gate or merging, run
     `scripts/apply-worktree-identity.sh restore` first**, then re-apply the suffix
     afterward if you want to keep testing in PD. The suffixed strings live in real
     source files now (`extension.ts`, `api-impl.ts`), and `extension.spec.ts`/
     `api-impl.spec.ts` assert the literal un-suffixed values — leaving the suffix applied
     makes 3 backend tests look like a regression when they aren't.
  5. Confirm with `npm run typecheck` before reporting the worktree ready or starting
     ticket work.
