const fs = require('fs');
const path = require('path');
const pc = require('picocolors');

function version() {
  const packagePath = path.join(__dirname, '../../package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

  console.log(`${pc.bold('ralph-cli')} v${pkg.version}`);
  console.log(`Node: ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
}

module.exports = { version };
