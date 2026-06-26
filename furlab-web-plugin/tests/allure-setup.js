const fs = require("fs");
const path = require("path");
const os = require("os");

module.exports = async function setup() {
  const resultsDir = path.resolve(__dirname, "../allure-results");
  fs.mkdirSync(resultsDir, { recursive: true });

  const pkg = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")
  );

  const lines = [
    `node.version=${process.version}`,
    `node.platform=${os.platform()}`,
    `node.arch=${os.arch()}`,
    `project.name=${pkg.name}`,
    `project.version=${pkg.version}`,
  ];

  fs.writeFileSync(
    path.join(resultsDir, "environment.properties"),
    lines.join("\n") + "\n"
  );
};
