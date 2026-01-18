# Implementation Plan

## Summary

This PRD focuses on WCAG 2.1 AA color contrast compliance for the Ralph CLI UI. The current design system uses CSS custom properties in `ui/public/css/rams-ui.css`, but several color combinations fail WCAG AA standards (4.5:1 for normal text, 3:1 for UI components).

**Key gaps:**
- No baseline audit of current color combinations and their contrast ratios
- Gray palette values (#A3A3A3, #737373) likely fail 4.5:1 threshold on light backgrounds
- Accent colors (#1A4D2E, #2D6A4F) need verification against typical backgrounds
- No documented compliance reference or maintenance guide
- Inline style overrides in HTML may introduce non-compliant colors

**Prioritized approach:**
1. Audit existing colors and measure contrast ratios
2. Update gray palette values for text contrast
3. Verify accent green colors meet requirements
4. Check functional colors (success, warning, error, info)
5. Audit interactive elements (links, buttons, form controls)
6. Find and flag inline style overrides
7. Create utility classes for compliant color combinations
8. Update CSS variables with verified values
9. Test visually across all HTML pages
10. Document compliance status and maintenance procedures

---

## Code Patterns

### Error Handling Pattern
The codebase uses try-catch with early validation. Example from `ui/src/routes/api.ts`:
```typescript
// Found in: ui/src/routes/api.ts:95-105
function parseFixStatsFromLog(logPath: string): FixStats | null {
  try {
    if (!fs.existsSync(logPath)) {
      return null;
    }
    const content = fs.readFileSync(logPath, 'utf-8');
    // ... process and return or catch error
  } catch (error) {
    // Handle error
  }
}
```
**Pattern:** Guard clauses for validation, then process, no silent failures.

### CSS Architecture Pattern
The design system is centralized in `:root` CSS variables with semantic naming:
```css
/* Found in: ui/public/css/rams-ui.css:10-40 */
:root {
  --rams-gray-50: #FAFAFA;
  --rams-gray-100: #F5F5F5;
  --rams-gray-500: #737373;
  --rams-accent: #1A4D2E;
  --rams-success: #10B981;
  --rams-warning: #F59E0B;
  --rams-error: #EF4444;
  --rams-info: #3B82F6;
}
```
**Pattern:** One source of truth for colors; all components reference custom properties, not hardcoded hex values. Variable names follow `--rams-<type>-<shade>` convention.

### HTML Styling Pattern
HTML pages either use CSS class utilities or inline styles:
```html
<!-- Found in: ui/public/dashboard.html and index.html -->
<a class="rams-nav-link active" style="color: var(--rams-accent);">Link</a>
<span class="rams-text-xs">Small text</span>
```
**Pattern:** Prefer CSS classes with custom properties; inline styles are exceptions flagged for review.

---

## Tasks

### US-001: Audit current color combinations for WCAG compliance

- [x] Create contrast ratio measurement list for all color pairs in use
  - Scope: Measure gray palette (50, 100, 200, 300, 400, 500, 600, 700, 800, 900) against white (#FFFFFF) and gray-50 (#FAFAFA)
  - Scope: Measure accent palette (#1A4D2E, #2D6A4F, #52B788, #0F2D1A) against white and gray-50
  - Scope: Measure functional colors (success, warning, error, info) against white, gray-50, gray-100, gray-900
  - Use WebAIM Contrast Checker (https://webaim.org/resources/contrastchecker/) for each pair
  - Acceptance: Document created at `.ralph/PRD-114/WCAG_AUDIT.md` with all combinations categorized as "Pass" (≥4.5:1 normal text), "Pass 3:1 only" (≥3:1 UI components), or "Fail" (below 3:1)
  - Verification: Run `grep -c "Pass\|Fail" .ralph/PRD-114/WCAG_AUDIT.md` shows at least 30 lines; at least one "Fail" entry present (expected from current palette)
  - ✅ COMPLETED: Document created with comprehensive contrast ratio analysis for all color variables

- [x] Search HTML files for inline color style overrides
  - Scope: Use grep to find `style="color:` and `style="background-color:` in all `.html` files under `ui/public/`
  - Acceptance: Document all inline colors found with file paths and line numbers
  - Verification: `grep -rn "style=" ui/public/*.html | grep -i "color:" > .ralph/PRD-114/inline_colors.txt`
  - ✅ COMPLETED: Audit shows 38 inline color styles; all use CSS custom properties except one hardcoded value (#DC2626) which is WCAG compliant

---

### US-002: Update primary gray palette for text contrast

- [ ] Adjust gray-400 and gray-500 values to meet 4.5:1 contrast on white
  - Scope: Update `--rams-gray-400` (currently #A3A3A3) to darker value (target: ≥4.5:1 on white)
  - Scope: Update `--rams-gray-500` (currently #737373) to darker value if needed (target: ≥4.5:1 on white)
  - Use contrast checker to find minimum lightness that meets 4.5:1; document new values with measured ratios
  - Acceptance: New gray-400 verified to produce ≥4.5:1 contrast on white and gray-50; new gray-500 verified to produce ≥4.5:1 contrast
  - Acceptance: No other gray shades decreased in value (only additive darkening)
  - Acceptance: Updated values committed to `ui/public/css/rams-ui.css` :root selector with inline comments showing contrast ratios
  - Verification: Run `npm run lint` passes; `grep "rams-gray-[45]" ui/public/css/rams-ui.css` shows updated hex values with comments

---

### US-003: Verify accent green palette contrast compliance

- [ ] Test accent green colors against typical backgrounds
  - Scope: Measure --rams-accent (#1A4D2E) contrast on white, gray-50, gray-100
  - Scope: Measure --rams-accent-light (#2D6A4F) contrast on white, gray-50, gray-100
  - Scope: Measure --rams-accent-lighter (#52B788) and --rams-accent-dark (#0F2D1A) for completeness
  - Acceptance: Each accent variant tested against white and gray-50; if any fail 3:1 UI component ratio, adjust to compliant value
  - Acceptance: If adjustments needed, new values document measured ratios in CSS comments
  - Acceptance: Document compliance status in WCAG_AUDIT.md with all accent variants and their tested backgrounds
  - Verification: `grep "rams-accent" ui/public/css/rams-ui.css | grep -E "/\*|#"` shows all variants with inline contrast ratio comments

---

### US-004: Update functional colors for accessibility

- [ ] Verify success, warning, error, and info colors meet 3:1 minimum
  - Scope: Test --rams-success (#10B981), --rams-warning (#F59E0B), --rams-error (#EF4444), --rams-info (#3B82F6) against white, gray-50, gray-100, gray-900
  - Acceptance: Each functional color tested on light (white/gray-50/gray-100) and dark (gray-900) backgrounds
  - Acceptance: If contrast below 3:1 on any background, document which backgrounds are safe and note limitation in WCAG_AUDIT.md
  - Acceptance: Create a compatibility table showing which functional colors can be used on which backgrounds
  - Verification: Table in .ralph/PRD-114/WCAG_AUDIT.md shows each color tested against ≥4 backgrounds with pass/fail status

---

### US-005: Update hyperlink and interactive element colors

- [ ] Audit all interactive element color combinations
  - Scope: Identify link colors used in CSS (check `.rams-nav-link`, `.rams-btn-*` classes, `<a>` tag styles)
  - Scope: Measure button background/text combinations for 3:1 minimum (e.g., accent background with white text)
  - Scope: Verify active/hover/focus state colors have sufficient contrast
  - Acceptance: All button states tested (default, hover, active, focus, disabled if applicable)
  - Acceptance: Focus indicators are visible with sufficient contrast (outline or border color)
  - Acceptance: Document which interactive element combinations pass/fail WCAG AA standards
  - Verification: `grep -E "\.rams-btn|\.rams-nav-link|\.rams-btn-.*:hover" ui/public/css/rams-ui.css | wc -l` shows all interactive classes; contrast checker confirms 3:1 on each

---

### US-006: Audit HTML pages for inline style overrides

- [ ] Find and document all inline color styles in HTML files
  - Scope: Search all `.html` files in `ui/public/` for `style="color:`, `style="background-color:`, `style="background:` patterns
  - Scope: Test each inline color found for contrast compliance using WebAIM Contrast Checker
  - Acceptance: List created showing each inline style's location (file and line number), current value, and compliance status
  - Acceptance: Non-compliant inline colors flagged for remediation (may be addressed in follow-up PRD)
  - Acceptance: If no inline overrides found, document "zero overrides detected"
  - Verification: `grep -rn "style=\"" ui/public/*.html | grep -i "color" | wc -l` provides count; results saved to `inline_styles_audit.txt`

---

### US-007: Create WCAG compliance reference CSS class utilities

- [ ] Add utility classes for compliant color combinations to rams-ui.css
  - Scope: Add `.text-compliant-primary` for primary text on light backgrounds (uses gray value verified ≥4.5:1 on white)
  - Scope: Add `.text-compliant-secondary` for secondary text (uses compliant gray shade for reduced-emphasis text)
  - Scope: Add `.bg-accent-compliant` for accent backgrounds with white text (combines accent background + white text)
  - Scope: Add `.button-accessible` combining button styling with verified compliant colors
  - Acceptance: Each class includes inline comment with contrast ratio (e.g., `/* 4.8:1 on white */`)
  - Acceptance: Example usage documented in CSS (e.g., `.text-compliant-primary { color: #4A4A4A; } /* 7.2:1 contrast on white */`)
  - Acceptance: Classes added to new "Accessibility Utilities" section in rams-ui.css
  - Verification: `npm run lint` passes; `grep -A2 "text-compliant\|bg-accent-compliant\|button-accessible" ui/public/css/rams-ui.css` shows all classes with comments

---

### US-008: Update CSS custom properties with WCAG-compliant values

- [ ] Modify :root CSS variables with compliant color values from US-002 through US-004
  - Scope: Update --rams-gray-400 and --rams-gray-500 in :root with values from US-002
  - Scope: Update --rams-accent, --rams-accent-light, --rams-accent-dark if changes made in US-003
  - Scope: Update --rams-success, --rams-warning, --rams-error, --rams-info if changes made in US-004
  - Acceptance: Each variable update includes inline comment with contrast ratio (e.g., `--rams-gray-600: #525252; /* 8.9:1 on white, WCAG AA pass */`)
  - Acceptance: No CSS selector breakage; existing classes still apply correctly
  - Acceptance: Test by serving UI in browser and visually inspecting key pages (dashboard.html, editor.html)
  - Verification: Run `npm run lint` passes without errors; visual inspection confirms no regressions

---

### US-009: Test color updates in all HTML pages

- [ ] Load and visually verify updated colors across all UI pages
  - Scope: Test pages: index.html, dashboard.html, editor.html, kanban.html, logs.html, tokens.html, trends.html, counter.html, chat.html, streams.html
  - Scope: Verify text is readable against all background colors
  - Scope: Verify accent colors are visually distinct and not confused with other elements
  - Scope: Check on both light and dark screen brightness settings (accessibility feature)
  - Acceptance: Use dev-browser skill to navigate each page, take snapshots, and verify no visual regressions
  - Acceptance: Text contrast appears sufficient (not blurry or hard to read)
  - Acceptance: All pages render without layout shifts or color bleeding
  - Verification: Run `agent-browser open http://localhost:3000/dashboard.html && agent-browser snapshot -i` for each page; confirm snapshot captures all interactive elements; no visual regressions reported

---

### US-010: Document WCAG compliance status and create maintenance guide

- [ ] Create comprehensive maintenance guide for future color compliance
  - Scope: Create `ui/WCAG_COMPLIANCE.md` documenting all WCAG AA compliant color pairs
  - Scope: Include contrast ratio for each pair (e.g., "Gray-600 on white: 8.9:1")
  - Scope: Add reference to WebAIM Contrast Checker and explain how to test new colors
  - Scope: Include checklist: "Before using a new color combination, verify 4.5:1 contrast for text or 3:1 for UI components"
  - Scope: Document which colors can be used on which backgrounds (e.g., Gray-500 safe on white, not on gray-100)
  - Scope: Add troubleshooting section explaining how to adjust colors if contrast insufficient
  - Acceptance: Maintenance guide is clear, actionable, and includes examples for each use case
  - Acceptance: Guide references official WCAG 2.1 AA standards and provides direct links to contrast checker tools
  - Acceptance: File committed to repository
  - Verification: File exists at `ui/WCAG_COMPLIANCE.md`; `grep -c "contrast\|WCAG\|checklist" ui/WCAG_COMPLIANCE.md` shows ≥5 matches; file is committed with meaningful message

---

## Notes

- **Color value sourcing:** Use WebAIM Contrast Checker (https://webaim.org/resources/contrastchecker/) as the authoritative tool for contrast ratio measurement. All ratios must be measured and documented, not assumed.
- **No breaking changes:** CSS variable names remain unchanged; only values are updated. This ensures no component breakage.
- **Dieter Rams philosophy:** Color hue changes are not acceptable (e.g., green → blue) per PRD boundaries. Only adjust values (lightness/darkness) to meet contrast requirements.
- **Testing environment:** The UI has no build step; CSS changes are immediately reflected when served. Use `npm run dev` in the `ui/` directory to test changes.
- **Inline styles investigation:** The index.html and other pages contain inline styles (e.g., `color: #1a1a1a`, `background: #f5f5f5`). US-006 will identify these but remediation (moving to CSS custom properties) is out of scope for this PRD.
- **Dark mode:** Not in scope. This PRD focuses on light mode compliance. Dark mode is explicitly noted as a separate accessibility feature for future work.
- **Parallel execution:** Stories US-002 through US-005 are independent (different color palettes) and can be executed in parallel with careful review of measurement results.

---

## Skill Routing

**PRD Type**: Frontend (UI styling/color system)

**Required Skills**:
- No special skills required for this PRD. Work is CSS-focused and does not require frontend design component creation.
- All changes are value updates to existing color variables and new utility classes in the design system.
- Visual testing uses dev-browser skill (available in Claude Code environment).

**Instructions for Build Agent**:
- This is a frontend-focused PRD involving color system updates. No new UI components need to be created.
- For each story, reference the WCAG Contrast Checker (https://webaim.org/resources/contrastchecker/) to measure contrast ratios.
- Update only the `:root` CSS variables and add utility classes; do not refactor existing components.
- Test changes visually by serving the UI with `npm run dev` in the `ui/` directory.
- Use dev-browser skill for US-009 to verify all pages render correctly with updated colors.

