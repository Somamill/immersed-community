const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { createSetup } = require("../desktop/setup.cjs");
const { createAppUpdates, releaseForChannel } = require("../desktop/app-updates.cjs");

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "immersed-test-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}
test("setup deduplicates requests, serializes work and reuses verified checkpoints", async t => {
  const home = fixture(t);
  const completed = path.join(home, "completed");
  const step = name => ({
    revision: "1",
    ready: checkpoint => checkpoint?.status === "ready" && checkpoint.revision === "1" &&
      fs.existsSync(completed) && fs.readFileSync(completed, "utf8").includes(name),
    commands: () => [[process.execPath, "-e", `require("fs").appendFileSync(${JSON.stringify(completed)}, "${name}\\n")`]],
  });
  const steps = { a: step("a"), b: step("b") };
  const setup = createSetup({ home, root: home, steps });
  const first = setup.ensure("a");
  assert.equal(first, setup.ensure("a"));
  const second = setup.ensure("b");
  assert.equal(setup.info("b").status, "queued");
  await Promise.all([first, second]);
  const restarted = createSetup({ home, root: home, steps });
  await restarted.ensure("a");
  assert.equal(fs.readFileSync(completed, "utf8"), "a\nb\n");
});

test("offline failure pauses retries and quit cancels the entire owned setup group", async t => {
  const home = fixture(t);
  const marker = path.join(home, "running");
  let offline = true, now = 1000;
  const steps = { speech: {
    revision: "test",
    ready: () => false,
    commands: () => [[process.execPath, "-e", offline ? "process.exit(1)" :
      `const {spawn}=require("child_process"); const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"], {stdio:"ignore"}); require("fs").writeFileSync(${JSON.stringify(marker)},String(child.pid)); setInterval(()=>{},1000)`]],
  } };
  const setup = createSetup({ home, root: home, steps, now: () => now });
  t.after(() => { setup.stop(); setup.kill(); });
  await assert.rejects(setup.ensure("speech"), /Setup stopped/);
  assert.equal(setup.info("speech").status, "failed");
  await assert.rejects(setup.ensure("speech"), /Retry in Settings/);
  offline = false;
  const restarted = createSetup({ home, root: home, steps, now: () => now });
  t.after(() => { restarted.stop(); restarted.kill(); });
  assert.equal(restarted.info("speech").status, "failed");
  const interrupted = assert.rejects(restarted.ensure("speech", { retry: true }), /Setup stopped/);
  for (let attempt = 0; !fs.existsSync(marker) && attempt < 80; attempt++) await delay(20);
  assert.ok(fs.existsSync(marker));
  const pid = Number(fs.readFileSync(marker, "utf8"));
  assert.doesNotThrow(() => process.kill(pid, 0));
  restarted.stop();
  await interrupted;
  let alive = true;
  for (let attempt = 0; alive && attempt < 80; attempt++) {
    try { process.kill(pid, 0); await delay(20); } catch { alive = false; }
  }
  assert.equal(alive, false, "grandchild stopped on quit");
  now += 300_000;
  assert.equal(createSetup({ home, root: home, steps, now: () => now }).info("speech").status, "needed");
});

test("speech work takes precedence over in-progress optional setup", async t => {
  const home = fixture(t), marker = path.join(home, "context-started");
  const setup = createSetup({ home, root: home, steps: {
    context: {
      optional: true, revision: "1", ready: () => false,
      commands: () => [[process.execPath, "-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, "draft"); setInterval(()=>{},1000)`]],
    },
    speech: { revision: "1", ready: state => state?.status === "ready", commands: () => [] },
  } });
  t.after(() => { setup.stop(); setup.kill(); });
  const result = assert.rejects(setup.ensure("context"), /Setup stopped/);
  for (let trial = 0; !fs.existsSync(marker) && trial < 50; trial++) await delay(20);
  assert.ok(fs.existsSync(marker));
  await setup.ensure("speech");
  await result;
  assert.equal(setup.info("speech").status, "ready");
  assert.equal(setup.info("context").status, "needed");
  assert.equal(fs.readFileSync(marker, "utf8"), "draft");
});

const release = (name = "immersed-0.22.14-arm64.dmg") => ({
  tag_name: "v0.22.14", published_at: "2026-11-22T00:00:00Z",
  body: "Distribution: Developer ID signed and notarized.",
  assets: [{ name, size: 100, digest: "sha256:" + "a".repeat(64),
    browser_download_url: "https://github.com/Somamill/immersed-community/releases/download/v0.22.14/" + name }],
});
test("app updates use verified release metadata, independently of the dictionary", () => {
  assert.equal(releaseForChannel(release(), "direct").version, "0.22.14");
  assert.equal(releaseForChannel(release("immersed-mac-0.22.14.tar.gz"), "brew").version, "0.22.14");
  assert.throws(() => releaseForChannel(release(), "brew"), /verified download/);
  assert.throws(() => releaseForChannel({ ...release(), body: "Unsigned, notarized test" }, "direct"), /publisher/);
  assert.throws(() => releaseForChannel({ ...release(), prerelease: true }, "direct"), /stable/);
  const wrong = release();
  wrong.assets[0].browser_download_url = "https://example.com/immersed-0.22.14-arm64.dmg";
  assert.throws(() => releaseForChannel(wrong, "direct"), /verified download/);
});

test("automatic checking is opt-in, shares requests and persists daily cadence and failure backoff", async t => {
  let now = 100, calls = 0, online = false;
  const config = {
    home: fixture(t), version: "0.22.13", channel: "direct", now: () => now,
    request: async (url, options) => {
      assert.equal(url, "https://api.github.com/repos/Somamill/immersed-community/releases/latest");
      assert.equal(options.redirect, "error");
      calls++;
      if (!online) throw Error("Offline");
      return Response.json(release());
    },
  };
  const updater = createAppUpdates(config);
  assert.equal((await updater.automatic()).auto, false);
  assert.equal(calls, 0);
  updater.setAutomatic(true);
  assert.equal((await updater.automatic()).nextAt, now + 15 * 60_000);
  const restarted = createAppUpdates(config);
  await restarted.automatic();
  assert.equal(calls, 1);
  online = true;
  now += 15 * 60_000;
  const a = restarted.check();
  assert.equal(a, restarted.check());
  const status = await a;
  assert.equal(status.nextAt, now + 24 * 60 * 60_000);
  assert.equal(status.available, true);
  assert.equal(status.url, "https://github.com/Somamill/immersed-community/releases/tag/v0.22.14");
  assert.equal(calls, 2);
  assert.equal(createAppUpdates({ ...config, channel: "development" }).info().auto, false);
});
