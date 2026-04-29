# Strict TDD Builder

Use this skill when the user asks to implement, fix, or refactor software and explicitly requests strict TDD, tests-first development, or rigorous verification.

## Core Instructions

Build through a strict RED to GREEN loop.

Start by identifying the smallest independently testable behavior that would prove the requested change works. Read the relevant code before choosing the test location. Prefer existing test patterns, fixtures, helpers, and command conventions over inventing new structure.

Write or update the failing test before editing production code. Run the focused test and confirm that it fails for the expected behavioral reason, not because of syntax, import, environment, or test setup mistakes. If the first failure is not meaningful, fix the test setup until the failure accurately describes the missing behavior.

Implement the minimum production change needed to pass the focused test. Keep the change inside the relevant module boundary. Do not use unrelated refactors, formatting churn, or broad rewrites as part of the TDD loop unless they are necessary to make the tested behavior possible.

After the focused test passes, run the next relevant verification layer. For backend work, this usually means the touched test file, nearby API or integration tests, and any type or lint command already used by the repo. For frontend work, this usually means the touched component or screen test, related screen tests, and typecheck. For full-stack changes, verify both sides at the narrowest useful scope.

Report the result with concise RED to GREEN evidence: the test added or changed, the expected RED failure, the implementation change, and the GREEN commands. Call out any skipped commands, environment limitations, or pre-existing unrelated failures.

## Constraints

- Do not edit production code before there is a relevant failing test unless the task is purely mechanical test infrastructure.
- Do not accept a false RED failure caused by broken test setup.
- Do not broaden scope to unrelated cleanup.
- Do not discard or overwrite user work.
- Do not use destructive git commands.
- Do not weaken assertions just to make tests pass.
- Do not mark work complete if focused verification has not run.
- Do not hide pre-existing failures; distinguish them from failures caused by the current change.

## Steps

1. Read the relevant spec, user request, and nearby code.
2. Identify the smallest observable behavior to test.
3. Add or update the focused test.
4. Run the focused test and capture the RED failure.
5. Implement the smallest production change that should satisfy the test.
6. Run the focused test again and confirm GREEN.
7. Run adjacent tests and typecheck or lint where relevant.
8. Summarize changed files, RED to GREEN evidence, and residual risks.

## Examples

### Backend feature

If adding an API endpoint, first write a request-level test that proves the new route, response shape, persistence behavior, and failure mode. Confirm the route is missing or behavior is wrong. Then add the router, store method, and app registration needed to pass.

### Frontend feature

If adding a UI flow, first write a component or screen test that interacts with the UI the way a user would. Confirm the control, state transition, or API call is absent. Then implement the UI and state changes until the test passes.

### Bug fix

If fixing a regression, first write a test that reproduces the bug using the smallest realistic input. Confirm it fails in the same way the user reported. Then fix the underlying behavior, not only the test fixture.

## Anti-Patterns

- Writing tests after implementation and calling that TDD.
- Testing implementation details instead of user-visible behavior or stable module contracts.
- Running only the happy path when the bug is in error handling.
- Treating broad snapshot churn as evidence of correctness.
- Claiming success without naming the exact commands that passed.
- Ignoring a failing adjacent test because the focused test passed.
- Changing provider, filesystem, or process behavior without an integration test.
