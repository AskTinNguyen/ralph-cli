# Factory Mode Documentation

Choose the right documentation for your needs:

## 🤖 For AI Agents
**[AGENT_GUIDE.md](AGENT_GUIDE.md)** - Concise reference optimized for agent consumption
- Quick decision trees
- Common patterns
- Critical rules
- Response templates
- When to use factory mode
- ~5-10 minute read

## 📚 Full Reference
**[SKILL.md](SKILL.md)** - Complete technical documentation
- Full YAML schema reference
- All verification types explained
- Detailed examples
- Architecture overview
- API reference
- Debugging guide
- ~30 minute read

## 🌐 Web UI
**Factory Guide** - Interactive HTML documentation
- Access at: http://localhost:3000/docs/factory-guide.html (when UI server running)
- Same content as AGENT_GUIDE.md but with navigation
- Good for browsing examples

## 💡 Quick Start

```bash
# Create new factory
ralph factory init my-factory

# Edit the YAML
nano .ralph/factory/my-factory.yaml

# Run it
ralph factory run my-factory
```

## 📂 Example Factories

Look at real examples in `.ralph/factory/`:
- `math-challenge.yaml` - Verification demonstration
- `wedding-planner-simple.yaml` - Basic PRD → Plan → Build flow
- `wedding-planner-website.yaml` - Complex multi-stage pipeline

## 🔑 Key Concepts

1. **Verification Gates** - Check actual artifacts (tests, commits, files), not agent claims
2. **Stage Dependencies** - Use `depends_on` to control execution order
3. **Conditional Branching** - Use `condition` for different paths
4. **Self-Correction Loops** - Use `loop_to` and `max_loops` for retries
5. **Parallel Execution** - Stages with no dependencies run concurrently

## 🎯 When to Use Factory Mode

✅ **Use when:**
- Multi-stage workflows (PRD → Plan → Build → Test → Deploy)
- Quality gates required (tests must pass, builds must succeed)
- Branching logic needed (different paths based on results)
- Self-correction needed (auto-retry failures)
- Parallel execution needed (frontend + backend simultaneously)

❌ **Don't use when:**
- Simple single PRD workflow
- Manual workflow preferred
- Exploratory/unclear requirements
- One-off tasks

## 📖 Related Documentation

- Main Ralph CLI docs: [CLAUDE.md](../../CLAUDE.md)
- Factory implementation: [lib/factory/](../../lib/factory/)
- Testing guide: [TESTING.md](../../TESTING.md)
