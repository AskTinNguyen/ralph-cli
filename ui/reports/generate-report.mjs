/**
 * Generate PDF Report for Ralph CLI UI Fixes
 *
 * This script creates a PDF report with screenshots demonstrating
 * the UI fixes implemented based on the technical evaluation.
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function generateReport() {
  const pdfDoc = await PDFDocument.create();
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Page dimensions (Letter size)
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 50;

  // Title page
  const titlePage = pdfDoc.addPage([pageWidth, pageHeight]);
  titlePage.drawText('Ralph CLI UI Fixes Report', {
    x: margin,
    y: pageHeight - 100,
    size: 28,
    font: helveticaBold,
    color: rgb(0.1, 0.1, 0.1),
  });

  titlePage.drawText('Technical Evaluation Implementation', {
    x: margin,
    y: pageHeight - 140,
    size: 18,
    font: helvetica,
    color: rgb(0.3, 0.3, 0.3),
  });

  titlePage.drawText(`Generated: ${new Date().toISOString().split('T')[0]}`, {
    x: margin,
    y: pageHeight - 180,
    size: 12,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });

  // Summary section
  const summaryY = pageHeight - 250;
  titlePage.drawText('Summary of Fixes', {
    x: margin,
    y: summaryY,
    size: 16,
    font: helveticaBold,
    color: rgb(0.1, 0.1, 0.1),
  });

  const fixes = [
    '1. Path Resolution Bug - Added lib/cli/paths.js utility',
    '2. Agent Availability Warning - Shows warning for unavailable agents',
    '3. Status Inconsistency - Formats "in_progress" as "In Progress"',
    '4. Stream Search Filter - Filters 66+ streams in dropdown',
    '5. Merge Button Logic - Enables with any progress (not just 100%)',
    '6. Empty Logs Display - Fixed regex and added fallback',
  ];

  let currentY = summaryY - 30;
  for (const fix of fixes) {
    titlePage.drawText(fix, {
      x: margin + 20,
      y: currentY,
      size: 11,
      font: helvetica,
      color: rgb(0.2, 0.2, 0.2),
    });
    currentY -= 20;
  }

  // Files changed section
  currentY -= 30;
  titlePage.drawText('Files Changed', {
    x: margin,
    y: currentY,
    size: 16,
    font: helveticaBold,
    color: rgb(0.1, 0.1, 0.1),
  });

  const files = [
    'lib/cli/paths.js (new)',
    'lib/cli/index.js',
    'bin/ralph',
    'ui/src/services/agent-checker.ts (new)',
    'ui/src/routes/api.ts',
    'ui/src/services/log-parser.ts',
    'ui/src/services/state-reader.ts',
    'ui/public/dashboard.html',
  ];

  currentY -= 25;
  for (const file of files) {
    titlePage.drawText(`• ${file}`, {
      x: margin + 20,
      y: currentY,
      size: 10,
      font: helvetica,
      color: rgb(0.3, 0.3, 0.3),
    });
    currentY -= 16;
  }

  // Screenshot pages
  const screenshots = [
    { file: '01-dashboard-overview.png', title: 'Dashboard Overview', description: 'Shows the main dashboard with agent selector and stream search input' },
    { file: '02-agent-warning.png', title: 'Agent Availability Warning', description: 'Warning displayed when selecting Droid (not installed)' },
    { file: '03-stream-search-filter.png', title: 'Stream Search Filter', description: 'Filtering streams by "TUI" reduces options from 67 to 1' },
    { file: '04-streams-status-merge.png', title: 'Streams Page - Status & Merge', description: 'Shows formatted status ("In Progress") and enabled merge buttons for PRDs with progress' },
    { file: '05-logs-activity.png', title: 'Activity Logs', description: 'Logs page now displays activity entries properly' },
  ];

  for (const screenshot of screenshots) {
    const imagePath = path.join(__dirname, screenshot.file);

    if (!fs.existsSync(imagePath)) {
      console.log(`Skipping ${screenshot.file} - not found`);
      continue;
    }

    const imageBytes = fs.readFileSync(imagePath);
    const image = await pdfDoc.embedPng(imageBytes);

    const page = pdfDoc.addPage([pageWidth, pageHeight]);

    // Title
    page.drawText(screenshot.title, {
      x: margin,
      y: pageHeight - 50,
      size: 18,
      font: helveticaBold,
      color: rgb(0.1, 0.1, 0.1),
    });

    // Description
    page.drawText(screenshot.description, {
      x: margin,
      y: pageHeight - 75,
      size: 11,
      font: helvetica,
      color: rgb(0.4, 0.4, 0.4),
    });

    // Calculate image dimensions to fit on page
    const maxWidth = pageWidth - (margin * 2);
    const maxHeight = pageHeight - 150;

    const imgAspect = image.width / image.height;
    let imgWidth = maxWidth;
    let imgHeight = imgWidth / imgAspect;

    if (imgHeight > maxHeight) {
      imgHeight = maxHeight;
      imgWidth = imgHeight * imgAspect;
    }

    // Center image horizontally
    const imgX = (pageWidth - imgWidth) / 2;
    const imgY = pageHeight - 100 - imgHeight;

    page.drawImage(image, {
      x: imgX,
      y: imgY,
      width: imgWidth,
      height: imgHeight,
    });

    // Border around image
    page.drawRectangle({
      x: imgX - 1,
      y: imgY - 1,
      width: imgWidth + 2,
      height: imgHeight + 2,
      borderColor: rgb(0.8, 0.8, 0.8),
      borderWidth: 1,
    });
  }

  // Save PDF
  const pdfBytes = await pdfDoc.save();
  const outputPath = path.join(__dirname, 'ralph-ui-fixes-report.pdf');
  fs.writeFileSync(outputPath, pdfBytes);

  console.log(`Report generated: ${outputPath}`);
  console.log(`Total pages: ${pdfDoc.getPageCount()}`);
}

generateReport().catch(console.error);
