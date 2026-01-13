# AGENTS

Keep this file short. It is always loaded into context.

## Build & test
- No build step.
- Tests (dry-run): `npm test`
- Fast real agent check: `npm run test:ping`
- Full real loop: `npm run test:real`

## CLI shape
- CLI entry: `bin/ralph`
- Templates: `.agents/ralph/` (copied to repos on install)
- State/logs: `.ralph/` (local only)
- Skills: `skills/`
- Tests: `tests/`
- Docs/examples: `README.md`, `examples/`

## Quirks / Guardrails
**Add any common quirks guiderails here as needed**
