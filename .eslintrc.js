module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  extends: ["eslint:recommended"],
  rules: {
    // Relaxed rules for existing codebase compatibility
    // Warn on unused vars (not error) to allow gradual cleanup
    "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    "no-console": "off",
    "prefer-const": "warn",
    "no-var": "error",
    eqeqeq: ["error", "always", { null: "ignore" }],
    // Allow unnecessary escapes (many exist in regex patterns)
    "no-useless-escape": "warn",
  },
  overrides: [
    {
      // CommonJS files (bin/ralph, config files)
      files: ["bin/ralph", "*.js"],
      parserOptions: {
        sourceType: "script",
      },
    },
    {
      // ES module files
      files: ["**/*.mjs"],
      parserOptions: {
        sourceType: "module",
      },
    },
    {
      // Browser scripts (UI)
      files: ["ui/**/*.js"],
      env: {
        browser: true,
        node: false,
      },
      globals: {
        htmx: "readonly",
      },
      rules: {
        // Third-party htmx extension uses var
        "no-var": "off",
        "no-redeclare": "off",
        eqeqeq: "off",
      },
    },
  ],
};
