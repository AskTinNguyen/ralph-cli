# Ralph CLI Website - Link Relationships Map

## Overview
Complete mapping of all internal link relationships across the Ralph CLI documentation website. This document shows which pages link to which other pages, enabling dependency analysis and orphan detection.

## Link Relationship Graph

### Main UI Pages (index.html, editor.html, logs.html, streams.html, tokens.html, trends.html, chat.html)

#### index.html (Dashboard)
- **Links to UI pages**: editor.html, streams.html, logs.html, tokens.html, trends.html, chat.html
- **Links to docs**: /docs/index.html, /docs/commands.html
- **Outbound links**: 8

#### editor.html (Editor)
- **Links to UI pages**: index.html, streams.html, logs.html, tokens.html, trends.html, chat.html
- **Links to docs**: /docs/index.html
- **Outbound links**: 8

#### streams.html (Streams)
- **Links to UI pages**: index.html, editor.html, logs.html, tokens.html, trends.html, chat.html
- **Links to docs**: /docs/index.html, /docs/streams.html
- **Breadcrumb**: /streams.html (self-link with SPA state management)
- **Outbound links**: 9

#### logs.html (Logs)
- **Links to UI pages**: index.html, editor.html, streams.html, tokens.html, trends.html, chat.html
- **Links to docs**: /docs/index.html
- **Outbound links**: 8

#### tokens.html (Tokens)
- **Links to UI pages**: index.html, editor.html, streams.html, logs.html, trends.html, chat.html
- **Links to docs**: /docs/index.html
- **Breadcrumb**: /tokens.html (self-link with SPA state management)
- **Outbound links**: 9

#### trends.html (Trends)
- **Links to UI pages**: index.html, editor.html, streams.html, logs.html, tokens.html, chat.html
- **Links to docs**: /docs/index.html
- **Outbound links**: 8

#### chat.html (Chat)
- **Links to UI pages**: index.html, editor.html, streams.html, logs.html, tokens.html, trends.html
- **Links to docs**: /docs/index.html
- **Outbound links**: 8

### Documentation Pages

#### /docs/index.html (Docs Home)
- **Links to docs**: commands.html, examples.html, integration.html, streams.html, tips.html, tutorial.html, troubleshooting.html
- **Links to root**: /index.html
- **Outbound links**: 8

#### /docs/commands.html
- **Links to docs**: index.html, examples.html, integration.html, streams.html, tips.html, tutorial.html, troubleshooting.html
- **Links to root**: /index.html
- **Outbound links**: 8

#### /docs/examples.html
- **Links to docs**: index.html, commands.html, integration.html, streams.html, tips.html, tutorial.html, troubleshooting.html
- **Links to root**: /index.html
- **Outbound links**: 8

#### /docs/integration.html
- **Links to docs**: index.html, commands.html, examples.html, streams.html, tips.html, tutorial.html, troubleshooting.html
- **Links to root**: /index.html
- **Outbound links**: 8

#### /docs/streams.html
- **Links to docs**: index.html, commands.html, examples.html, integration.html, tips.html, tutorial.html, troubleshooting.html
- **Links to root**: /index.html, /streams.html
- **Outbound links**: 9

#### /docs/tips.html
- **Links to docs**: index.html, commands.html, examples.html, integration.html, streams.html, tutorial.html, troubleshooting.html
- **Links to root**: /index.html
- **Outbound links**: 8

#### /docs/tutorial.html
- **Links to docs**: index.html, commands.html, examples.html, integration.html, streams.html, tips.html, troubleshooting.html
- **Links to root**: /index.html
- **Outbound links**: 8

#### /docs/troubleshooting.html
- **Links to docs**: index.html, commands.html, examples.html, integration.html, streams.html, tips.html, tutorial.html
- **Links to root**: /index.html
- **Outbound links**: 8

## Link Dependency Summary

### Pages with Highest Outbound Links
1. All UI pages: 8 links each (or 9 with breadcrumbs)
2. All docs pages: 7-8 links each

### Pages with Highest Inbound Links
- **index.html**: Referenced by all 14 other pages (UI nav + docs)
- **/docs/index.html**: Referenced by all 8 docs pages
- All other pages: Referenced by roughly equal number of pages (7-8 times)

### Orphan Analysis
- **None detected**: All pages are reachable from at least one other page
- **Root entry point**: index.html (accessible from /index.html)
- **Secondary entry point**: /docs/index.html (accessible from all pages + docs pages)

### Navigation Patterns

#### UI Navigation Pattern
- All 7 UI pages contain the same horizontal navigation menu
- Each page links to all other 6 UI pages
- Each page also links to /docs/index.html as the documentation entry point

#### Docs Navigation Pattern
- All 8 docs pages contain a consistent sidebar or top navigation
- Each docs page links to all other 7 docs pages
- Each docs page provides a link back to /index.html (main UI)
- /docs/streams.html includes additional link to /streams.html (parallel UI page)

#### Cross-Section Links
- UI pages → Docs: 7 links (one per UI page to /docs/index.html)
- Docs pages → UI: 8 links (one per docs page to /index.html)
- **Total cross-section links**: 15

## Link Statistics

### Internal Links
- **UI to UI navigation**: 42 links (7 pages × 6 outbound each)
- **Docs to Docs navigation**: 56 links (8 pages × 7 outbound each)
- **Cross-section navigation**: 15 links (7 UI→docs + 8 docs→UI)
- **Total internal links**: 113 (approx. 56 unique paths)

### External Links
- **Total external links**: 12
- **Types**: GitHub links, documentation links, external resources

### Fragments/Anchors
- **Total anchor references**: 222
- **Used for**: On-page navigation, section linking

## Validation Results

### Link Validation Status
- **Total links checked**: 290
- **Broken links**: 0
- **Valid links**: 56 internal + 12 external
- **Validation success rate**: 100%

### Validation Command
```bash
cd ui && npm run validate-links
```

### Last Validation
- **Date**: 2026-01-14
- **Status**: PASSED
- **Result**: All links valid, no broken references

## Recommendations for Link Maintenance

1. **Pre-commit validation**: Run `npm run validate-links` before committing HTML changes
2. **Cross-page navigation**: When adding new pages, ensure they're linked from relevant index pages
3. **Breadcrumb consistency**: Keep breadcrumb hierarchy consistent with site navigation
4. **Fragment naming**: Document all anchor names for fragment links to prevent collisions
5. **Regular audits**: Monthly validation to catch configuration drift

## Notes

- **SPA State Management**: streams.html and tokens.html use `href="#"` with onclick handlers for single-page app behavior while still providing valid navigation targets
- **Consistent navigation**: All UI pages follow identical navigation patterns for consistency
- **Centralized sidebar**: All docs pages maintain consistent sidebar/nav structure
- **Responsive design**: Navigation adapts responsively; links remain functional at all viewport sizes
