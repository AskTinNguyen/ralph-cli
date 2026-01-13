#!/usr/bin/env node

import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { convertMarkdownToPdf } from "./converter";
import { renderMarkdown } from "./markdown";
import { isDirectory, discoverMarkdownFiles, SortStrategy } from "./files";
import { loadCSSFiles } from "./css-loader";
import packageJson from "../package.json";

const program = new Command();

interface CliOptions {
  output?: string;
  outputDir?: string;
  recursive?: boolean;
  merge?: boolean;
  sort?: SortStrategy;
  css?: string[];
}

program
  .name("md2pdf")
  .description("Convert Markdown files to PDF")
  .version(packageJson.version)
  .argument("<input...>", "Input Markdown file(s) or directory")
  .option("-o, --output <path>", "Output PDF file path")
  .option("-d, --output-dir <path>", "Output directory for batch conversion")
  .option("-r, --recursive", "Include subdirectories when processing a directory")
  .option("--merge", "Merge all files from a directory into a single PDF")
  .option("--sort <strategy>", "Sort strategy for merging: alpha, numeric, or natural (default: natural)")
  .option("--css <file>", "Custom CSS stylesheet (can be specified multiple times)", (value, previous) => {
    const prev = previous || [];
    return [...prev, value];
  }, [] as string[])
  .action(async (inputs: string[], options: CliOptions) => {
    try {
      // Load custom CSS if provided
      let customCSS: string[] | undefined;
      if (options.css && options.css.length > 0) {
        customCSS = loadCSSFiles(options.css);
      }

      // Check if the input is a single directory
      if (inputs.length === 1 && isDirectory(inputs[0])) {
        await handleDirectoryInput(inputs[0], options, customCSS);
        return;
      }

      // Handle file inputs (single or multiple)
      await handleFileInputs(inputs, options, customCSS);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Error: ${error.message}`);
      } else {
        console.error("An unexpected error occurred");
      }
      process.exit(1);
    }
  });

async function handleDirectoryMerge(
  dirPath: string,
  markdownFiles: string[],
  options: CliOptions,
  customCSS?: string[]
): Promise<void> {
  // Require -o flag in merge mode
  if (!options.output) {
    console.error("Error: Output path (-o) is required when using --merge");
    process.exit(1);
  }

  // Read all markdown files
  console.log(`Merging ${markdownFiles.length} Markdown file(s)...`);
  const markdownContents = markdownFiles.map((file) => {
    console.log(`  - ${path.relative(dirPath, file)}`);
    return fs.readFileSync(file, "utf-8");
  });

  // Convert to HTML and then to PDF
  const html = renderMarkdown(markdownContents, { customCSS });
  await convertMarkdownToPdf(html, options.output);

  console.log(`\nMerged PDF created: ${options.output}`);
}

async function handleDirectoryInput(dirPath: string, options: CliOptions, customCSS?: string[]): Promise<void> {
  // Validate sort strategy
  if (options.sort && !["alpha", "numeric", "natural"].includes(options.sort)) {
    console.error(`Error: Invalid sort strategy "${options.sort}". Must be one of: alpha, numeric, natural`);
    process.exit(1);
  }

  // Discover markdown files in directory
  const markdownFiles = discoverMarkdownFiles(dirPath, {
    recursive: options.recursive,
    sort: options.sort || "natural"
  });

  // Check for empty directory
  if (markdownFiles.length === 0) {
    if (options.merge) {
      console.error(`Error: No Markdown files found in directory: ${dirPath}`);
      process.exit(1);
    } else {
      console.warn(`Warning: No Markdown files found in directory: ${dirPath}`);
      process.exit(0);
    }
  }

  // Handle merge mode
  if (options.merge) {
    await handleDirectoryMerge(dirPath, markdownFiles, options, customCSS);
    return;
  }

  // Determine output directory
  const outputDir = options.outputDir || dirPath;

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Convert each file individually
  console.log(`Found ${markdownFiles.length} Markdown file(s)`);
  let successCount = 0;
  const errors: { file: string; error: string }[] = [];

  for (const inputFile of markdownFiles) {
    try {
      // Determine output path based on input file
      let outputPath: string;
      if (options.outputDir) {
        // When using --output-dir, preserve relative directory structure
        const relativePath = path.relative(dirPath, inputFile);
        const outputFileName = relativePath.replace(/\.[^.]+$/, ".pdf");
        outputPath = path.join(outputDir, outputFileName);

        // Create output subdirectories if needed
        const outputFileDir = path.dirname(outputPath);
        if (!fs.existsSync(outputFileDir)) {
          fs.mkdirSync(outputFileDir, { recursive: true });
        }
      } else {
        // When not using --output-dir, put PDFs next to source files
        outputPath = inputFile.replace(/\.[^.]+$/, ".pdf");
      }

      // Read and convert file
      const markdownContent = fs.readFileSync(inputFile, "utf-8");
      const html = renderMarkdown(markdownContent, { customCSS });
      await convertMarkdownToPdf(html, outputPath);

      console.log(`  ✓ ${inputFile} → ${outputPath}`);
      successCount++;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      errors.push({ file: inputFile, error: errorMsg });
      console.error(`  ✗ ${inputFile}: ${errorMsg}`);
    }
  }

  // Summary
  console.log(`\nCompleted: ${successCount} of ${markdownFiles.length} file(s) converted`);

  if (errors.length > 0) {
    process.exit(1);
  }
}

async function handleFileInputs(inputs: string[], options: CliOptions, customCSS?: string[]): Promise<void> {
  // Validate all input files exist before processing
  const invalidFiles: string[] = [];
  for (const input of inputs) {
    if (!fs.existsSync(input)) {
      invalidFiles.push(input);
    }
  }

  // If any files are invalid, list them and exit without creating output
  if (invalidFiles.length > 0) {
    console.error("Error: The following files were not found:");
    invalidFiles.forEach((file) => console.error(`  - ${file}`));
    process.exit(1);
  }

  // For multiple files, require -o flag
  if (inputs.length > 1 && !options.output) {
    console.error("Error: Output path (-o) is required when merging multiple files");
    process.exit(1);
  }

  // Warn if any input is not a markdown file
  for (const input of inputs) {
    const ext = path.extname(input).toLowerCase();
    if (ext !== ".md" && ext !== ".markdown") {
      console.warn(
        `Warning: "${input}" does not have a .md extension. Attempting conversion anyway.`
      );
    }
  }

  // Determine output path
  const outputPath = options.output || inputs[0].replace(/\.[^.]+$/, ".pdf");

  // Read all input files
  const markdownContents = inputs.map((input) => fs.readFileSync(input, "utf-8"));

  // Convert markdown to HTML (merge if multiple files)
  const html = renderMarkdown(
    inputs.length === 1 ? markdownContents[0] : markdownContents,
    { customCSS }
  );

  // Convert to PDF
  await convertMarkdownToPdf(html, outputPath);

  console.log(`PDF created: ${outputPath}`);
}

program.parse();
