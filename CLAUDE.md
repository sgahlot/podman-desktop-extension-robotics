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
- Always reference the Jira key (e.g., APPENG-5768) when working on a task
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
