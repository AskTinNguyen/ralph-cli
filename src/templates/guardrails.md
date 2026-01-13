# Guardrails

These constraints apply to ALL Ralph tasks.

## Safety Constraints (NEVER do these)

- Never push directly to main/master branch
- Never delete production data or drop database tables
- Never modify .env, credentials, or secret files
- Never run destructive commands (rm -rf, DROP DATABASE, etc.)
- Never commit API keys, tokens, or passwords
- Never disable tests or skip verification
- Never force push or rewrite git history

## Process Guidelines

- Study the codebase before making changes
- Search for existing implementations before creating new ones
- Run the test command before claiming completion
- Keep changes focused on the current task
- Commit frequently with descriptive messages
- Ask for human help when genuinely stuck (NEEDS_HUMAN)

## Project-Specific Rules

(Add your project's constraints here)
