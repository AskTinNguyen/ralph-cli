# Ralph CLI Examples

Basic usage:

```bash
ralph prd "A lightweight uptime monitor (Hono app), deployed on Cloudflare, with email alerts via AWS SES"
ralph plan
ralph build 1 # one Ralph run
ralph build 1 --no-commit # one Ralph run
```

Agent override:

```bash
ralph ping --agent=codex # check agent is installed + responsive
ralph build 1 --agent=codex # one Ralph run
ralph build 1 --agent=claude # one Ralph run
ralph build 1 --agent=droid # one Ralph run
```

PRD/plan overrides:

```bash
ralph prd "..." --out docs/prd-api.md
ralph plan --prd docs/prd-api.md --plan .ralph/api-plan.md
ralph build 1 --prd docs/prd-api.md --plan .ralph/api-plan.md # one Ralph run
```

Progress override:

```bash
ralph build 1 --progress .ralph/progress-api.md # one Ralph run
```

Install templates:

```bash
ralph install
ralph install --force
```

Install skills:

```bash
ralph install --skills
```
