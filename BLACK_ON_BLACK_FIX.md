# Black-on-Black Text Issue - Root Cause Analysis

## The Problem

Users were seeing **black text on black background** in code blocks and other dark sections.

**Example:**
- Background: `rgb(23, 23, 23)` (almost black)
- Text: `rgb(23, 23, 23)` (SAME color!)
- **Contrast Ratio**: 1:1 (completely unreadable)

## Root Cause

### CSS Inheritance Chain Failure

The design system had a critical CSS specificity gap:

**1. Global Text Color (Too Broad)**
```css
.rams-page {
  color: var(--rams-gray-900);  /* #171717 = rgb(23, 23, 23) - dark gray */
  background: var(--rams-white);
}
```
All elements inherit this **dark text color** by default.

**2. Dark Background Components (Missing Override)**
```css
.rams-code-block {
  background: var(--rams-gray-900);  /* #171717 = SAME dark gray! */
  /* ❌ NO color override here! */
}
```

**3. Light Text Override (Too Specific)**
```css
.rams-code-content pre {
  color: #E5E5E5;  /* Light gray - only applies to <pre> tags! */
}
```

### The Inheritance Problem

```
┌─ .rams-page (color: dark gray) ─────────────┐
│                                              │
│  ┌─ .rams-code-block (bg: dark gray) ─────┐ │
│  │                                          │ │
│  │  ❌ Inherits dark text from parent!     │ │
│  │                                          │ │
│  │  ┌─ .rams-code-content ──────────────┐  │ │
│  │  │                                    │  │ │
│  │  │  ┌─ pre (color: light gray) ────┐ │  │ │
│  │  │  │ ✅ Only this has light text  │ │  │ │
│  │  │  └────────────────────────────────┘ │  │ │
│  │  │                                    │  │ │
│  │  │  ❌ Other elements still dark!    │  │ │
│  │  └────────────────────────────────────┘  │ │
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

### Why We Missed It Initially

1. **Focused on alerts first** - I replaced inline styles on alert boxes but didn't audit existing code block styles
2. **CSS looked correct** - The `pre` tags HAD light text, so it seemed fine
3. **Specificity trap** - Didn't realize other text elements would inherit the global dark color
4. **No visual testing** - Initial fixes were CSS-only without browser verification

## The Fix

### Added Text Color to Dark Background Components

**Before:**
```css
.rams-code-block {
  background: var(--rams-gray-900);
  /* No text color override */
}
```

**After:**
```css
.rams-code-block {
  background: var(--rams-gray-900);
  /* CRITICAL: Override inherited dark text color */
  color: #E5E5E5;  /* Light gray for all children */
}
```

**Result:**
- Background: `rgb(23, 23, 23)` (dark gray)
- Text: `rgb(229, 229, 229)` (light gray)
- **Contrast Ratio**: 12.4:1 ✅ (WCAG AAA compliant)

### Also Fixed `.rams-output`

```css
.rams-output {
  background: var(--rams-gray-900);
  color: var(--rams-gray-400);  /* Added this */
}
```

## Testing Results

### Before Fix
```json
{
  "backgroundColor": "rgb(23, 23, 23)",
  "color": "rgb(23, 23, 23)",
  "contrastRatio": "1:1 (unreadable)"
}
```

### After Fix
```json
{
  "backgroundColor": "rgb(23, 23, 23)",
  "color": "rgb(229, 229, 229)",
  "contrastRatio": "12.4:1 (WCAG AAA)"
}
```

## Lessons Learned

### Why This Happened

1. **CSS Cascade Assumptions** - Assumed light text would cascade down, but inheritance works the opposite way
2. **Over-Specific Selectors** - Light text was only on `pre` tags, not the parent container
3. **Incomplete Visual Testing** - Should have done browser testing BEFORE declaring fixes complete
4. **Design System Gaps** - Dark background components MUST explicitly set light text

### Best Practices Going Forward

✅ **DO:**
- Always set BOTH background AND foreground colors together
- Test in actual browser, not just CSS review
- Use contrast checking tools during development
- Set color on the parent of dark backgrounds, not just specific children

❌ **DON'T:**
- Assume CSS inheritance will "just work"
- Rely only on specific child selectors for critical styles
- Skip visual verification in real browsers
- Trust computed values without seeing actual rendered result

## WCAG Compliance

### Before
- ❌ 1.4.3 Contrast (Minimum): FAIL - 1:1 ratio
- ❌ 1.4.6 Contrast (Enhanced): FAIL - 1:1 ratio

### After
- ✅ 1.4.3 Contrast (Minimum): PASS - 12.4:1 (requires 4.5:1)
- ✅ 1.4.6 Contrast (Enhanced): PASS - 12.4:1 (requires 7:1)
- ✅ Exceeds WCAG AAA standard

## Files Changed

1. `/ui/public/docs/rams-design-system.css` - Added `color: #E5E5E5` to `.rams-code-block` and `.rams-output`
2. `/docs/docs/rams-design-system.css` - Synchronized

## Verification Commands

```bash
# Reload page
agent-browser reload

# Check code block colors
agent-browser eval "(() => {
  const codeBlock = document.querySelector('.rams-code-block');
  const styles = window.getComputedStyle(codeBlock);
  return {
    bg: styles.backgroundColor,
    color: styles.color
  };
})()"

# Take screenshot
agent-browser screenshot /tmp/test.png --full
```

## Contrast Ratio Calculation

**Formula:** `(L1 + 0.05) / (L2 + 0.05)` where L1 > L2

**Light gray text (229, 229, 229):**
- Relative luminance ≈ 0.756

**Dark gray background (23, 23, 23):**
- Relative luminance ≈ 0.015

**Contrast Ratio:**
```
(0.756 + 0.05) / (0.015 + 0.05) = 12.4:1
```

**WCAG Requirements:**
- AA: 4.5:1 ✅
- AAA: 7:1 ✅

We exceed both!
