# Supervised Coding Agent Protocol

Use this protocol when Nidavellir Planner PM delegates implementation to a
coding agent.

## Required Markers

The coding agent must emit these exact markers so Nidavellir can parse progress:

```xml
<NID_PLAN_START>
objective, assumptions, affected files, steps, tests, risks, rollback, acceptance criteria
</NID_PLAN_START>

<NID_CHECKPOINT>
one-line progress summary with evidence
</NID_CHECKPOINT>

<NID_DECISION_NEEDED>
specific blocked decision for the PM/user
</NID_DECISION_NEEDED>

<NID_ERROR>
error summary, evidence, attempted fixes, and remaining blocker
</NID_ERROR>

<NID_DONE>
completed work, verification evidence, files touched, commits, residual risks
</NID_DONE>
```

## Rules For Coding Agents

- Do not implement before plan approval.
- Do not claim completion without verification evidence.
- Do not modify secrets, credential files, production configs, deployment settings, schemas, or migrations without approval.
- Do not delete files without approval and rollback path.
- Do not force push, bypass hooks, or use destructive commands without approval.
- Commit after logical subtasks when branch strategy allows commits.
- Keep changes minimal and scoped to the accepted task.
- When blocked, emit `NID_DECISION_NEEDED` and stop the blocked work.
- After three failed attempts on the same issue, emit `NID_ERROR`.

## Dangerous Patterns

Escalate or pause when output/tool calls include:

- `rm -rf`
- `DROP TABLE`
- `chmod 777`
- `--force`
- `--no-verify`
- credential or `.env` edits
- production config changes
- deployment commands
- database migrations
- destructive file deletion

## Validation Evidence

`NID_DONE` is valid only when it includes:

- relevant tests or checks run
- failures inspected or fixed
- acceptance criteria mapping
- files changed
- commits created when applicable
- known risks and limitations
