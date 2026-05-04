# Nidavellir Runner Contract

Use this as Nidavellir's execution substrate shape. This contract defines how
autonomous agent runs are prepared, isolated, supervised, validated, and
preserved without replacing Nidavellir's PM, decomposer, Task Inbox, EM, or
approval gates.

## Runner Inputs

Each autonomous execution run should persist:

- plan inbox id, task inbox id, task id, and node id when available
- approved spec snapshot or task prompt snapshot
- agent provider and model
- sandbox provider: local worktree, Docker/Podman bind mount, isolated/cloud sandbox, or debug no-sandbox
- branch strategy: direct head, named branch, or merge-to-head style
- repo path, base branch, base commit, worktree path, branch name
- max iterations and max fix attempts
- completion signal
- idle timeout
- host and sandbox lifecycle hooks
- files copied into the worktree or sandbox
- approval mode and risk level

## Runner Outputs

Each run should return and persist:

- status and result
- iteration summaries
- stream events: text, tool call, checkpoint, decision needed, error, done
- session id or provider session metadata when available
- stdout/stderr excerpts
- commits created
- dirty file summary
- preserved worktree path
- verification results
- final handoff package

## Execution Policy

- PM/decomposer/EM gates happen before runner creation.
- Worktree isolation is default for AFK work.
- Direct edit mode is explicit and exceptional.
- Dirty worktrees are preserved, not deleted.
- Concurrent runs cannot share a worktree.
- Stale locks are recoverable.
- Branch strategy is explicit and visible.
- Lifecycle hooks are generated from repo readiness and verification policy.
- Completion signals and idle timeouts bound autonomous execution.

## Validation Loop

The PM validates independently after runner completion:

1. Automated tests.
2. Functional smoke checks.
3. UI/screenshot review when applicable.
4. Diff review.
5. Acceptance criteria mapping.

If validation fails, send focused repair instructions to the coding agent. Retry
up to three times, then pause, preserve the worktree, summarize evidence, and ask
the user for direction.
