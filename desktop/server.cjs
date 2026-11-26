const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { spawn } = require("node:child_process");
const focusedSpeech = require("./focused-speech.cjs");
const { createMedia } = require("./media.cjs");
const { createSearch } = require("./search.cjs");
const youtubeMetadata = require("./youtube-metadata.cjs").createYouTubeMetadata();
const { createCaptionFrames } = require("./caption-frames.cjs");
const { parseYouTubeCaptions, captionFormat, normalizeCaptionCache } = require("./captions.cjs");
const { desktopSetup } = require("./setup.cjs");
const { run: execute, signalGroup } = require("./process.cjs");
const anki = require("./anki.cjs").createAnki();
const processAbort = new AbortController();
const run = (file, args, options = {}) =>
    execute(file, args, { ...options, signal: options.signal ? AbortSignal.any([processAbort.signal, options.signal]) : processAbort.signal }),
  root = path.join(__dirname, ".."),
  cache = path.join(
    process.env.IMMERSED_DATA_ROOT || root,
    ".data/mac-transcripts-v2",
  );
fs.mkdirSync(cache, { recursive: true });
const setup = process.env.IMMERSED_APP_HOME ? desktopSetup(process.env.IMMERSED_APP_HOME, root) : null;
const appUpdates = require("./app-updates.cjs").createAppUpdates({
  home: process.env.IMMERSED_DATA_ROOT || root, version: require("../package.json").version,
  channel: process.env.IMMERSED_INSTALL_CHANNEL || "development", signal: processAbort.signal,
});
const atlasUpdates = require('./atlas-updates.cjs').createAtlasUpdater({root,run});
const captionFrames = createCaptionFrames({ run, root: path.join(process.env.IMMERSED_DATA_ROOT || root, ".data/caption-frames") });
let foregroundSpeech = null;
const speechPositions = new Map(), videoPreparations = new Map(), pausedSpeech = new Set();
const jobs = new Map(),
  validId = (id) => /^[A-Za-z0-9_-]{11}$/.test(id || "");
const json = (res, status, value) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
};
const speechChildren = new Set();
let speechStopping = false;
const speechQueue = [];
let worker = null,
  activeSpeech = null,
  workerSequence = 0,
  idleWorkerTimer = null;
function ensureSpeechWorker() {
  if (worker) return worker;
  const python =
    process.env.IMMERSED_PYTHON || path.join(root, ".venv/bin/python");
  const child = spawn(
    python,
    [path.join(__dirname, "transcribe.py"), "--worker"],
    { stdio: ["pipe", "pipe", "pipe"], detached: true },
  );
  worker = child;
  speechChildren.add(child);
  let buffer = "",
    stderr = "";
  child.stdin.on("error", () => {});
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-2000)));
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    if (buffer.length > 20 * 1024 * 1024) {
      signalGroup(child, "SIGTERM");
      return;
    }
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const task = activeSpeech;
      if (!task || message.id !== task.id) continue;
      if (message.status === "processing") {
        if (Array.isArray(message.cues))
          task.cues = message.append
            ? task.cues.concat(message.cues)
            : message.cues;
        task.progress({
          status: "processing",
          stage: message.stage || "Recognizing this minute on Apple Silicon",
          phase: message.phase,
          cues: task.cues,
          processedSeconds: message.processedSeconds || 0,
          duration: message.duration || task.duration,
        });
      } else if (
        message.status === "ready" ||
        message.status === "unavailable"
      ) {
        clearTimeout(task.timer);
        activeSpeech = null;
        if (message.status === "ready") task.resolve(message.cues || task.cues);
        else task.reject(Error(message.error || "Speech recognition stopped."));
        pumpSpeech();
      }
    }
  });
  function stopped(error) {
    speechChildren.delete(child);
    if (worker !== child) return;
    worker = null;
    const task = activeSpeech;
    activeSpeech = null;
    if (task) {
      clearTimeout(task.timer);
      task.reject(error);
    }
    pumpSpeech();
  }
  child.on("error", (error) => stopped(error));
  child.on("close", () =>
    stopped(Error("The speech worker stopped. " + stderr.slice(-180))),
  );
  return child;
}
function pumpSpeech() {
  if (speechStopping || activeSpeech) return;
  clearTimeout(idleWorkerTimer);
  if (!speechQueue.length) {
    idleWorkerTimer = setTimeout(() => {
      if (!activeSpeech && worker) {
        const old = worker;
        worker = null;
        signalGroup(old, "SIGTERM");
      }
    }, 120000);
    idleWorkerTimer.unref();
    return;
  }
  const weight = task => task.owner === foregroundSpeech && task.owner ? 100 : task.owner ? 0 : task.priority;
  speechQueue.sort((a, b) => weight(b) - weight(a));
  const task = speechQueue.shift();
  activeSpeech = task;
  const child = ensureSpeechWorker();
  task.timer = setTimeout(() => {
    if (activeSpeech === task) signalGroup(child, "SIGTERM");
  }, 15 * 60_000);
  child.stdin.write(
    JSON.stringify({
      id: task.id,
      audio: task.audio,
      quality: task.quality,
      start: task.start,
      duration: task.duration,
      context: task.context,
    }) + "\n",
  );
}
function speechSlice(audio, progress, quality, start, duration, priority, owner = null, context = "") {
  return new Promise((resolve, reject) => {
    if (speechStopping) return reject(Error("Speech service is stopping"));
    speechQueue.push({
      id: ++workerSequence,
      audio,
      progress,
      quality,
      start,
      duration,
      priority,
      owner,
      context,
      resolve,
      reject,
      cues: [],
    });
    pumpSpeech();
  });
}
async function recognize(
  audio,
  onProgress = () => {},
  quality = "balanced",
  options = {},
) {
  if (setup) {
    onProgress({ status: "processing", stage: "Checking speech setup", phase: "loading" });
    await setup.speech();
  }
  processAbort.signal.throwIfAborted();
  if (pausedSpeech.has(options.owner)) throw Object.assign(Error("Preparation paused"), { code: "BACKGROUND_PAUSED" });
  if (Number.isFinite(options.duration))
    return speechSlice(
      audio,
      onProgress,
      quality,
      options.start || 0,
      options.duration,
      options.priority || 10,
      options.owner || null,
      options.context || "",
    );
  const { stdout } = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      audio,
    ],
    { timeout: 30000, maxBuffer: 1000 },
  );
  const duration = Number(stdout);
  if (!Number.isFinite(duration) || duration <= 0)
    throw Error("Invalid audio duration");
  if (options.owner) {
    const partial = path.join(cache, options.owner.replace(":", "-") + ".partial.json");
    let initial = {};
    try { initial = JSON.parse(fs.readFileSync(partial, "utf8")); if (Math.abs(initial.duration - duration) > 1) initial = {}; } catch {}
    const result = await focusedSpeech.prepare({ duration, initial,
      position: () => speechPositions.get(options.owner) || 0,
      slice: (start, span, previous) => speechSlice(audio, progress => onProgress({
        ...progress, cues: previous.cues.concat(progress.cues || []).sort((a,b)=>a.start-b.start),
        duration, processedSeconds: previous.processedSeconds + (progress.processedSeconds || 0),
      }), quality, start, span, 0, options.owner, options.context),
      checkpoint: data => {
        fs.writeFileSync(partial + ".tmp", JSON.stringify(data)); fs.renameSync(partial + ".tmp", partial);
        onProgress({status:"processing",phase:"recognizing",...data});
        if (pausedSpeech.has(options.owner)) throw Object.assign(Error("Background work paused for the current video"), {code:"BACKGROUND_PAUSED"});
      },
    });
    return result;
  }
  const cues = [];
  for (let start = 0; start < duration; start += 60) {
    const next = await speechSlice(
      audio,
      (progress) =>
        onProgress({
          ...progress,
          cues: cues.concat(progress.cues),
          processedSeconds: start + progress.processedSeconds,
          duration,
        }),
      quality,
      start,
      Math.min(60, duration - start),
      0, null, options.context,
    );
    cues.push(...next);
  }
  return cues;
}
const media = createMedia({
  root: process.env.IMMERSED_DATA_ROOT || root,
  run,
  recognize,
});
function state(id, quality = "balanced", migrate = false) {
  const key = id + ":" + quality, active = jobs.get(key);
  if (active && ["processing", "queued", "unavailable"].includes(active.status))
    return focusedSpeech.withCheckpoint(path.join(cache,id+"-"+quality+".partial.json"),active);
  if (active?.status === "ready") {
    const normalized = normalizeCaptionCache(active,quality);
    if (normalized) return normalized;
  }
  const file = path.join(cache,id+"-"+quality+".json");
  try {
    const stored = JSON.parse(fs.readFileSync(file,"utf8")), normalized = normalizeCaptionCache(stored,quality);
    if (!normalized) return {status:"idle"};
    if (migrate && normalized !== stored) {
      const backup=file+".rolling-v1.bak";
      if (!fs.existsSync(backup)) fs.copyFileSync(file,backup);
      fs.writeFileSync(file+".tmp",JSON.stringify(normalized));fs.renameSync(file+".tmp",file);
    }
    return {status:"ready",source:"generated",...normalized};
  } catch {
    return focusedSpeech.withCheckpoint(path.join(cache,id+"-"+quality+".partial.json"),jobs.get(key)||{status:"idle"});
  }
}
async function transcribe(id, quality = "balanced") {
  const key = id + ":" + quality;
  let folder;
  const controller = new AbortController();
  videoPreparations.set(key, controller);
  try {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), "immersed-asr-"));
    try {
      await run(
        "yt-dlp",
        [
          "--no-playlist",
          "--no-progress",
          "--socket-timeout",
          "8",
          "--retries",
          "1",
          "--extractor-retries",
          "1",
          "--ignore-errors",
          "--skip-download",
          "--write-auto-subs",
          "--write-info-json",
          "--max-filesize",
          "1G",
          "--write-subs",
          "--sub-langs",
          "ja,ja-JP,ja-orig",
          "--sub-format",
          "json3",
          "-f",
          "bestaudio/best",
          "-o",
          path.join(folder, "audio.%(ext)s"),
          "https://www.youtube.com/watch?v=" + id,
        ],
        { timeout: 45000, maxBuffer: 1024 * 1024, signal: controller.signal },
      );
    } catch {
      /* Audio recognition remains available when caption fetch fails. */
    }
    let info = {};
    try {
      info = JSON.parse(
        fs.readFileSync(path.join(folder, "audio.info.json"), "utf8"),
      );
    } catch {}
    const files = fs
      .readdirSync(folder)
      .filter((name) => /^audio\.ja(?:-JP|-orig)?\.json3$/.test(name));
    const subtitle =
      files.find((name) =>
        Object.keys(info.subtitles || {}).some(
          (lang) => name === "audio." + lang + ".json3",
        ),
      ) ||
      files.find((name) => name.includes("ja-orig")) ||
      files[0];
    const authored =
      subtitle &&
      Object.keys(info.subtitles || {}).some(
        (lang) => subtitle === "audio." + lang + ".json3",
      );
    if (subtitle && (authored || (quality !== "accurate" && originalLanguage(info) === "ja"))) {
      const cues = parseYouTubeCaptions(
        JSON.parse(fs.readFileSync(path.join(folder, subtitle), "utf8")),
      );
      if (cues.length) {
        const result = { cues, captionFormat, source: authored ? "human" : "youtube-asr" };
        fs.writeFileSync(
          path.join(cache, id + "-" + quality + ".json"),
          JSON.stringify(result),
        );
        jobs.set(key, { status: "ready", ...result });
        return;
      }
    }
    if (controller.signal.aborted) throw Error("Preparation paused for the current video");
    jobs.set(key, { status: "processing", stage: "Preparing video audio" });
    await run(
      "yt-dlp",
      [
        "--no-playlist",
        "--no-progress",
        "--max-filesize",
        "1G",
        "-f",
        "bestaudio/best",
        "-o",
        path.join(folder, "audio.%(ext)s"),
        "https://www.youtube.com/watch?v=" + id,
      ],
      { timeout: 10 * 60_000, maxBuffer: 1024 * 1024, signal: controller.signal },
    );
    const file = fs
      .readdirSync(folder)
      .find(
        (f) =>
          f.startsWith("audio.") &&
          !f.endsWith(".part") &&
          !f.endsWith(".json3") &&
          !f.endsWith(".json"),
      );
    if (!file) throw Error("Video audio could not be accessed.");
    videoPreparations.delete(key);
    jobs.set(key, { status: "queued", stage: "Preparing subtitles at your position" });
    const cues = await recognize(
      path.join(folder, file),
      (progress) => jobs.set(key, progress),
      quality,
      { owner: key, context: [info.title,info.channel || info.uploader].filter(value=>typeof value === "string").join("。 ").replace(/[\u0000-\u001f\u007f]/g," ").slice(0,160) },
    );
    if (!cues.length) throw Error("No Japanese speech was recognized.");
    fs.writeFileSync(
      path.join(cache, id + "-" + quality + ".json.tmp"),
      JSON.stringify({ cues, pipeline: "mac-whisper-context-v4", quality }),
    );
    fs.renameSync(
      path.join(cache, id + "-" + quality + ".json.tmp"),
      path.join(cache, id + "-" + quality + ".json"),
    );
    fs.rmSync(path.join(cache, id + "-" + quality + ".partial.json"), {force:true});
    jobs.set(key, { status: "ready", cues });
  } catch (e) {
    jobs.set(key, {
      status: controller.signal.aborted || e.code === "BACKGROUND_PAUSED" ? "paused" : "unavailable",
      message: controller.signal.aborted ? "Preparation paused while another video is active" : String(e.message).slice(0, 240),
      canRetry: true,
    });
  } finally {
    if (videoPreparations.get(key) === controller) videoPreparations.delete(key);
    if (folder) fs.rmSync(folder, { recursive: true, force: true });
  }
}
const videoInfoPending = new Map();
const videoInfoCache = new Map();

function originalLanguage(info) {
  if (info.original_language) return info.original_language.split("-")[0];
  const orig = Object.keys(info.automatic_captions || {}).find((k) =>
    k.endsWith("-orig"),
  );
  if (orig) return orig.split("-")[0];
  const format = (info.formats || []).find(
    (f) => /original/i.test(f.format_note || "") && f.language,
  );
  return format?.language?.split("-")[0] || null;
}
function publicInfo(e) {
  return {
    id: e.id,
    title: e.title,
    duration: e.duration || 0,
    channel: e.channel || e.uploader || "",
    thumbnail: e.thumbnail,
    language: originalLanguage(e),
    isShort:
      /\/shorts\//.test(e.original_url || e.webpage_url || "") ||
      (e.aspect_ratio > 0 && e.aspect_ratio < 1 && e.duration <= 180),
  };
}
async function videoInfo(id, { quick = false } = {}) {
  if (videoInfoCache.has(id)) return videoInfoCache.get(id);
  if (videoInfoPending.has(id)) return videoInfoPending.get(id);
  const task = (async () => {
    if(quick) { try { const info=await youtubeMetadata.info(id);if(info?.language) {videoInfoCache.set(id,info);if(videoInfoCache.size>100)videoInfoCache.delete(videoInfoCache.keys().next().value);return info;} } catch { /* Compatibility fallback below. */ } }
    const { stdout } = await run(
      "yt-dlp",
      [
        "--skip-download",
        "--no-warnings",
        "--socket-timeout",
        quick ? "4" : "8",
        "--retries",
        quick ? "0" : "1",
        "--extractor-retries",
        quick ? "0" : "1",
        "--dump-single-json",
        "https://www.youtube.com/watch?v=" + id,
      ],
      { timeout: quick ? 8000 : 25000, maxBuffer: 16 * 1024 * 1024 },
    );
    const result = publicInfo(JSON.parse(stdout));
    videoInfoCache.set(id, result);
    if (videoInfoCache.size > 100)
      videoInfoCache.delete(videoInfoCache.keys().next().value);
    return result;
  })().finally(() => videoInfoPending.delete(id));
  videoInfoPending.set(id, task);
  return task;
}
const searches = createSearch({
  run,
  videoInfo: id => videoInfo(id,{quick:true}),
  fastSearch: query => youtubeMetadata.search(query),
  concurrency: 4,
  peek: (id) => videoInfoCache.get(id),
});

async function fallback(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const quality =
    url.searchParams.get("quality") === "accurate" ? "accurate" : "balanced";
  if (url.pathname === "/api/desktop/anki" && req.method === "GET") {
    const model = url.searchParams.get("model");
    return json(res, 200, model ? { fields: await anki.fields(model) } : await anki.connection());
  }
  if (url.pathname === "/api/desktop/anki" && req.method === "POST") {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 3_000_000) return json(res, 413, { error: "Anki note is too large." });
      chunks.push(chunk);
    }
    return json(res, 200, await anki.submit(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
  }
  if (url.pathname === "/api/desktop/dictionary-update" && ["GET","POST"].includes(req.method)) {
    if (setup && setup.info("dictionary").status !== "ready")
      return json(res, 409, { error: "Prepare the dictionary before checking for dictionary updates." });
    const language=url.searchParams.get("language");
    if(language && !["en","de"].includes(language))return json(res,400,{error:"Choose English or German."});
    try { return json(res,200,req.method === "POST" ? await atlasUpdates.start(language) : url.searchParams.get("check") === "1" ? await atlasUpdates.check() : atlasUpdates.info()); }
    catch (error) { return json(res,503,{error:error.message}); }
  }
  if (url.pathname === "/api/desktop/history" && req.method === "GET")
    return json(res, 200, require("../src/version-history.json"));
  if (url.pathname === "/api/desktop/levels" && req.method === "GET")
    return json(res, 200, require("../src/data/jlpt-levels.json"));
  if (url.pathname === "/api/desktop/library" && req.method === "GET")
    return json(res, 200, { items: media.list() });
  if (url.pathname === "/api/desktop/library" && req.method === "DELETE") {
    media.remove(url.searchParams.get("id"));
    return json(res, 200, { removed: true });
  }
  if (url.pathname === "/api/desktop/import" && req.method === "POST") {
    const item = await media.importFile(
      req,
      url.searchParams.get("name") || "",
    );
    return json(res, 201, item);
  }
  if (url.pathname === "/api/desktop/caption-frames" && req.method === "GET") {
    const id = url.searchParams.get("videoId"), at = Number(url.searchParams.get("at"));
    if (!validId(id) || !Number.isFinite(at) || at < 0 || at > 86400) return json(res, 400, { error: "Invalid frame position" });
    try { return json(res, 200, await captionFrames.sample(id, at)); }
    catch { return json(res, 503, { error: "Video frames unavailable" }); }
  }
  if (url.pathname === "/api/desktop/download" && req.method === "POST") {
    const id = url.searchParams.get("videoId");
    if (!validId(id)) return json(res, 400, { error: "Invalid video ID" });
    const item = await media.download(id);
    const transcript = state(id, quality);
    if (transcript.status === "ready") media.seed(item.id, transcript, quality);
    return json(res, 201, item);
  }
  if (
    url.pathname === "/api/desktop/media" &&
    ["GET", "HEAD"].includes(req.method)
  )
    return media.serve(req, res, url.searchParams.get("id"));
  if (url.pathname === "/api/desktop/artwork" && req.method === "GET") {
    const cover = await media.artwork(url.searchParams.get("id"));
    if (!cover) return json(res, 404, { error: "No embedded cover" });
    res.writeHead(200, {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=86400",
    });
    return fs.createReadStream(cover).pipe(res);
  }
  if (
    url.pathname === "/api/desktop/progress" &&
    ["GET", "PUT"].includes(req.method)
  ) {
    const id = url.searchParams.get("id");
    if (!media.get(id)) return json(res, 404, { error: "Media not found" });
    let data;
    if (req.method === "PUT") {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096)
          return json(res, 413, { error: "Progress too large" });
      }
      data = JSON.parse(body);
    }
    return json(res, 200, media.progress(id, data));
  }
  if (url.pathname === "/api/desktop/video-info" && req.method === "GET") {
    const id = url.searchParams.get("videoId");
    if (!validId(id)) return json(res, 400, { error: "Invalid video ID" });
    return json(res, 200, await videoInfo(id));
  }
  if (
    url.pathname === "/api/desktop/local-transcript" &&
    ["GET", "POST"].includes(req.method)
  ) {
    const id = url.searchParams.get("id");
    if (!media.get(id)) return json(res, 404, { error: "Media not found" });
    if (req.method === "POST") {
      if (url.searchParams.get("prefetch") !== "true") {
        foregroundSpeech = null;
        for (const controller of videoPreparations.values()) controller.abort();
      }
    }
    return json(
      res,
      200,
      req.method === "POST"
        ? await media.start(
            id,
            url.searchParams.get("retry") === "true",
            quality,
            Number(url.searchParams.get("at")) || 0,
          )
        : media.transcript(
            id,
            quality,
            Number(url.searchParams.get("at")) || 0,
          ),
    );
  }
  if (url.pathname === "/api/desktop/search" && req.method === "GET") {
    const query = (url.searchParams.get("query") || "").trim();
    if (!query || query.length > 120)
      return json(res, 400, { error: "Enter up to 120 characters" });
    return json(res, 200, await searches.search(query, {
      nativeAudience: url.searchParams.get("nativeAudience") === "true",
      page: Number(url.searchParams.get("page")),
      conversation: url.searchParams.get("conversation") === "true",
      minimumMinutes: Number(url.searchParams.get("minimumMinutes")),
      hideShorts: url.searchParams.get("hideShorts") !== "false",
    }));
  }
  if (
    url.pathname === "/api/desktop/transcribe" &&
    ["GET", "POST", "PUT"].includes(req.method)
  ) {
    const id = url.searchParams.get("videoId"),
      key = id + ":" + quality;
    if (!validId(id)) return json(res, 400, { error: "Invalid video ID" });
    if (req.method === "POST") {
      foregroundSpeech = key; pausedSpeech.delete(key);
      const backgrounds = [...jobs.entries()].reverse().filter(([other, job]) => other !== key && ["processing", "queued"].includes(job.status) && !videoPreparations.has(other));
      for (const [other] of backgrounds.slice(2)) {
        pausedSpeech.add(other);
        for (let i = speechQueue.length - 1; i >= 0; i--) if (speechQueue[i].owner === other) {
          speechQueue.splice(i, 1)[0].reject(Object.assign(Error("Background work paused for the current video"), {code:"BACKGROUND_PAUSED"}));
        }
      }
      for (const [other, controller] of videoPreparations) if (other !== key) controller.abort();
    }
    if (req.method !== "GET" && foregroundSpeech === key) speechPositions.set(key, Math.max(0, Math.min(86400, Number(url.searchParams.get("at")) || 0)));
    if (
      req.method === "POST" &&
      !["processing", "queued"].includes(jobs.get(key)?.status) &&
      (state(id, quality, true).status !== "ready" ||
        url.searchParams.get("retry") === "true")
    ) {
      jobs.set(key, { status: "processing", stage: "Preparing video audio" });
      void transcribe(id, quality);
    }
    return json(res, 200, state(id, quality));
  }
  if (req.method !== "GET")
    return json(res, 405, { error: "Method not allowed" });
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.youtube.com; style-src 'self' 'unsafe-inline'; frame-src https://www.youtube.com https://www.youtube-nocookie.com; connect-src 'self'; media-src 'self' blob:; img-src 'self' data: https://i.ytimg.com",
    });
    return fs.createReadStream(path.join(__dirname, "index.html")).pipe(res);
  }
  if (
    ["/shared/preferences-core.js", "/shared/learning-core.js"].includes(
      url.pathname,
    )
  ) {
    res.writeHead(200, { "Content-Type": "application/javascript" });
    return fs
      .createReadStream(path.join(root, "src", path.basename(url.pathname)))
      .pipe(res);
  }
  if (
    url.pathname === "/study.js" ||
    url.pathname === "/study.css" ||
    url.pathname === "/dot-tokens.css" ||
    url.pathname === "/dot-brand.css" ||
    url.pathname === "/compare.js" ||
    url.pathname === "/discovery.js" ||
    url.pathname === "/word-history.js" ||
    url.pathname === "/subtitle-playback.js" ||
    url.pathname === "/reading-cues.js"
    || url.pathname === "/netflix.js"
  ) {
    res.writeHead(200, {
      "Content-Type": url.pathname.endsWith(".js")
        ? "application/javascript"
        : "text/css",
    });
    return fs
      .createReadStream(path.join(__dirname, url.pathname.slice(1)))
      .pipe(res);
  }
  if (url.pathname === "/credits/credits.json")
    return json(res, 200, require("./macos-app/credits/credits.json"));
  if (["/credits/kofi.png", "/credits/reddit.png", "/credits/kotoba-atlas.png"].includes(url.pathname)) {
    res.writeHead(200, { "Content-Type": "image/png" });
    return fs.createReadStream(path.join(__dirname, "macos-app", url.pathname.slice(1))).pipe(res);
  }
  if (url.pathname === "/icon.png") {
    res.writeHead(200, { "Content-Type": "image/png" });
    return fs.createReadStream(path.join(root, "assets/icon.png")).pipe(res);
  }
  return json(res, 404, { error: "Not found" });
}
let languageHandler, preparingContext;
function prepareContext(retry = false) {
  preparingContext ||= setup.language({ retry }).then(() => {
    // Phrase data can improve lookups without the optional model.
    void setup.ensure("statistics", { retry }).catch(() => {});
    return setup.context({ retry });
  }).finally(() => { preparingContext = undefined; });
  return preparingContext;
}
const server = http.createServer(async (req, res) => {
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || ""))
    return json(res, 403, { error: "Local access only" });
  if (
    !["GET", "HEAD"].includes(req.method) &&
    req.headers["x-immersed-request"] !== "1"
  )
    return json(res, 403, { error: "Missing local request header" });
  if (
    req.headers.origin &&
    req.headers.origin !== `http://${req.headers.host}`
  )
    return json(res, 403, { error: "Local origin required" });
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/desktop/health" && req.method === "GET")
      return json(res, 200, { app: "immersed-community", version: appUpdates.info().version });
    if (url.pathname === "/api/desktop/app-update" && ["GET", "POST"].includes(req.method)) {
      if (req.method === "GET") return json(res, 200, appUpdates.info());
      const action = url.searchParams.get("action");
      if (action === "check") return json(res, 200, await appUpdates.check());
      if (action === "auto") return json(res, 200, appUpdates.setAutomatic(url.searchParams.get("enabled") === "true"));
      if (action === "foreground") return json(res, 200, await appUpdates.automatic());
      return json(res, 400, { error: "Unknown update action" });
    }
    if (url.pathname === "/api/desktop/setup" && ["GET", "POST"].includes(req.method)) {
      const feature = url.searchParams.get("feature");
      if (setup && req.method === "POST") {
        if (feature === "dictionary") void setup.language({ retry: true }).catch(() => {});
        else if (feature === "context") void prepareContext(true).catch(() => {});
        else if (feature === "speech") void setup.speech({ retry: true }).catch(() => {});
        else return json(res, 400, { error: "Unknown setup feature" });
      }
      return json(res, 200, setup?.statuses() || {});
    }
    if (url.pathname.startsWith("/api/immersion/")) {
      if (setup) {
        if (setup.info("dependencies").status !== "ready" || setup.info("dictionary").status !== "ready") {
          void setup.language().catch(() => {});
          return json(res, 503, { error: "Dictionary setup is pending. Check its progress or retry in Settings." });
        }
        if (!languageHandler) setup.activateNode();
        if (url.pathname.endsWith("/context-meaning") && !setup.contextReady()) {
          void prepareContext().catch(() => {});
          return json(res, 200, { status: "unavailable" });
        }
      }
      if (!languageHandler && !setup) {
        process.env.NODE_PATH = [path.join(__dirname, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
        require("node:module")._initPaths();
      }
      languageHandler ||= require("../server/middleware.cjs")(fallback);
      return await languageHandler(req, res, () => fallback(req, res));
    }
    await fallback(req, res);
  } catch (error) {
    if (!res.headersSent)
      json(res, 400, { error: String(error.message).slice(0, 240) });
    else res.destroy();
  }
});
if (require.main === module)
  server.listen(
    Number(process.env.IMMERSED_MAC_PORT || 4765),
    "127.0.0.1",
    () => console.log("immersed. local service ready"),
  );
function shutdown() {
  if (speechStopping) return;
  speechStopping = true;
  for (const task of speechQueue.splice(0))
    task.reject(Error("Speech service is stopping"));
  processAbort.abort();
  setup?.stop();
  if (languageHandler) require("../server/context-meaning.cjs").stop();
  for (const child of speechChildren) signalGroup(child, "SIGTERM");
  server.close();
  setTimeout(() => {
    setup?.kill();
    for (const child of speechChildren) signalGroup(child, "SIGKILL");
    process.exit(0);
  }, 1000);
}
if (require.main === module) {
  if (process.env.IMMERSED_PARENT_PIPE === "1") {
    process.stdin.once("end", shutdown);
    process.stdin.resume();
  }
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
module.exports = { server, validId, originalLanguage };
