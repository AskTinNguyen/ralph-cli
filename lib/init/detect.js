/**
 * Environment detection for ralph init
 *
 * Detects project type, git repository, CI/CD configuration, and suggests guardrails
 */
const fs = require("fs");
const path = require("path");
const { detectTechStack } = require("../registry/projects");

/**
 * Project manifest files and their associated project types
 */
const MANIFEST_FILES = {
  "package.json": "javascript",
  "tsconfig.json": "typescript",
  "requirements.txt": "python",
  "pyproject.toml": "python",
  "setup.py": "python",
  "Pipfile": "python",
  "go.mod": "go",
  "Cargo.toml": "rust",
  "Gemfile": "ruby",
  "composer.json": "php",
  "pom.xml": "java",
  "build.gradle": "java",
  "build.gradle.kts": "kotlin",
  "Package.swift": "swift",
  "Makefile": "c",
  "CMakeLists.txt": "cpp",
  "mix.exs": "elixir",
  "pubspec.yaml": "dart",
};

/**
 * CI/CD configuration files and their types
 */
const CICD_FILES = {
  ".github/workflows": "github-actions",
  ".gitlab-ci.yml": "gitlab-ci",
  ".travis.yml": "travis-ci",
  "Jenkinsfile": "jenkins",
  ".circleci/config.yml": "circleci",
  "azure-pipelines.yml": "azure-devops",
  "bitbucket-pipelines.yml": "bitbucket",
  ".drone.yml": "drone",
  "cloudbuild.yaml": "cloud-build",
  "cloudbuild.yml": "cloud-build",
  "appveyor.yml": "appveyor",
  ".buildkite": "buildkite",
};

/**
 * Guardrails recommendations by project type
 */
const GUARDRAILS_BY_TYPE = {
  javascript: [
    {
      name: "Run npm test before commit",
      trigger: "Before committing changes",
      instruction: "Run `npm test` to ensure all tests pass",
    },
    {
      name: "Run ESLint before commit",
      trigger: "Before committing changes",
      instruction: "Run `npm run lint` or `npx eslint .` to check for linting errors",
    },
  ],
  typescript: [
    {
      name: "Run TypeScript compiler before commit",
      trigger: "Before committing changes",
      instruction: "Run `npx tsc --noEmit` to catch type errors",
    },
    {
      name: "Run npm test before commit",
      trigger: "Before committing changes",
      instruction: "Run `npm test` to ensure all tests pass",
    },
  ],
  python: [
    {
      name: "Run pytest before commit",
      trigger: "Before committing changes",
      instruction: "Run `pytest` or `python -m pytest` to ensure all tests pass",
    },
    {
      name: "Run type checker before commit",
      trigger: "Before committing changes",
      instruction: "Run `mypy .` or `pyright` to catch type errors",
    },
    {
      name: "Run linter before commit",
      trigger: "Before committing changes",
      instruction: "Run `ruff check .` or `flake8` to check for linting errors",
    },
  ],
  go: [
    {
      name: "Run go test before commit",
      trigger: "Before committing changes",
      instruction: "Run `go test ./...` to ensure all tests pass",
    },
    {
      name: "Run go vet before commit",
      trigger: "Before committing changes",
      instruction: "Run `go vet ./...` to check for common errors",
    },
    {
      name: "Run go fmt before commit",
      trigger: "Before committing changes",
      instruction: "Run `go fmt ./...` to format code",
    },
  ],
  rust: [
    {
      name: "Run cargo test before commit",
      trigger: "Before committing changes",
      instruction: "Run `cargo test` to ensure all tests pass",
    },
    {
      name: "Run cargo clippy before commit",
      trigger: "Before committing changes",
      instruction: "Run `cargo clippy` to check for common errors and style issues",
    },
    {
      name: "Run cargo fmt before commit",
      trigger: "Before committing changes",
      instruction: "Run `cargo fmt --check` to verify code formatting",
    },
  ],
  ruby: [
    {
      name: "Run rspec before commit",
      trigger: "Before committing changes",
      instruction: "Run `bundle exec rspec` to ensure all tests pass",
    },
    {
      name: "Run rubocop before commit",
      trigger: "Before committing changes",
      instruction: "Run `bundle exec rubocop` to check for linting errors",
    },
  ],
  java: [
    {
      name: "Run tests before commit",
      trigger: "Before committing changes",
      instruction: "Run `mvn test` or `gradle test` to ensure all tests pass",
    },
  ],
  php: [
    {
      name: "Run PHPUnit before commit",
      trigger: "Before committing changes",
      instruction: "Run `vendor/bin/phpunit` to ensure all tests pass",
    },
  ],
};

/**
 * Detect project type from manifest files
 * @param {string} cwd - Current working directory
 * @returns {{ type: string, confidence: number, manifests: string[] }}
 */
function detectProjectTypeFromManifests(cwd) {
  const foundManifests = [];
  const typeCounts = {};

  for (const [file, type] of Object.entries(MANIFEST_FILES)) {
    const filePath = path.join(cwd, file);
    if (fs.existsSync(filePath)) {
      foundManifests.push(file);
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    }
  }

  if (foundManifests.length === 0) {
    return { type: "unknown", confidence: 0, manifests: [] };
  }

  // Determine primary type based on counts and priority
  // TypeScript takes precedence over JavaScript
  let primaryType = "unknown";
  let maxCount = 0;

  if (typeCounts.typescript) {
    primaryType = "typescript";
    maxCount = typeCounts.typescript;
  } else {
    for (const [type, count] of Object.entries(typeCounts)) {
      if (count > maxCount) {
        maxCount = count;
        primaryType = type;
      }
    }
  }

  // Calculate confidence based on manifest count
  const confidence = Math.min(foundManifests.length / 2, 1);

  return {
    type: primaryType,
    confidence,
    manifests: foundManifests,
  };
}

/**
 * Detect existing git repository
 * @param {string} cwd - Current working directory
 * @returns {{ hasGit: boolean, isClean: boolean | null, branch: string | null }}
 */
function detectGitRepository(cwd) {
  const gitPath = path.join(cwd, ".git");
  const gitExists = fs.existsSync(gitPath);

  if (!gitExists) {
    return { hasGit: false, isClean: null, branch: null };
  }

  // Determine actual git directory (handles worktrees)
  let gitDir = gitPath;
  const stat = fs.statSync(gitPath);

  if (stat.isFile()) {
    // This is a worktree - .git is a file with gitdir pointer
    try {
      const gitdirContent = fs.readFileSync(gitPath, "utf-8").trim();
      const gitdirMatch = gitdirContent.match(/^gitdir:\s*(.+)$/);
      if (gitdirMatch) {
        gitDir = gitdirMatch[1];
      }
    } catch {
      // Ignore errors
    }
  }

  // Try to read current branch
  let branch = null;
  const headPath = path.join(gitDir, "HEAD");
  if (fs.existsSync(headPath)) {
    try {
      const headContent = fs.readFileSync(headPath, "utf-8").trim();
      const refMatch = headContent.match(/^ref: refs\/heads\/(.+)$/);
      if (refMatch) {
        branch = refMatch[1];
      }
    } catch {
      // Ignore errors
    }
  }

  // Check if working tree is clean (basic check via index mtime)
  // Full cleanliness check requires running git status, which we avoid
  // to keep this function synchronous and fast
  let isClean = null; // null indicates unknown

  return { hasGit: true, isClean, branch };
}

/**
 * Detect CI/CD configuration
 * @param {string} cwd - Current working directory
 * @returns {{ hasCICD: boolean, ciType: string | null, configPath: string | null }}
 */
function detectCICDConfiguration(cwd) {
  for (const [configPath, ciType] of Object.entries(CICD_FILES)) {
    const fullPath = path.join(cwd, configPath);

    // Check for directory (e.g., .github/workflows, .buildkite)
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);

      // For directories, check if they contain files
      if (stat.isDirectory()) {
        try {
          const files = fs.readdirSync(fullPath);
          if (files.length > 0) {
            return { hasCICD: true, ciType, configPath };
          }
        } catch {
          // Ignore errors
        }
      } else {
        // For files, just check existence
        return { hasCICD: true, ciType, configPath };
      }
    }
  }

  return { hasCICD: false, ciType: null, configPath: null };
}

/**
 * Suggest appropriate guardrails based on detected stack
 * @param {string} projectType - Primary project type
 * @param {string[]} techStack - Full tech stack from detectTechStack
 * @returns {Array<{ name: string, trigger: string, instruction: string }>}
 */
function suggestGuardrails(projectType, techStack = []) {
  const suggestions = [];

  // Add guardrails for primary type
  if (GUARDRAILS_BY_TYPE[projectType]) {
    suggestions.push(...GUARDRAILS_BY_TYPE[projectType]);
  }

  // Add additional guardrails for detected frameworks
  for (const tech of techStack) {
    if (tech !== projectType && GUARDRAILS_BY_TYPE[tech]) {
      // Avoid duplicates
      for (const guardrail of GUARDRAILS_BY_TYPE[tech]) {
        if (!suggestions.some((s) => s.name === guardrail.name)) {
          suggestions.push(guardrail);
        }
      }
    }
  }

  // Common guardrails for all projects
  const commonGuardrails = [
    {
      name: "Read before writing",
      trigger: "Before modifying any file",
      instruction: "Read the file first to understand existing code",
    },
  ];

  // Add common guardrails if not already present
  for (const guardrail of commonGuardrails) {
    if (!suggestions.some((s) => s.name === guardrail.name)) {
      suggestions.push(guardrail);
    }
  }

  return suggestions;
}

/**
 * Detect full environment information
 * @param {string} cwd - Current working directory
 * @returns {{
 *   projectType: string,
 *   confidence: number,
 *   manifests: string[],
 *   techStack: string[],
 *   hasGit: boolean,
 *   gitBranch: string | null,
 *   hasCICD: boolean,
 *   ciType: string | null,
 *   ciConfigPath: string | null,
 *   suggestedGuardrails: Array<{ name: string, trigger: string, instruction: string }>
 * }}
 */
function detectEnvironment(cwd) {
  // Detect project type from manifests
  const manifestDetection = detectProjectTypeFromManifests(cwd);

  // Get full tech stack using existing utility
  const techStack = detectTechStack(cwd);

  // Detect git repository
  const gitDetection = detectGitRepository(cwd);

  // Detect CI/CD configuration
  const cicdDetection = detectCICDConfiguration(cwd);

  // Suggest guardrails based on detected type and stack
  const suggestedGuardrails = suggestGuardrails(manifestDetection.type, techStack);

  return {
    projectType: manifestDetection.type,
    confidence: manifestDetection.confidence,
    manifests: manifestDetection.manifests,
    techStack,
    hasGit: gitDetection.hasGit,
    gitBranch: gitDetection.branch,
    hasCICD: cicdDetection.hasCICD,
    ciType: cicdDetection.ciType,
    ciConfigPath: cicdDetection.configPath,
    suggestedGuardrails,
  };
}

module.exports = {
  detectEnvironment,
  detectProjectTypeFromManifests,
  detectGitRepository,
  detectCICDConfiguration,
  suggestGuardrails,
  MANIFEST_FILES,
  CICD_FILES,
  GUARDRAILS_BY_TYPE,
};
