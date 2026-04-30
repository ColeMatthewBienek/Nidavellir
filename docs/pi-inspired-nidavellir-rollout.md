# Pi-Inspired Nidavellir Rollout

## Architecture Review

Pi's coding-agent treats agent behavior as installable runtime resources: skills, prompt templates, project context files, extensions, themes, packages, and session trees. The useful lesson for Nidavellir is not to copy Pi's terminal-first shape, but to keep reusable behavior scoped, inspectable, reloadable, and composable.

Nidavellir already has the right foundation for the first vertical slice:

- `backend/nidavellir/prompt/assembly.py` provides deterministic prompt sections.
- `backend/nidavellir/skills/` normalizes external formats into `NidavellirSkill`.
- `backend/nidavellir/routers/ws.py` sends assembled prompt output instead of appending raw skill markdown to user text.
- Conversation identity, queued steering, working-set files, memory, and token tracking already exist as separate subsystems.

The main architectural guardrail is resource separation:

- Skill: procedure that changes how an agent performs work.
- Prompt template: reusable user-facing prompt.
- Project instruction: durable repo or workspace guidance.
- Extension: executable tool, UI, command, or event handler.
- Package: distribution container for resources and assets.

## Implemented First

Project instructions are now a dedicated prompt input, discovered from:

- `NIDAVELLIR.md`
- `AGENTS.md`
- `CLAUDE.md`
- `PROJECT.md`

Discovery checks optional global agent instructions first, then workspace ancestors from broadest to most specific. WebSocket prompt assembly injects these as a separate `Project Instructions` section before conversation context and before the current user message.

Imported skills also now carry package-compatible source metadata:

- `source_type`
- `package_id`
- `package_name`
- `package_version`
- `package_scope`
- `trust_status`
- `imported_at`

Imported skills remain disabled and `untrusted` until reviewed.

## Structured Rollout

### Phase 1: Prompt Backbone

Status: mostly done.

- Keep every context source flowing through `PromptSection`.
- Preserve token estimates and metadata on each section.
- Expose section diagnostics in the UI so users can see what affected a turn.

### Phase 2: Skills

Status: vertical slice exists.

- Keep `NidavellirSkill` as the only runtime format.
- Treat Claude-style skills, Markdown, zips, repos, and future package imports as import formats only.
- Add provider-specific compilers only after the generic compiler's behavior is stable.

### Phase 3: Project Instructions

Status: backend discovery and WS injection added.

- Add API diagnostics for discovered instruction files.
- Add UI display under Resources or the working-set sidebar.
- Add per-project enable/disable controls if instruction pressure becomes noisy.

### Phase 4: Prompt Templates

Status: next recommended feature.

- Create a separate `prompts/` resource subsystem.
- Do not import reusable prompt text into the skill inventory.
- Add template variables and preview before execution.

### Phase 5: Packages

Status: metadata groundwork added.

- Define a package manifest.
- Let packages bundle skills, prompt templates, project instructions, themes, and assets.
- Keep imports non-executing by default.
- Require review before enabling imported behavior.

### Phase 6: Runtime Diagnostics

Status: partial.

- Show injected and suppressed skills.
- Show discovered project instructions.
- Show token contribution by section.
- Show trust state for imported resources.

### Phase 7: Later Agent Runtime Features

Status: defer until core resource model is stable.

- Conversation branch view.
- Rich queued instruction editing/canceling.
- Extension runtime.
- Package registry import from git, npm, URLs, and local paths.

## Guardrails

- Do not collapse skills, prompt templates, and project instructions into one table.
- Do not allow package import to execute code.
- Do not let provider adapters consume raw imported resource formats.
- Do not bypass prompt assembly for major context sources.
- Do not enable imported behavior until the user reviews it.
