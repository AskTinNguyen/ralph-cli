/**
 * CLI utilities module
 * Re-exports display, argument parsing, and path utilities
 */
const display = require("./display");
const args = require("./args");
const paths = require("./paths");

module.exports = {
  ...display,
  ...args,
  ...paths,
  display,
  args,
  paths,
};
