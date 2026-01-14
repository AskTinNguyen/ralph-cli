/**
 * Init module entry point
 */
const wizard = require("./wizard");
const detect = require("./detect");

module.exports = {
  ...wizard,
  ...detect,
};
