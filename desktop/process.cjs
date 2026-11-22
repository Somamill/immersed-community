const { spawn } = require("node:child_process");

function signalGroup(child, signal) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function run(file, args, { signal, timeout = 0, maxBuffer = 1024 * 1024, env } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn(file, args, { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let error, force;
    const stop = reason => {
      if (error) return;
      error = reason;
      signalGroup(child, "SIGTERM");
      force = setTimeout(() => signalGroup(child, "SIGKILL"), 750);
      force.unref();
    };
    const aborted = () => stop(signal.reason || Error("Operation aborted."));
    signal?.addEventListener("abort", aborted, { once: true });
    const deadline = timeout && setTimeout(() => stop(Error("The local tool timed out: " + file)), timeout);
    const stdout = [], stderr = [];
    for (const [stream, output] of [[child.stdout, stdout], [child.stderr, stderr]]) {
      let bytes = 0;
      stream.on("data", chunk => {
        if (error) return;
        bytes += chunk.length;
        if (bytes > maxBuffer) stop(Error("The local tool returned too much data: " + file));
        else output.push(chunk);
      });
    }
    child.once("error", reason => { error ||= reason; });
    child.once("close", code => {
      if (error) signalGroup(child, "SIGKILL");
      clearTimeout(deadline);
      clearTimeout(force);
      signal?.removeEventListener("abort", aborted);
      const output = { stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
      if (error) reject(error);
      else if (code !== 0) reject(Error(output.stderr.trim().slice(-240) || "The local tool failed: " + file));
      else resolve(output);
    });
  });
}

module.exports = { run, signalGroup };
