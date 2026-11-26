const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");

const { signalGroup } = require("./process.cjs");

// Shared by the feature requests. A failed step keeps the previous completed steps.
function createSetup({ home, root, steps, env = process.env, now = Date.now }) {
  const directory = path.join(home, ".data/setup");
  const running = new Map();
  const checkpoints = new Map();
  const queue = [];
  let active, child, stopped = false;
  function pump() {
    if (active || stopped || !queue.length) return;
    const priority = queue.findIndex(task => !steps[task.name].optional);
    const task = queue.splice(Math.max(0, priority), 1)[0];
    active = task;
    const finish = () => {
      running.delete(task.name);
      active = undefined;
      pump();
    };
    void task.execute().then(() => { finish(); task.resolve(); }, error => { finish(); task.reject(error); });
  }
  function checkpoint(name) {
    if (!checkpoints.has(name)) {
      let previous;
      try { previous = JSON.parse(fs.readFileSync(path.join(directory, name + ".json"), "utf8")); } catch {}
      checkpoints.set(name, previous);
    }
    return checkpoints.get(name);
  }
  function save(name, state) {
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, name + ".json");
    fs.writeFileSync(file + ".tmp", JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(file + ".tmp", file);
    checkpoints.set(name, state);
  }
  function info(name) {
    const step = steps[name];
    if (step.ready(checkpoint(name))) return { status: "ready" };
    if (running.has(name)) return { status: running.get(name).status };
    const previous = checkpoint(name);
    return previous?.status === "failed" && previous.revision === step.revision
      ? { status: "failed", retryAt: previous.retryAt } : { status: "needed" };
  }
  function ensure(name, { retry = false } = {}) {
    const state = info(name);
    if (state.status === "ready") return Promise.resolve();
    if (running.has(name)) return running.get(name).promise;
    if (stopped || (!retry && state.retryAt > now())) return Promise.reject(Error("Setup is unavailable. Retry in Settings."));
    const task = { name, status: "queued" };
    task.promise = new Promise((resolve, reject) => Object.assign(task, { resolve, reject }));
    task.execute = async () => {
      if (stopped) throw Error("Setup interrupted");
      const step = steps[name];
      task.status = "preparing";
      save(name, { status: "preparing", revision: step.revision });
      try {
        for (const [command, ...args] of step.commands()) await new Promise((resolve, reject) => {
          child = spawn(command, args, { cwd: root, env: { ...env, NODE_PATH: process.env.NODE_PATH }, detached: true, stdio: ["ignore", "inherit", "inherit"] });
          const runningChild = child;
          const timeout = setTimeout(() => signalGroup(runningChild, "SIGKILL"), 25 * 60_000);
          child.once("error", reject);
          child.once("close", code => {
            child = undefined;
            clearTimeout(timeout);
            if (code === 0 && !stopped) resolve();
            else reject(Error("Setup stopped. Check your connection and retry in Settings."));
          });
        });
        const completed = { status: "ready", revision: step.revision };
        if (!step.ready(completed)) throw Error("Setup did not produce the required files. Retry in Settings.");
        save(name, completed);
      } catch (error) {
        if (!stopped && !task.preempted) {
          save(name, { status: "failed", revision: step.revision, retryAt: now() + 5 * 60_000 });
          console.error("Setup %s: %s", name, error.message);
        }
        throw error;
      }
    };
    running.set(name, task);
    queue.push(task);
    if (name === "speech" && active && steps[active.name].optional) {
      active.preempted = true;
      signalGroup(child, "SIGKILL");
    }
    pump();
    return task.promise;
  }
  return {
    ensure, info,
    statuses: () => Object.fromEntries(Object.keys(steps).map(name => [name, info(name)])),
    stop() {
      stopped = true;
      for (const task of queue.splice(0)) { running.delete(task.name); task.reject(Error("Setup interrupted")); }
      signalGroup(child, "SIGTERM");
    },
    kill() { signalGroup(child, "SIGKILL"); },
  };
}

function desktopSetup(home, root) {
  const required = file => { try { return fs.statSync(file).size > 0; } catch { return false; } };
  const fingerprint = (...files) => createHash("sha256").update(files.map(file =>
    createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex")).join(":")).digest("hex");
  const fileHash = file => createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex");
  const data = name => path.join(home, ".data", name);
  const python = fs.existsSync("/opt/homebrew/bin/python3.13") ? "/opt/homebrew/bin/python3.13" : "python3";
  const pipEnv = { ...process.env, PIP_DEFAULT_TIMEOUT: "12", PIP_RETRIES: "1" };
  const dependencyHash = fileHash("desktop/package-lock.json");
  const installed = dir => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, "node_modules/kuromoji/package.json"))).version === "0.1.2"
        && required(path.join(dir, "node_modules/kuromoji/dict/base.dat.gz"));
    } catch { return false; }
  };
  const nodeRevision = dependencyHash + ":" + process.versions.modules + ":" + process.arch;
  const cached = path.join(home, ".data/runtime", nodeRevision.replaceAll(":", "-"));
  const legacy = path.join(home, "desktop");
  const legacyHash = path.join(home, ".mac-dependencies-sha");
  const verifiedLegacy = () => { try { return fs.readFileSync(legacyHash, "utf8").trim() === dependencyHash && installed(legacy); } catch { return false; } };
  const activateNode = () => {
    // Existing source checkouts typically already have dependencies.
    const dir = [path.join(root, "desktop"), ...(verifiedLegacy() ? [legacy] : []), cached].find(installed);
    if (!dir) return false;
    process.env.NODE_PATH = [...new Set([path.join(dir, "node_modules"), ...(process.env.NODE_PATH || "").split(path.delimiter)].filter(Boolean))].join(path.delimiter);
    require("node:module")._initPaths();
    return true;
  };
  let speechRevision, contextRevision, pythonABI;
  const pythonFingerprint = () => pythonABI ||= execFileSync(python, ["-c", "import platform; print(platform.python_version() + ':' + platform.machine())"], { encoding: "utf8", timeout: 3000 }).trim();
  const contextRequirements = fileHash("desktop/requirements-context.txt");
  const contextModel = fs.readFileSync(path.join(root, "server/context_meaning.py"), "utf8").match(/^(?:MODEL|REVISION) = ".+"$/gm).join(":");
  const getContextRevision = () => contextRevision ||= [contextRequirements, contextModel, pythonFingerprint()].join(":");
  const getSpeechRevision = () => speechRevision ||= fileHash("desktop/requirements-speech.txt") + ":" + pythonFingerprint();
  const speechPython = process.env.IMMERSED_PYTHON;
  const readMarker = file => { try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; } };
  const steps = {
    dependencies: {
      revision: nodeRevision,
      ready: checkpoint => installed(path.join(root, "desktop")) || verifiedLegacy() || (checkpoint?.revision === nodeRevision && checkpoint.status === "ready" && installed(cached)),
      commands() {
        fs.mkdirSync(cached, { recursive: true });
        for (const file of ["package.json", "package-lock.json"]) fs.copyFileSync(path.join(root, "desktop", file), path.join(cached, file));
        return [["npm", "ci", "--prefer-offline", "--fetch-retries=0", "--fetch-timeout=15000", "--omit=dev", "--prefix", cached]];
      },
    },
    dictionary: {
      revision: fingerprint("scripts/setup-dictionary.cjs", "scripts/build-atlas.py"),
      ready: () => ["jmdict.json", "kotoba-atlas.db"].every(name => required(data(name))),
      commands: () => [[process.execPath, path.join(root, "scripts/setup-dictionary.cjs")]],
    },
    statistics: {
      optional: true,
      revision: fingerprint("scripts/setup-context.cjs", "src/data/context-source.json"),
      ready: () => required(data("context-ngrams.sqlite")),
      commands: () => [["/usr/bin/nice", "-n", "10", process.execPath, path.join(root, "scripts/setup-context.cjs")]],
    },
    context: {
      optional: true,
      get revision() { return contextRevision || contextRequirements; },
      ready: () => Boolean(contextRevision) && required(process.env.IMMERSED_CONTEXT_PYTHON)
        && required(data("context-model/model.safetensors"))
        && readMarker(path.join(home, ".venv-context/.ready")) === contextRevision,
      commands: () => [["/usr/bin/nice", "-n", "10", "/bin/sh", path.join(root, "scripts/setup-context-meaning.sh"), getContextRevision()]],
    },
    speech: {
      get revision() { try { return getSpeechRevision(); } catch { return "python-unavailable"; } },
      ready: checkpoint => required(speechPython) && Boolean(speechRevision) && (readMarker(path.join(home, ".venv/.immersed-revision")) === speechRevision || (checkpoint?.revision === speechRevision && checkpoint.status === "ready")),
      commands() {
        getSpeechRevision();
        return [
          ...(!fs.existsSync(speechPython) ? [[python, "-m", "venv", path.join(home, ".venv")]] : []),
          [speechPython, "-m", "pip", "install", "-r", path.join(root, "desktop/requirements-speech.txt")],
          [speechPython, "-m", "pip", "check"],
        ];
      },
    },
  };
  const setup = createSetup({ home, root, steps, env: { ...pipEnv, IMMERSED_PYTHON: python, IMMERSED_KEEP_ATLAS: "1" } });
  const statuses = () => {
    const states = setup.statuses();
    if (states.speech.status === "needed" && !speechRevision && required(speechPython)) states.speech = { status: "unchecked" };
    return states;
  };
  return {
    ...setup, statuses, activateNode,
    async language(options) {
      await setup.ensure("dependencies", options);
      if (!activateNode()) throw Error("Language dependencies could not be loaded.");
      await setup.ensure("dictionary", options);
    },
    speech(options) {
      try { getSpeechRevision(); } catch { /* The queued step records the recoverable failure. */ }
      return setup.ensure("speech", options);
    },
    context(options) { getContextRevision(); return setup.ensure("context", options); },
    contextReady() { try { getContextRevision(); return setup.info("context").status === "ready"; } catch { return false; } },
  };
}

module.exports = { createSetup, desktopSetup };
