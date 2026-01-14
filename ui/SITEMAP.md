# Ralph CLI Documentation Website - Sitemap

## Overview
Complete inventory of all pages in the Ralph CLI documentation website and their purposes.

## Main UI Pages (6 pages)

| Page | Path | Purpose | Version |
|------|------|---------|---------|
| Dashboard | `/index.html` | Main entry point with overview of Ralph CLI features and quick navigation | 1.0 |
| Chat | `/chat.html` | Chat interface for interactive assistance (placeholder) | 1.0 |
| Streams | `/streams.html` | Stream management and parallel execution interface | 1.0 |
| Logs | `/logs.html` | Build and execution logs viewer | 1.0 |
| Tokens | `/tokens.html` | Token management and configuration | 1.0 |
| Trends | `/trends.html` | Analytics and trends dashboard | 1.0 |
| Editor | `/editor.html` | PRD and plan editor | 1.0 |

## Documentation Pages (8 pages)

| Page | Path | Purpose | Version |
|------|------|---------|---------|
| Docs Home | `/docs/index.html` | Documentation main page with navigation to all docs | 1.0 |
| Commands | `/docs/commands.html` | Reference for all Ralph CLI commands | 1.0 |
| Examples | `/docs/examples.html` | Usage examples and common workflows | 1.0 |
| Integration | `/docs/integration.html` | Integration and advanced topics | 1.0 |
| Streams | `/docs/streams.html` | Stream workflow documentation | 1.0 |
| Tips | `/docs/tips.html` | Tips, tricks, and best practices | 1.0 |
| Tutorial | `/docs/tutorial.html` | Getting started tutorial | 1.0 |
| Troubleshooting | `/docs/troubleshooting.html` | Troubleshooting guide and FAQs | 1.0 |

## Total Pages: 15

- **UI Pages**: 6
- **Documentation Pages**: 8
- **Total**: 14

## Page Hierarchy

```
/
├── index.html (Dashboard)
├── chat.html
├── editor.html
├── logs.html
├── streams.html
├── tokens.html
├── trends.html
└── docs/
    ├── index.html
    ├── commands.html
    ├── examples.html
    ├── integration.html
    ├── streams.html
    ├── tips.html
    ├── troubleshooting.html
    └── tutorial.html
```

## Navigation Structure

### Main Navigation (present on all 7 UI pages)
- Dashboard (`/index.html`)
- Chat (`/chat.html`)
- Streams (`/streams.html`)
- Logs (`/logs.html`)
- Tokens (`/tokens.html`)
- Trends (`/trends.html`)
- Editor (`/editor.html`)

### Documentation Navigation (present on all 8 docs pages)
- Docs Home (`/docs/index.html`)
- Commands (`/docs/commands.html`)
- Examples (`/docs/examples.html`)
- Integration (`/docs/integration.html`)
- Streams (`/docs/streams.html`)
- Tips (`/docs/tips.html`)
- Tutorial (`/docs/tutorial.html`)
- Troubleshooting (`/docs/troubleshooting.html`)

### Breadcrumbs
- **streams.html**: Home > Streams
- **tokens.html**: Home > Tokens (with SPA state management)

## Link Validation Status

- Total internal links: 56
- Total external links: 12
- Total fragments/anchors: 222
- Broken links: 0
- Validation script: `validate-links.js`
- Validation command: `npm run validate-links`

Last validated: 2026-01-14
Validation passed: Yes (100% success rate)
