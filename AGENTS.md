# Physical AI workspace — Shared agent rules

These instructions apply to `podman-work/` and its child worktrees. `main/`
is the source of truth for project documentation and private planning material.

## Project, roles, and privacy

- All Jira work belongs under epic `APPENG-5763`.
- Private S9/S10 stories, plans, and notes live in `main/.internal/`; Jira is
  the public tracker. Never expose or link `.internal/` in Jira, email, public
  documentation, or other external systems.
- Terra or Sol owns planning and prioritization, Jira/worktree creation,
  feature-branch and integrated validation, merge-to-`main`, push, merge
  handoff, and requested cleanup.
- Luna owns feature-worktree research, implementation, targeted validation,
  feature commits/pushes, documentation, and normal final Jira closure.
- If the active agent cannot identify with a named role, use session ownership:
  `main/` owns merge; the feature worktree owns implementation and normal Jira
  closure.
- Delegate broad Jira/document research and zero-error gate runs when the
  runtime supports delegation; otherwise perform the work directly and report
  the limitation.

## Chat roles and shorthand

Use the worktree folder to choose the chat:

| Goal | Worktree | User shorthand | Agent action |
|------|----------|----------------|--------------|
| Plan/select work | `main/` | `Pick up APPENG-<NNNN>` or `Pick up Story <N>-<N>` | Resolve Jira and private context, create or prepare the feature worktree, then hand off implementation. |
| Start feature work | `APPENG-<NNNN>-<slug>/` | `start jira`, `start`, `go`, or `work on the associated Jira` | Infer the ticket, bootstrap if needed, read Jira/docs, and begin implementation. |
| Ship feature work | Feature worktree | `ship it` | Restore the production identity, run the full zero-error gate, stage only intended files, commit any final fixes, push the feature branch, and verify the remote tip. Do not merge to `main`. |
| Incremental feature commit | Feature worktree | `commit and push` | Stage only intended files, run relevant checks, commit on the feature branch, and push it. Do not merge to `main`. |
| Merge feature work | `main/` | `merge APPENG-<NNNN>` | Merge with `--no-ff`, run the integrated gate, push `main` with the user's approval, report the merge SHA, then return to Luna for Jira closure. Never close Jira from `main/`. |
| Close Jira | Feature worktree | `close jira` after merge | Read Jira first to verify its current status and final-comment state. If needed, post the single final Jira comment and transition the issue to Closed; then read Jira again to verify both. Never duplicate an existing final comment. |
| Clean up | `main/` | `cleanup branch APPENG-<NNNN>` | First read Jira to verify the issue is Closed and has its final implementation comment. With explicit cleanup approval, then remove the feature worktree plus its local and remote branches. Never modify Jira; if the audit fails, preserve the branch/worktree unless the user explicitly overrides it. |

`ship it` means complete feature-branch readiness and push the current feature
branch; it never implies a merge to `main` or Jira closure. Merges require the
`main/` worktree.

## Jira and work selection

- In the `main/` session, “Pick up APPENG-<NNNN>” means Terra or Sol should
  resolve the live Jira ticket, read its matching private plan/story context,
  and prepare the implementation worktree for Luna. Do not require the user
  to restate the plan or provide a second approval.
- “Pick up Story 9-<N>” or “Pick up Story 10-<N>” means resolve that Story item
  through the private Story 9/10 tracking documents and live Jira, then use the
  associated Jira key for the same workflow. For example, “Pick up Story
  10-15” resolves to APPENG-6263.
- If the requested item is Closed, report that it is already implemented and
  identify the next open follow-up instead of creating duplicate work. If the
  Story label maps to more than one Jira item or cannot be resolved, ask the
  user which item they mean.
- For a new backlog item, update the applicable private S9 or S10 story before
  creating the public Jira issue.
- For an existing Jira ticket, read Jira first; it defines public scope and
  status. Then read the matching `.internal/plans/` brief when present, the
  relevant S9/S10 story, and `docs/design.adoc` as needed.
- Create a Jira Story under `APPENG-5763`, or a Sub-task under the appropriate
  Story when grouping is appropriate.
- Assign every Jira Story or Sub-task Codex creates to the requesting user.
  Resolve and use that user's Jira account identity; if it cannot be resolved,
  ask before creating the issue.
- Discover required Jira fields and transitions from the configured Jira client
  or schema. Do not rely on hard-coded custom-field IDs.
- At work start, transition the ticket to `In Progress`. For a Sub-task, also
  transition its parent Story if it is still `New`.
- In the `main/` planning session, Terra or Sol creates or updates the plan,
  prioritizes and selects the work, creates the Jira issue and feature
  worktree, then hands it to Luna.
- “Work start” means Luna has reviewed the prepared ticket/context and begins
  work—not merely opening a worktree or chat.

## Worktrees and plan approval

- Create sibling feature worktrees as `APPENG-<NNNN>-<slug>` on branch
  `feature/APPENG-<NNNN>-<slug>`.
- Bootstrap a new feature worktree before Podman Desktop loading. From the
  worktree root, if `physical-ai/node_modules` is absent, copy the dependency
  tree from `../main/physical-ai/node_modules`, then run `npm install` to
  reconcile it with the branch's lockfile/package manifests. Verify that the
  tracked repository-root `AGENTS.md` is present before handoff; for a legacy
  branch created before it was tracked, create an untracked symlink to
  `../main/AGENTS.md` rather than proceeding without instructions. Create a
  shared `.internal` symlink (never copy the private planning directory),
  apply a ticket-namespaced extension identity, and run the initial typecheck.
  Verify and report each failure.
- In a recognizable feature worktree, infer the Jira key from the branch or
  directory. Ask only if it is ambiguous.
- In a feature worktree, any of `start jira`, `start`, `go`, or `work on the
  associated Jira` means: infer the Jira key, bootstrap if needed, read the
  prepared Jira issue, plan, story, and design context, then begin
  implementation. Do not require the user to restate the Jira key, plan, or
  grant a second plan approval.
- Linked worktrees keep their Git index and refs beneath the shared
  `main/.git` directory. If a routine scoped `git add`, `git commit`, or
  `git push` fails because the feature session cannot write that metadata, the
  feature/Luna agent must immediately retry the same operation with a scoped
  escalated-permission request. It must initiate that user approval through
  the execution tool itself rather than reporting an uncommittable change or
  asking the user to relay the request to another session. Stage only files
  belonging to the ticket and preserve unrelated worktree changes.
- Preserve unrelated local changes.

## Implementation and documentation

- Keep changes minimal and scoped. Run targeted checks while iterating.
- Treat documentation as part of feature/task completion. Before declaring work
  ready, assess every changed or newly shipped capability for stale user,
  developer, architecture, status, and task-tracking documentation; update the
  applicable surfaces in the same feature branch.
- Follow this documentation hierarchy; do not duplicate user-facing detail:
  - Repository-root `README.adoc` is a short landing page: project purpose,
    high-level layout, and a pointer to `physical-ai/README.md`. It does not
    contain detailed developer or end-user feature documentation.
  - `physical-ai/README.md` is the main developer README: source setup, build,
    local loading, packaging, project structure, and development troubleshooting.
    It points to `packages/backend/README.md` for user-facing features and
    operational guidance.
  - `physical-ai/packages/backend/README.md` is the canonical user-facing
    feature and operations guide. Update it for new or changed extension
    behavior, workflows, prerequisites, settings, platform notes, screenshots,
    and end-user troubleshooting.
  - `physical-ai/packages/frontend/src/Help.svelte` is the in-app help surface.
    Keep it in sync with the backend README whenever operational user guidance
    changes.
  - `docs/design.adoc` records current architecture, APIs, data flow, and
    significant technical decisions.
  - `.internal/` contains private planning, backlog, and task tracking; never
    expose it publicly.
- Update documentation in the feature branch when warranted. A task that only
  changes internal implementation may need no public README update, but the
  readiness report must state that documentation impact was assessed.
- Feature commits and pushes are permitted once changes are safe and scoped.
  User Podman Desktop testing is required before declaring merge readiness, not
  before every incremental commit.
- Before a feature is presented for merge, push its final tested tip to its
  matching remote feature branch and verify that `origin/feature/APPENG-<NNNN>-<slug>`
  contains that exact tip. This is the remote review/audit proof of the code
  being merged. If validation or a merge-readiness fix creates another commit,
  push and verify that new final tip before merging; do not leave the remote
  feature branch behind the merged local branch.
- Use `Review` only when implementation is code-complete and awaiting manual
  validation or review.

## Testing and merge

- Obtain the user’s required manual Podman Desktop test result before declaring
  a feature ready to merge.
- Restore the unsuffixed worktree identity before validation or merge.
- Merge only from `main/`, using `git merge --no-ff`.
- Before merging, Terra or Sol runs the zero-error gate against the feature
  branch. After merging, run it again against integrated `main` before pushing.
  From `main/physical-ai`, the gate is:

  ```text
  npm run typecheck
  npm run lint:check
  npm run svelte:check
  npm run format:check
  npm test
  ```

- Report unrelated pre-existing failures with evidence. Do not expand ticket
  scope to fix them without user approval.
- Require explicit user approval immediately before a merge/push that changes
  `main`, unless the user explicitly authorized that specific merge.

## Jira completion and cleanup

- After merge, integrated-gate success, and `main` push, report the merge SHA
  and return to the Luna session for the explicit `close jira` action. The
  main/Terra/Sol session must never post the final Jira comment or transition
  the ticket; those actions belong solely to the feature/worktree (Luna)
  session.
- On `close jira`, Luna first reads Jira to verify the current status and
  whether the ticket already has its final implementation comment. If the
  ticket is already Closed, do not modify it; report whether the expected
  final comment is present. If it is open and the final comment is absent,
  post exactly one final Jira comment using `contentFormat: markdown`, then
  close the ticket. If the final comment already exists, do not duplicate it;
  close only if needed. Read Jira once more after the transition to verify the
  Closed status and final comment. Main/Terra/Sol may perform this read-only
  verification but must never create, edit, or transition Jira activity. Match
  the final-comment visual structure below, including blank lines; render
  `main` as inline code and render the two link labels as Markdown hyperlinks.
  Use no raw URLs or `.internal/` references:

  ```text
  Implementation complete, tested, and merged to main.

  • <concise outcome / implementation bullet>
  • <concise outcome / implementation bullet>
  • <concise outcome / implementation bullet>
  • Zero-errors gate green (typecheck, lint, svelte-check, format, all package
    tests) on the integrated main.

  Repo: podman-work                         [rendered repository hyperlink]
  Work done: Merge feature/APPENG-<NNNN>-<slug> → main
                                             [rendered merge-commit hyperlink]
  ```

- After Jira closure is verified, rename that ticket's selected current plan
  from `APPENG-<NNNN>-<slug>.md` to `APPENG-<NNNN>-<slug>-DONE.md`, and update
  active private plan indexes and references. Do not rename or edit historical
  comparison/original plans solely for this status change.

- Close a parent Story only after every applicable child issue is Closed and
  planned follow-on work is completed or explicitly deferred.
- Never remove worktrees or local/remote branches as part of merge.
- `cleanup branch` is an explicit request to Terra or Sol to remove the merged
  feature worktree plus its local and remote feature branches. Before deletion,
  perform a read-only Jira audit that verifies the issue is Closed and has its
  final implementation comment. Main/Terra/Sol must never create, post, edit,
  or transition Jira activity; the feature/worktree (Luna) session owns the
  final Jira comment and closure. If that audit fails, preserve the worktree
  and branches and report the discrepancy unless the user explicitly directs
  cleanup despite it. Do not delete chat history or editor-specific project
  data.

## WSU email

- In the main/orchestrator session, the exact command `create wsu draft` (and
  equivalent capitalization) means: determine the active repository, query
  live Jira directly, inspect the latest sent WSU email, and create the
  reviewed HTML Gmail draft described below. Do not require the user to repeat
  the date window, repository scope, recipient, formatting, or no-send
  requirements.
- When asked to prepare WSU, use the active Physical AI repository context.
- Use the actual send timestamp of the most recently sent WSU email as the
  exclusive lower bound. Find Jira issues assigned/completed by the requesting
  user with status `Closed` through the current Tuesday cutoff, using
  `America/Toronto` time. Query the live Jira issues directly for status and
  completion; never infer closure or completion from `backlog-open.md`, Story
  9/10 snapshots, plan headers, merge commits, or other local tracking tables.
  Local docs and Git history may establish repository scope and implementation
  details only.
- Include only work demonstrably associated with this repository.
- Create an HTML Gmail draft addressed to Chris Custine
  `<ccustine@redhat.com>` with subject `WSU`; Jira keys must be rendered public
  Jira hyperlinks. Visually match the most recently sent WSU email's established
  structure: greeting, weekly-status introduction, linked Jira bullets with
  concise implementation details, and `Best, Sandip`.
- Save the working draft to
  `/Users/sgahlot/code/work/AI/physical_ai/podman-work/wsu-draft.md`,
  replacing the previous draft. After sending, record `status: sent`, send
  date, and Gmail message ID in its header.
- Show the actual draft for review. Send only with the user's explicit,
  immediate approval.

## Repository-specific context

- Build a Podman Desktop extension for Physical AI robotics development.
- MVP target: ROSCon Toronto, September 2026.
- Design document: `docs/design.adoc`.
- Stack: Podman Desktop extension framework, TypeScript, Svelte, Fedora, and ROS 2 Jazzy.
- Requirements: Node.js >= 24 and npm >= 11.

## Repository documentation ownership

- `README.adoc` is the repository landing page and points to the developer documentation.
- `physical-ai/README.md` is the slim developer README: source installation, build prerequisites, structure, packaging, and development troubleshooting.
- `physical-ai/packages/backend/README.md` is the canonical user-facing extension documentation.
- `physical-ai/packages/frontend/src/Help.svelte` is the in-app help surface.
- User-facing operational changes update the backend README and `Help.svelte` together; do not duplicate that content into the slim developer README.
- Architecture and API decisions belong in `docs/design.adoc` when the change warrants it.
- `.internal/` contains private plans, stories, backlog notes, and historical context. It is never linked from Jira or public documentation.

## Repository context read order

For feature work, read the Jira issue first, then the matching `.internal/plans/` brief, the relevant Story 9/10 backlog section, and `docs/design.adoc` as needed. Use the historical plan only when the current plan and Jira do not answer the question.

## Repository worktree validation

- New sibling worktrees must have the shared `.internal` link and a unique Podman Desktop extension identity before they are loaded into Podman Desktop.
- Restore the unsuffixed identity before the integrated merge gate.
- The merge gate is `npm run typecheck`, `npm run lint:check`, `npm run svelte:check`, `npm run format:check`, and `npm test` across all packages.
