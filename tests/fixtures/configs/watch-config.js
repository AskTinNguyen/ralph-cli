/**
 * Custom watch configuration for ralph watch
 */

export default {
  // File patterns to watch
  patterns: [
    '.ralph/**/*.md',
    'src/**/*.{js,ts}',
    'tests/**/*.mjs'
  ],

  // Debounce delay in milliseconds
  debounce: 1000,

  // Custom actions
  actions: {
    onPRDChange: async (file) => {
      console.log(`PRD changed: ${file}`);
      // Trigger rebuild
      return { action: 'rebuild', target: file };
    },

    onTestChange: async (file) => {
      console.log(`Test changed: ${file}`);
      // Run tests
      return { action: 'test', target: file };
    }
  },

  // Build mode settings
  buildMode: {
    enabled: true,
    autoStart: false,
    iterations: 5
  }
};
