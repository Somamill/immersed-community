const { createHash } = require("node:crypto");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

module.exports = function pinnedDownload(file, digest, urls) {
  const matches = path => fs.existsSync(path) && createHash("sha256").update(fs.readFileSync(path)).digest("hex") === digest;
  if (matches(file)) return;
  const pending = file + ".download";
  for (const url of urls) {
    try {
      execFileSync("curl", ["--fail", "--location", "--connect-timeout", "8", "--max-time", "120", "--output", pending, url], { stdio: "inherit" });
      if (!matches(pending)) throw Error("Download failed its checksum");
      fs.renameSync(pending, file);
      return;
    } catch { fs.rmSync(pending, { force: true }); }
  }
  throw Error("The pinned dataset could not be downloaded and verified.");
};
