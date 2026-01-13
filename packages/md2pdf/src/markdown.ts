import MarkdownIt from "markdown-it";
import * as fs from "fs";
import * as path from "path";

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

// Load default CSS from file
function loadDefaultCSS(): string {
  const defaultCSSPath = path.join(__dirname, "styles", "default.css");
  return fs.readFileSync(defaultCSSPath, "utf-8");
}

export interface RenderOptions {
  customCSS?: string[];
}

export function renderMarkdown(markdown: string | string[], options?: RenderOptions): string {
  let htmlBody: string;

  if (Array.isArray(markdown)) {
    // Multiple files: merge with page breaks between them
    const renderedSections = markdown.map((md_content) => md.render(md_content));
    // First section doesn't need page-break class, subsequent ones do
    htmlBody = renderedSections
      .map((section, index) => {
        if (index === 0) {
          return section;
        }
        return `<div class="page-break">${section}</div>`;
      })
      .join("\n");
  } else {
    // Single file
    htmlBody = md.render(markdown);
  }

  // Build CSS content: default first, then custom
  const defaultCSS = loadDefaultCSS();
  const customCSSContent = options?.customCSS?.join("\n") || "";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    ${defaultCSS}
  </style>
  ${customCSSContent ? `<style>\n${customCSSContent}\n  </style>` : ""}
</head>
<body>
  ${htmlBody}
</body>
</html>
  `.trim();
}
