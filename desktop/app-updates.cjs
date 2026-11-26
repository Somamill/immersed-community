const fs = require("node:fs");
const path = require("node:path");

const repository = "https://github.com/Somamill/immersed-community";
const releaseAPI = "https://api.github.com/repos/Somamill/immersed-community/releases/latest";
const DAY = 24 * 60 * 60_000;
const versionParts = version => /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(version || "") ? version.split(".").map(Number) : null;
function newer(candidate, installed) {
  const first = versionParts(candidate), second = versionParts(installed);
  if (!first || !second) return false;
  const difference = first.findIndex((value, index) => value !== second[index]);
  return difference >= 0 && first[difference] > second[difference];
}
function releaseForChannel(release, channel) {
  const version = release?.tag_name?.startsWith("v") ? release.tag_name.slice(1) : "";
  if (!versionParts(version) || release.draft || release.prerelease || !release.published_at)
    throw Error("The repository has no compatible stable release.");
  const tag = "v" + version;
  const name = channel === "direct" ? `immersed-${version}-arm64.dmg` : `immersed-mac-${version}.tar.gz`;
  const asset = release.assets?.find(item => item.name === name);
  const url = repository + "/releases/download/" + tag + "/" + name;
  if (!asset || asset.browser_download_url !== url || !/^sha256:[a-f0-9]{64}$/.test(asset.digest) || !Number.isSafeInteger(asset.size) || asset.size <= 0)
    throw Error("The release has no verified download destination for this installation.");
  // This is publisher metadata. Gatekeeper verifies the actual artifact at installation.
  const signed = /^(?:The signed, notarized Apple Silicon community app\b|Distribution: Developer ID signed and notarized\.?$)/im.test(release.body || "");
  if (channel === "direct" && !signed) throw Error("The publisher has not marked this Mac release as signed and notarized.");
  return { version, url: repository + "/releases/tag/" + tag };
}
function createAppUpdates({ home, version, channel, request = fetch, now = Date.now, signal }) {
  const managed = ["brew", "direct"].includes(channel);
  const file = path.join(home, ".data", "app-updates.json");
  let state = { auto: false, nextAt: 0, failures: 0 }, pending, last;
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    state = {
      auto: managed && saved.auto === true,
      nextAt: Number.isFinite(saved.nextAt) ? saved.nextAt : 0,
      failures: Math.min(4, Math.max(0, Number(saved.failures) || 0)),
    };
  } catch {}
  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + ".tmp", JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(file + ".tmp", file);
  }
  const info = () => ({ version, channel, supported: managed, auto: state.auto, nextAt: state.nextAt,
    status: pending ? "checking" : last?.status || "idle", latest: last?.release?.version,
    available: Boolean(last?.release && newer(last.release.version, version)),
    url: last?.release?.url, error: last?.error });
  function check() {
    if (!managed) return Promise.resolve(info());
    if (pending) return pending;
    pending = Promise.resolve().then(async () => {
      try {
        const abort = AbortSignal.timeout(8000);
        const response = await request(releaseAPI, {
          headers: { Accept: "application/vnd.github+json", "User-Agent": "immersed-community-update-check" },
          redirect: "error", signal: signal ? AbortSignal.any([abort, signal]) : abort,
        });
        if (!response.ok) throw Error("Could not check for updates. Try again later.");
        const reader = response.body.getReader();
        const chunks = [];
        let length = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 512_000) { void reader.cancel(); throw Error("Release response is too large."); }
          chunks.push(value);
        }
        const release = releaseForChannel(JSON.parse(Buffer.concat(chunks).toString("utf8")), channel);
        last = { status: "checked", release };
        state.failures = 0;
        state.nextAt = now() + DAY;
      } catch {
        last = { status: "failed", error: "Could not verify an update for this installation. Try again later." };
        state.nextAt = now() + 15 * 60_000 * 2 ** state.failures;
        state.failures = Math.min(4, state.failures + 1);
      }
      if (!signal?.aborted) save();
    }).finally(() => { pending = undefined; }).then(info);
    return pending;
  }
  return {
    info, check,
    automatic() { return state.auto && now() >= state.nextAt ? check() : info(); },
    setAutomatic(auto) {
      state.auto = managed && auto;
      save();
      return info();
    },
  };
}
module.exports = { createAppUpdates, newer, releaseForChannel };
