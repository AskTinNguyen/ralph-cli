# PRD: Markdown to PDF CLI Tool

## Introduction

A command-line tool for converting Markdown files to PDF, designed primarily for generating developer documentation. The tool supports batch processing of multiple files or entire directories, with the ability to merge documents into a single PDF. It provides professional output with customizable styling via CSS, page layout controls including headers, footers, and table of contents, and comprehensive Markdown support including GFM extensions, syntax highlighting, and math/diagram rendering.

## Goals

- Convert Markdown files to high-quality PDF documents suitable for developer documentation
- Support batch processing: multiple files merged into one PDF, or directory-wide conversion
- Provide customizable styling through CSS
- Generate professional page layouts with headers, footers, and auto-generated table of contents
- Support extended Markdown syntax including GFM, syntax-highlighted code blocks, LaTeX math, and diagrams (Mermaid/PlantUML)

## User Stories

### [x] US-001: Single File Conversion
**Description:** As a developer, I want to convert a single Markdown file to PDF so that I can share documentation in a portable format.

**Acceptance Criteria:**
- [x] CLI command: `md2pdf input.md` produces `input.pdf` in same directory
- [x] CLI command: `md2pdf input.md -o output.pdf` produces PDF at specified path
- [x] Example: `md2pdf README.md` -> `README.pdf` created
- [x] Negative case: non-existent file -> clear error message with exit code 1
- [x] Negative case: non-markdown file -> warning message, attempt conversion anyway
- [x] Typecheck/lint passes

### [x] US-002: Multiple File Merge
**Description:** As a developer, I want to merge multiple Markdown files into a single PDF so that I can create cohesive documentation from modular source files.

**Acceptance Criteria:**
- [x] CLI command: `md2pdf file1.md file2.md file3.md -o combined.pdf`
- [x] Files merged in order specified on command line
- [x] Page break inserted between each source file
- [x] Example: `md2pdf intro.md api.md examples.md -o docs.pdf` -> single PDF with 3 sections
- [x] Negative case: mix of valid and invalid files -> error listing invalid files, no partial output
- [x] Typecheck/lint passes

### [x] US-003: Directory Batch Processing
**Description:** As a developer, I want to convert all Markdown files in a directory to PDFs so that I can process documentation in bulk.

**Acceptance Criteria:**
- [x] CLI command: `md2pdf ./docs/` converts all `.md` files in directory
- [x] Each file produces a corresponding PDF in same directory (or specified output directory)
- [x] Option `--recursive` or `-r` to include subdirectories
- [x] Option `--output-dir` or `-d` to specify output directory
- [x] Example: `md2pdf ./docs/ -d ./pdfs/` -> all PDFs in `./pdfs/`
- [x] Negative case: empty directory -> warning message, exit code 0
- [x] Negative case: no read permission -> error with specific file paths
- [x] Typecheck/lint passes

### [x] US-004: Directory Merge Mode
**Description:** As a developer, I want to merge all Markdown files in a directory into a single PDF so that I can create a unified document from a documentation folder.

**Acceptance Criteria:**
- [x] CLI command: `md2pdf ./docs/ --merge -o documentation.pdf`
- [x] Files sorted alphabetically by default, or by numeric prefix (e.g., `01-intro.md`, `02-setup.md`)
- [x] Option `--sort` with values: `alpha`, `numeric`, `natural`
- [x] Example: `md2pdf ./docs/ --merge --sort natural -o book.pdf`
- [x] Negative case: directory with no .md files -> error message
- [x] Typecheck/lint passes

### [x] US-005: Custom CSS Styling
**Description:** As a developer, I want to apply custom CSS to my PDF output so that I can match my organization's documentation style.

**Acceptance Criteria:**
- [x] CLI option: `--css style.css` to apply custom stylesheet
- [x] Multiple CSS files supported: `--css base.css --css theme.css`
- [x] Built-in default stylesheet applied when no CSS specified
- [x] CSS supports print-specific properties (@page, page-break-*, etc.)
- [x] Example: `md2pdf doc.md --css corporate.css` -> PDF with custom styling
- [x] Negative case: invalid CSS file path -> error with path shown
- [x] Negative case: malformed CSS -> warning, continue with valid rules
- [x] Typecheck/lint passes

### [x] US-006: Page Layout - Headers and Footers
**Description:** As a developer, I want to add headers and footers to my PDF pages so that documents include page numbers, titles, and dates.

**Acceptance Criteria:**
- [x] CLI options: `--header "Document Title"` and `--footer "Page {page} of {pages}"`
- [x] Placeholder variables: `{page}`, `{pages}`, `{date}`, `{title}`, `{filename}`
- [x] Option `--header-template` and `--footer-template` for HTML templates
- [x] First page can optionally exclude header/footer with `--no-first-page-header`
- [x] Example: `md2pdf doc.md --footer "Page {page}"` -> page numbers in footer
- [x] Typecheck/lint passes

### [ ] US-007: Table of Contents Generation
**Description:** As a developer, I want an auto-generated table of contents so that readers can navigate long documents.

**Acceptance Criteria:**
- [ ] CLI option: `--toc` to generate table of contents
- [ ] TOC generated from Markdown headings (h1-h6)
- [ ] Option `--toc-depth N` to limit heading depth (default: 3)
- [ ] Option `--toc-title "Contents"` to customize TOC heading
- [ ] TOC includes clickable links to sections (PDF bookmarks)
- [ ] TOC placed at beginning of document, after title page if present
- [ ] Example: `md2pdf doc.md --toc --toc-depth 2` -> TOC with h1 and h2 only
- [ ] Typecheck/lint passes

### [ ] US-008: Standard Markdown Rendering
**Description:** As a developer, I want standard Markdown syntax rendered correctly so that basic documentation looks professional.

**Acceptance Criteria:**
- [ ] Headings (h1-h6) with appropriate sizing hierarchy
- [ ] Paragraphs with proper spacing
- [ ] Bold, italic, strikethrough formatting
- [ ] Ordered and unordered lists, including nested lists
- [ ] Links rendered as clickable URLs in PDF
- [ ] Images embedded in PDF (local and remote URLs)
- [ ] Blockquotes with visual styling
- [ ] Horizontal rules
- [ ] Inline code with monospace font
- [ ] Typecheck/lint passes

### [ ] US-009: GitHub Flavored Markdown (GFM) Support
**Description:** As a developer, I want GFM extensions supported so that my GitHub README files render correctly.

**Acceptance Criteria:**
- [ ] Tables with proper cell alignment
- [ ] Task lists (checkboxes) rendered visually
- [ ] Autolinks for URLs and emails
- [ ] Strikethrough with `~~text~~`
- [ ] Example: GFM table with alignment -> properly aligned PDF table
- [ ] Typecheck/lint passes

### [ ] US-010: Syntax Highlighted Code Blocks
**Description:** As a developer, I want code blocks with syntax highlighting so that code examples are readable and professional.

**Acceptance Criteria:**
- [ ] Fenced code blocks with language identifier: ```javascript
- [ ] Syntax highlighting for common languages (js, ts, python, go, rust, java, c, cpp, bash, json, yaml, html, css, sql, etc.)
- [ ] Option `--highlight-theme` to choose color scheme (e.g., github, monokai, dracula)
- [ ] Line numbers optional: `--line-numbers`
- [ ] Preserve code block indentation and spacing
- [ ] Example: ```python block -> highlighted Python code with chosen theme
- [ ] Negative case: unknown language -> render as plain monospace, no error
- [ ] Typecheck/lint passes

### [ ] US-011: Math Rendering (LaTeX)
**Description:** As a developer, I want LaTeX math expressions rendered so that technical documentation includes proper equations.

**Acceptance Criteria:**
- [ ] Inline math with `$...$` or `\(...\)`
- [ ] Block math with `$$...$$` or `\[...\]`
- [ ] Common LaTeX math syntax supported (fractions, summations, integrals, matrices, Greek letters)
- [ ] Example: `$E = mc^2$` -> properly rendered equation
- [ ] Negative case: invalid LaTeX -> render raw text with warning
- [ ] Typecheck/lint passes

### [ ] US-012: Diagram Rendering (Mermaid)
**Description:** As a developer, I want Mermaid diagrams rendered so that I can include flowcharts and sequence diagrams in documentation.

**Acceptance Criteria:**
- [ ] Mermaid code blocks (```mermaid) rendered as images
- [ ] Support for: flowchart, sequence, class, state, ER, gantt, pie charts
- [ ] Diagrams scale appropriately for page width
- [ ] Example: ```mermaid flowchart -> rendered flowchart image
- [ ] Negative case: invalid Mermaid syntax -> error message in output, red box placeholder
- [ ] Typecheck/lint passes

### [ ] US-013: Page Size and Margins
**Description:** As a developer, I want to control page size and margins so that output matches print requirements.

**Acceptance Criteria:**
- [ ] Option `--page-size` with values: letter, a4, legal, or custom WxH
- [ ] Option `--margin` with value in inches or mm (e.g., `--margin 1in` or `--margin 25mm`)
- [ ] Individual margin options: `--margin-top`, `--margin-bottom`, `--margin-left`, `--margin-right`
- [ ] Option `--landscape` for landscape orientation
- [ ] Default: A4, 1-inch margins, portrait
- [ ] Example: `md2pdf doc.md --page-size letter --margin 0.75in`
- [ ] Typecheck/lint passes

### [ ] US-014: Configuration File Support
**Description:** As a developer, I want to use a configuration file so that I don't have to repeat CLI options for every conversion.

**Acceptance Criteria:**
- [ ] Reads `.md2pdfrc` or `md2pdf.config.json` from current directory
- [ ] Supports YAML or JSON format
- [ ] CLI options override config file values
- [ ] Option `--config path/to/config` to specify custom config location
- [ ] Example config: `{ "css": "style.css", "toc": true, "pageSize": "letter" }`
- [ ] Negative case: invalid config format -> error with parse details
- [ ] Typecheck/lint passes

### [ ] US-015: Watch Mode
**Description:** As a developer, I want a watch mode so that PDFs regenerate automatically when I save changes.

**Acceptance Criteria:**
- [ ] CLI option: `--watch` or `-w`
- [ ] Watches source Markdown files for changes
- [ ] Regenerates PDF on file save
- [ ] Outputs timestamp and filename on each regeneration
- [ ] Graceful exit on Ctrl+C
- [ ] Example: `md2pdf doc.md -w` -> regenerates `doc.pdf` on each save
- [ ] Typecheck/lint passes

## Routing Policy

- Commit URLs are invalid.
- Unknown GitHub subpaths canonicalize to repo root.

## Functional Requirements

- FR-1: The CLI must accept one or more Markdown file paths as input arguments
- FR-2: The CLI must accept a directory path and process all `.md` files within
- FR-3: The CLI must support `-o` or `--output` flag to specify output path
- FR-4: The CLI must support `--merge` flag to combine multiple inputs into one PDF
- FR-5: The CLI must support `--css` flag (repeatable) for custom stylesheets
- FR-6: The CLI must support `--toc` flag to generate table of contents
- FR-7: The CLI must support `--header` and `--footer` flags with placeholder variables
- FR-8: The CLI must support `--page-size`, `--margin`, and `--landscape` flags
- FR-9: The CLI must render GFM tables, task lists, and autolinks
- FR-10: The CLI must apply syntax highlighting to fenced code blocks
- FR-11: The CLI must render LaTeX math expressions (inline and block)
- FR-12: The CLI must render Mermaid diagram code blocks as images
- FR-13: The CLI must read configuration from `.md2pdfrc` or `md2pdf.config.json`
- FR-14: The CLI must support `--watch` mode for automatic regeneration
- FR-15: The CLI must exit with code 0 on success, non-zero on error
- FR-16: The CLI must display `--help` with usage information and all options
- FR-17: The CLI must display `--version` with current version number

## Non-Goals

- No GUI or web interface (CLI only)
- No real-time collaborative editing
- No PDF editing or manipulation (merge, split, encrypt) of existing PDFs
- No HTML output format (PDF only)
- No EPUB or other ebook format output
- No cloud storage integration (local files only)
- No custom fonts beyond system fonts and web-safe fonts
- No PlantUML support (Mermaid only for diagrams)
- No interactive PDF elements (forms, JavaScript)

## Technical Considerations

- Consider using Puppeteer/Playwright for PDF generation (headless Chrome)
- Alternative: use a library like markdown-pdf, md-to-pdf, or pandoc wrapper
- Mermaid rendering may require puppeteer or mermaid-cli
- Math rendering: consider KaTeX (faster) vs MathJax (more complete)
- Syntax highlighting: highlight.js or Prism
- Should work cross-platform: macOS, Linux, Windows
- Distribute via npm for easy installation: `npm install -g md2pdf`
- Consider bundling with pkg or similar for standalone binary distribution

## Success Metrics

- Single file conversion completes in under 2 seconds for typical README
- Batch processing handles 100+ files without memory issues
- Generated PDFs are under 5MB for typical documentation
- All GFM features render correctly compared to GitHub preview
- Code blocks are syntax highlighted with correct language detection
- Math and diagrams render without errors for valid input

## Open Questions

- Should we support PlantUML in addition to Mermaid?
- Should there be a default theme option (light/dark) for code highlighting?
- Should we support DOCX output in addition to PDF?
- Should there be an option to embed fonts for consistent cross-platform rendering?
- Should we support front matter (YAML) for per-document configuration?
- What should the CLI name be? (`md2pdf`, `mdpdf`, `markdown-pdf`?)
