/**
 * CLI utilities module
 * Re-exports display and argument parsing utilities
 */
const display = require("./display");
const args = require("./args");

module.exports = {
  ...display,
  ...args,
  display,
  args,
};
