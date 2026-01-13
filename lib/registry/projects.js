/**
 * Project registry management
 *
 * Handles project registration, metadata, and listing.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getRegistryPath, ensureGlobalRegistry } = require("./structure");

/**
 * Generate a unique project ID from path
 * @param {string} projectPath - Absolute path to project
 * @returns {string} - Short unique ID
 */
function generateProjectId(projectPath) {
  return crypto.createHash("md5").update(projectPath).digest("hex").slice(0, 8);
}

/**
 * Load registry from disk
 * @returns {Object} - Registry object with projects array
 */
function loadRegistry() {
  ensureGlobalRegistry();
  const registryPath = getRegistryPath();

  try {
    const content = fs.readFileSync(registryPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return {
      version: "1.0.0",
      projects: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}

/**
 * Save registry to disk
 * @param {Object} registry - Registry object
 */
function saveRegistry(registry) {
  ensureGlobalRegistry();
  const registryPath = getRegistryPath();

  registry.updatedAt = new Date().toISOString();
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
}

/**
 * Detect project name from common config files
 * @param {string} projectPath - Absolute path to project
 * @returns {string} - Detected name or directory name
 */
function detectProjectName(projectPath) {
  // Try package.json
  const packagePath = path.join(projectPath, "package.json");
  if (fs.existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
      if (pkg.name) return pkg.name;
    } catch {
      // ignore
    }
  }

  // Try Cargo.toml
  const cargoPath = path.join(projectPath, "Cargo.toml");
  if (fs.existsSync(cargoPath)) {
    try {
      const cargo = fs.readFileSync(cargoPath, "utf-8");
      const nameMatch = cargo.match(/^name\s*=\s*"([^"]+)"/m);
      if (nameMatch) return nameMatch[1];
    } catch {
      // ignore
    }
  }

  // Try pyproject.toml
  const pyprojectPath = path.join(projectPath, "pyproject.toml");
  if (fs.existsSync(pyprojectPath)) {
    try {
      const pyproject = fs.readFileSync(pyprojectPath, "utf-8");
      const nameMatch = pyproject.match(/^name\s*=\s*"([^"]+)"/m);
      if (nameMatch) return nameMatch[1];
    } catch {
      // ignore
    }
  }

  // Fall back to directory name
  return path.basename(projectPath);
}

/**
 * Detect tech stack based on config files present
 * @param {string} projectPath - Absolute path to project
 * @returns {string[]} - Array of detected stack tags
 */
function detectTechStack(projectPath) {
  const stack = [];

  // JavaScript/TypeScript
  if (fs.existsSync(path.join(projectPath, "package.json"))) {
    stack.push("javascript");
    // Check for TypeScript
    if (
      fs.existsSync(path.join(projectPath, "tsconfig.json")) ||
      fs.existsSync(path.join(projectPath, "tsconfig.base.json"))
    ) {
      stack.push("typescript");
    }
    // Check for common frameworks
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, "package.json"), "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.react) stack.push("react");
      if (deps.vue) stack.push("vue");
      if (deps.next) stack.push("nextjs");
      if (deps.express) stack.push("express");
      if (deps.fastify) stack.push("fastify");
    } catch {
      // ignore
    }
  }

  // Rust
  if (fs.existsSync(path.join(projectPath, "Cargo.toml"))) {
    stack.push("rust");
  }

  // Python
  if (
    fs.existsSync(path.join(projectPath, "pyproject.toml")) ||
    fs.existsSync(path.join(projectPath, "setup.py")) ||
    fs.existsSync(path.join(projectPath, "requirements.txt"))
  ) {
    stack.push("python");
  }

  // Go
  if (fs.existsSync(path.join(projectPath, "go.mod"))) {
    stack.push("go");
  }

  // CLI detection
  if (fs.existsSync(path.join(projectPath, "bin"))) {
    stack.push("cli");
  }

  return stack;
}

/**
 * Add a project to the registry
 * @param {string} projectPath - Absolute path to project
 * @param {Object} options - Additional options
 * @param {string[]} options.tags - Custom tags for the project
 * @returns {Object} - The added project entry
 */
function addProject(projectPath, options = {}) {
  const registry = loadRegistry();

  // Normalize path
  const normalizedPath = path.resolve(projectPath);

  // Check if already registered
  const existing = registry.projects.find((p) => p.path === normalizedPath);
  if (existing) {
    // Update existing entry
    return updateProject(normalizedPath, options);
  }

  const projectId = generateProjectId(normalizedPath);
  const name = detectProjectName(normalizedPath);
  const detectedStack = detectTechStack(normalizedPath);

  // Merge custom tags with detected stack
  const tags = [...new Set([...(options.tags || []), ...detectedStack])];

  const project = {
    id: projectId,
    name,
    path: normalizedPath,
    tags,
    stats: {
      guardrailCount: 0,
      progressCount: 0,
      runCount: 0,
      evaluationCount: 0,
      successRate: null,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  registry.projects.push(project);
  saveRegistry(registry);

  return project;
}

/**
 * Remove a project from the registry
 * @param {string} projectPathOrId - Project path or ID
 * @returns {boolean} - True if removed
 */
function removeProject(projectPathOrId) {
  const registry = loadRegistry();
  const normalizedPath = path.resolve(projectPathOrId);

  const initialLength = registry.projects.length;
  registry.projects = registry.projects.filter(
    (p) => p.path !== normalizedPath && p.id !== projectPathOrId
  );

  if (registry.projects.length < initialLength) {
    saveRegistry(registry);
    return true;
  }

  return false;
}

/**
 * Update a project in the registry
 * @param {string} projectPath - Absolute path to project
 * @param {Object} updates - Fields to update
 * @returns {Object|null} - Updated project or null if not found
 */
function updateProject(projectPath, updates = {}) {
  const registry = loadRegistry();
  const normalizedPath = path.resolve(projectPath);

  const projectIndex = registry.projects.findIndex((p) => p.path === normalizedPath);
  if (projectIndex === -1) {
    return null;
  }

  const project = registry.projects[projectIndex];

  // Update tags if provided (merge with existing)
  if (updates.tags) {
    project.tags = [...new Set([...project.tags, ...updates.tags])];
  }

  // Update stats if provided
  if (updates.stats) {
    project.stats = { ...project.stats, ...updates.stats };
  }

  // Update name if provided
  if (updates.name) {
    project.name = updates.name;
  }

  project.updatedAt = new Date().toISOString();
  registry.projects[projectIndex] = project;
  saveRegistry(registry);

  return project;
}

/**
 * Get a project by path or ID
 * @param {string} projectPathOrId - Project path or ID
 * @returns {Object|null} - Project entry or null
 */
function getProject(projectPathOrId) {
  const registry = loadRegistry();
  const normalizedPath = path.resolve(projectPathOrId);

  return (
    registry.projects.find((p) => p.path === normalizedPath || p.id === projectPathOrId) || null
  );
}

/**
 * Find project by path
 * @param {string} projectPath - Absolute path to project
 * @returns {Object|null} - Project entry or null
 */
function findProjectByPath(projectPath) {
  const registry = loadRegistry();
  const normalizedPath = path.resolve(projectPath);
  return registry.projects.find((p) => p.path === normalizedPath) || null;
}

/**
 * List all registered projects
 * @param {Object} filters - Optional filters
 * @param {string[]} filters.tags - Filter by tags
 * @returns {Object[]} - Array of project entries
 */
function listProjects(filters = {}) {
  const registry = loadRegistry();
  let projects = registry.projects;

  // Filter by tags if specified
  if (filters.tags && filters.tags.length > 0) {
    projects = projects.filter((p) =>
      filters.tags.some((tag) => p.tags.includes(tag.toLowerCase()))
    );
  }

  // Sort by last updated (most recent first)
  projects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  return projects;
}

module.exports = {
  generateProjectId,
  loadRegistry,
  saveRegistry,
  detectProjectName,
  detectTechStack,
  addProject,
  removeProject,
  updateProject,
  getProject,
  findProjectByPath,
  listProjects,
};
