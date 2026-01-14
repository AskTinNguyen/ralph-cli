/**
 * Ralph search command
 * Search across all registered projects
 */
const fs = require("fs");
const { success, error, info, dim, warn, pc, parseFlag, parseNumericFlag, hasFlag, hr } = require("../cli");

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

module.exports = {
  name: "search",
  description: "Search across all registered projects",
  usage: "ralph search <query> [--filters]",

  help: `
${pc.bold("ralph search")} ${pc.dim("<query>")} ${pc.dim("[options]")}

${pc.bold(pc.cyan("Usage:"))}
  ${pc.green("ralph search")} ${pc.dim('"test before commit"')}       Search for a phrase
  ${pc.green("ralph search")} ${pc.dim("error --type guardrail")}      Search guardrails for "error"
  ${pc.green("ralph search")} ${pc.dim("--project myapp")}             List all entries from a project
  ${pc.green("ralph search")} ${pc.dim("--tags typescript")}           Search in TypeScript projects
  ${pc.green("ralph search")} ${pc.dim("--since 7d")}                  Search recent entries (last 7 days)
  ${pc.green("ralph search")} ${pc.dim("--rebuild")}                   Rebuild index and list all

${pc.bold(pc.cyan("Options:"))}
  ${pc.yellow("--project")} ${pc.dim("<name>")}      Filter by project name or ID
  ${pc.yellow("--type")} ${pc.dim("<type>")}         Filter: guardrail, progress, evaluation, run
  ${pc.yellow("--tags")} ${pc.dim("t1,t2")}          Filter by project tags
  ${pc.yellow("--since")} ${pc.dim("<when>")}        Filter by date: 7d, 2w, 1m, or ISO date
  ${pc.yellow("--limit")} ${pc.dim("<N>")}           Max results (default 20)
  ${pc.yellow("--rebuild")}             Rebuild search index first

${pc.bold(pc.cyan("Examples:"))}
  ${pc.dim('ralph search "missing dependency" --type guardrail')}
  ${pc.dim("ralph search US-001 --project ralph-cli")}
  ${pc.dim("ralph search --tags typescript,cli --since 30d")}
`,

  async run(args, env, options) {
    const { cwd, rawArgs = [] } = options;
    const searchModule = require("../search");
    const registryModule = require("../registry");

    let projectFilter = parseFlag(args, "project");
    let typeFilter = parseFlag(args, "type");
    let sinceFilter = parseFlag(args, "since");
    let limitValue = parseNumericFlag(args, "limit", 20);
    let rebuildFlag = hasFlag(args, "rebuild");
    const searchTags = [];
    const queryParts = [];

    // Parse --tags from rawArgs
    const argsToCheck = rawArgs.length > 0 ? rawArgs : args;
    for (let i = 0; i < argsToCheck.length; i++) {
      if (argsToCheck[i].startsWith("--tags=")) {
        const tagVal = argsToCheck[i].split("=").slice(1).join("=");
        searchTags.push(...tagVal.split(",").map((t) => t.trim().toLowerCase()));
      } else if (argsToCheck[i] === "--tags" && argsToCheck[i + 1]) {
        searchTags.push(...argsToCheck[i + 1].split(",").map((t) => t.trim().toLowerCase()));
        i++;
      }
    }

    // Collect query parts (non-flag arguments after command name)
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith("--project=") || arg === "--project") {
        if (arg === "--project") i++;
        continue;
      }
      if (arg.startsWith("--type=") || arg === "--type") {
        if (arg === "--type") i++;
        continue;
      }
      if (arg.startsWith("--since=") || arg === "--since") {
        if (arg === "--since") i++;
        continue;
      }
      if (arg.startsWith("--limit=") || arg === "--limit") {
        if (arg === "--limit") i++;
        continue;
      }
      if (arg === "--rebuild" || arg.startsWith("--tags")) {
        if (arg === "--tags") i++;
        continue;
      }
      if (!arg.startsWith("--")) {
        queryParts.push(arg);
      }
    }

    const query = queryParts.join(" ").trim();

    // Validate type filter
    const validTypes = ["guardrail", "progress", "evaluation", "run"];
    if (typeFilter && !validTypes.includes(typeFilter)) {
      error(`Invalid type: ${pc.bold(typeFilter)}`);
      info(`Valid types: ${validTypes.map((t) => pc.cyan(t)).join(", ")}`);
      return 1;
    }

    registryModule.ensureGlobalRegistry();

    const projects = registryModule.listProjects();
    if (projects.length === 0) {
      warn("No projects registered in the global registry.");
      info(`Use ${pc.cyan("ralph registry add")} to register projects first.`);
      return 0;
    }

    // Rebuild index if requested or if it doesn't exist
    const indexPath = searchModule.getSearchIndexPath();
    if (rebuildFlag || !exists(indexPath)) {
      info("Building search index...");
      const stats = searchModule.buildIndex();
      dim(
        `Indexed ${stats.projects} projects: ${stats.guardrails} guardrails, ${stats.progress} progress entries, ${stats.evaluations} evaluations, ${stats.runs} runs`
      );
      console.log("");
    }

    // Show help if no query or filters
    if (!query && !projectFilter && !typeFilter && searchTags.length === 0 && !sinceFilter) {
      console.log(this.help);
      return 0;
    }

    const results = searchModule.search(query, {
      project: projectFilter,
      type: typeFilter,
      tags: searchTags.length > 0 ? searchTags : null,
      since: sinceFilter,
      limit: limitValue,
    });

    // Display results
    console.log("");
    if (query) {
      console.log(pc.bold(`Search: "${query}"`));
    } else {
      console.log(pc.bold("Search Results"));
    }

    // Show active filters
    const activeFilters = [];
    if (projectFilter) activeFilters.push(`project=${projectFilter}`);
    if (typeFilter) activeFilters.push(`type=${typeFilter}`);
    if (searchTags.length > 0) activeFilters.push(`tags=${searchTags.join(",")}`);
    if (sinceFilter) activeFilters.push(`since=${sinceFilter}`);
    if (activeFilters.length > 0) {
      dim(`Filters: ${activeFilters.join(", ")}`);
    }

    hr("-", 70);
    console.log(
      `Found ${pc.bold(results.totalCount)} results${results.totalCount > results.returnedCount ? ` (showing ${results.returnedCount})` : ""}`
    );
    console.log("");

    if (results.results.length === 0) {
      dim("No matching entries found.");
      console.log("");
      info(`Tips:`);
      dim(`  - Try broader search terms`);
      dim(`  - Use ${pc.cyan("--rebuild")} to refresh the index`);
      dim(`  - Check registered projects with ${pc.cyan("ralph registry list")}`);
      return 0;
    }

    for (const result of results.results) {
      const typeBadge =
        result.type === "guardrail"
          ? pc.yellow(`[${result.type}]`)
          : result.type === "progress"
            ? pc.green(`[${result.type}]`)
            : result.type === "evaluation"
              ? pc.blue(`[${result.type}]`)
              : pc.magenta(`[${result.type}]`);

      const relevance =
        result.relevance >= 80
          ? pc.green("●●●")
          : result.relevance >= 50
            ? pc.yellow("●●○")
            : pc.dim("●○○");

      console.log(`${typeBadge} ${pc.bold(result.title)} ${relevance}`);
      dim(`   Project: ${result.projectName} | Score: ${result.relevance}/100`);

      if (result.snippet && result.snippet.text) {
        let snippetText = result.snippet.text;
        if (result.snippet.highlights && result.snippet.highlights.length > 0 && query) {
          const lowerQuery = query.toLowerCase();
          const terms = [
            lowerQuery,
            ...query
              .toLowerCase()
              .split(/\s+/)
              .filter((t) => t.length >= 2),
          ];
          for (const term of terms) {
            const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
            snippetText = snippetText.replace(regex, pc.bold(pc.cyan("$1")));
          }
        }
        snippetText = snippetText.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
        if (snippetText.length > 150) {
          snippetText = snippetText.slice(0, 147) + "...";
        }
        console.log(`   ${pc.dim(snippetText)}`);
      }

      if (result.source) {
        const relSource = result.source.replace(result.projectPath, "").replace(/^\//, "");
        dim(`   Source: ${relSource}`);
      }

      console.log("");
    }

    hr("-", 70);
    if (results.totalCount > results.returnedCount) {
      info(
        `Showing ${results.returnedCount} of ${results.totalCount} results. Use ${pc.cyan("--limit")} to see more.`
      );
    }
    return 0;
  },
};
