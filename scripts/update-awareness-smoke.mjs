import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, filePath), "utf8"));
}

function readText(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const manifest = readJson("manifest.json");
const pkg = readJson("package.json");
const background = readText("background.js");
const sidepanelHtml = readText("sidepanel.html");
const sidepanelJs = readText("sidepanel.js");
const readme = readText("README.md");
const privacy = readText("PrivacyPolicy.md");

assert(pkg.name === "ozon-growth-agent", "package name must be ozon-growth-agent");
assert(pkg.version === manifest.version, "package version must match manifest version");
assert(pkg.repository?.url === "https://github.com/ninemouth/ozon-growth-agent.git", "repository URL must point to ninemouth/ozon-growth-agent");
assert(readme.includes("https://github.com/ninemouth/ozon-growth-agent.git"), "README must use the Ozon repository clone URL");
assert(readme.includes("更新感知"), "README must document update awareness");
assert(readme.includes("无法静默自动安装更新"), "README must explain unpacked extensions cannot silently auto-update");
assert(privacy.includes("Ozon Growth Agent"), "privacy policy must use the Ozon product name");

[
  "GITHUB_LATEST_RELEASE_API",
  "GET_UPDATE_STATUS",
  "CHECK_FOR_UPDATES",
  "compareSemver",
  "ozon_update_check",
].forEach((needle) => {
  assert(background.includes(needle), `background.js missing ${needle}`);
});

[
  "updateStatusCard",
  "checkUpdateBtn",
  "openReleasesLink",
  "currentVersionText",
  "latestVersionText",
].forEach((needle) => {
  assert(sidepanelHtml.includes(needle), `sidepanel.html missing ${needle}`);
});

[
  "loadUpdateStatus",
  "renderUpdateStatus",
  "CHECK_FOR_UPDATES",
  "GET_UPDATE_STATUS",
].forEach((needle) => {
  assert(sidepanelJs.includes(needle), `sidepanel.js missing ${needle}`);
});

console.log("update-awareness-smoke: ok");
