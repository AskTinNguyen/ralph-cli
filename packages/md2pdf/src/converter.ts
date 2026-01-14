import puppeteer from "puppeteer";
import * as path from "path";

export interface HeaderFooterOptions {
  header?: string;
  footer?: string;
  headerTemplate?: string;
  footerTemplate?: string;
  noFirstPageHeader?: boolean;
  filename?: string;
  title?: string;
}

/**
 * Default CSS for header/footer styling
 */
const defaultHeaderFooterStyles = `
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  font-size: 10px;
  width: 100%;
  padding: 0 1in;
  box-sizing: border-box;
`;

/**
 * Replace placeholder variables in header/footer text
 * Puppeteer provides: pageNumber, totalPages, date, title, url
 * We map our placeholders to Puppeteer's special CSS classes
 */
function processPlaceholders(text: string): string {
  return text
    .replace(/\{page\}/g, '<span class="pageNumber"></span>')
    .replace(/\{pages\}/g, '<span class="totalPages"></span>')
    .replace(/\{date\}/g, '<span class="date"></span>')
    .replace(/\{title\}/g, '<span class="title"></span>')
    .replace(/\{filename\}/g, '<span class="url"></span>');
}

/**
 * Build HTML template for header or footer
 * @param text - Simple text with placeholders
 * @param htmlTemplate - Custom HTML template (takes precedence over text)
 * @param position - Whether this is a header or footer
 */
function buildTemplate(
  text: string | undefined,
  htmlTemplate: string | undefined,
  position: "header" | "footer"
): string | undefined {
  // Custom HTML template takes precedence
  if (htmlTemplate) {
    return htmlTemplate;
  }

  // Simple text with placeholders
  if (text) {
    const processed = processPlaceholders(text);
    const justify = position === "header" ? "center" : "center";
    return `
      <div style="${defaultHeaderFooterStyles} text-align: ${justify};">
        ${processed}
      </div>
    `;
  }

  return undefined;
}

export async function convertMarkdownToPdf(
  html: string,
  outputPath: string,
  options?: HeaderFooterOptions
): Promise<void> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    // Get filename for placeholder replacement
    const filename = options?.filename || path.basename(outputPath, ".pdf");

    // Build header and footer templates
    let headerTemplate = buildTemplate(options?.header, options?.headerTemplate, "header");
    let footerTemplate = buildTemplate(options?.footer, options?.footerTemplate, "footer");

    // Replace filename placeholder (url class in Puppeteer shows full path, we want just filename)
    if (headerTemplate) {
      headerTemplate = headerTemplate.replace(
        /<span class="url"><\/span>/g,
        `<span>${filename}</span>`
      );
    }
    if (footerTemplate) {
      footerTemplate = footerTemplate.replace(
        /<span class="url"><\/span>/g,
        `<span>${filename}</span>`
      );
    }

    // Determine if we need to display header/footer
    const displayHeaderFooter = !!(headerTemplate || footerTemplate);

    // Adjust margins if we have headers/footers
    const margin = displayHeaderFooter
      ? {
          top: "1.25in", // More space for header
          right: "1in",
          bottom: "1.25in", // More space for footer
          left: "1in",
        }
      : {
          top: "1in",
          right: "1in",
          bottom: "1in",
          left: "1in",
        };

    // Handle first page header exclusion
    // Puppeteer doesn't natively support excluding headers from first page,
    // but we can achieve this with JavaScript in the template
    if (options?.noFirstPageHeader && (headerTemplate || footerTemplate)) {
      // Add script to hide content on first page
      const hideScript = `
        <script>
          (function() {
            var pageNum = document.querySelector('.pageNumber');
            if (pageNum && pageNum.textContent === '1') {
              document.body.style.visibility = 'hidden';
            }
          })();
        </script>
      `;
      if (headerTemplate) {
        headerTemplate = headerTemplate + hideScript;
      }
      if (footerTemplate) {
        footerTemplate = footerTemplate + hideScript;
      }
    }

    await page.pdf({
      path: outputPath,
      format: "A4",
      margin,
      printBackground: true,
      displayHeaderFooter,
      headerTemplate: headerTemplate || "",
      footerTemplate: footerTemplate || "",
    });
  } finally {
    await browser.close();
  }
}
