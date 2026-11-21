const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");
const { createTranscriptWindows } = require("./transcript-windows.cjs");
const ALLOWED = new Set([
  ".mp4",
  ".m4v",
  ".mov",
  ".m4b",
  ".m4a",
  ".mp3",
  ".wav",
  ".aac",
  ".flac",
  ".ogg",
  ".webm",
]);
const TYPES = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".m4b": "audio/mp4",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".webm": "video/webm",
};
function createMedia({ root, run, recognize }) {
  const folder = path.join(root, ".data/mac-library");
  fs.mkdirSync(folder, { recursive: true });
  const manifest = path.join(folder, "library.json");
  let items = [], libraryError;
  const temporaryManifest = manifest + ".tmp";
  function readManifest(file) {
    const entries = JSON.parse(fs.readFileSync(file, "utf8"));
    const ids = new Set(), files = new Set();
    if (!Array.isArray(entries) || !entries.every(item => {
      if (!item || typeof item.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(item.id) ||
          typeof item.file !== "string" || !/^[^/\\\x00]+$/.test(item.file) ||
          !ALLOWED.has(path.extname(item.file).toLowerCase()) ||
          !Number.isFinite(item.duration) || item.duration <= 0 ||
          (item.chapters != null && !Array.isArray(item.chapters)) ||
          ids.has(item.id) || files.has(item.file)) return false;
      ids.add(item.id);
      files.add(item.file);
      return true;
    })) throw Error("Invalid media library manifest");
    return entries;
  }
  try {
    items = readManifest(manifest);
  } catch (error) {
    try {
      const recovered = readManifest(temporaryManifest);
      if (error.code !== "ENOENT") {
        if (error.code) throw error;
        fs.copyFileSync(manifest, manifest + ".corrupt-" + crypto.randomUUID(), fs.constants.COPYFILE_EXCL);
      }
      fs.renameSync(temporaryManifest, manifest);
      items = recovered;
    } catch (recoveryError) {
      if (error.code !== "ENOENT" || recoveryError.code !== "ENOENT")
        libraryError = Error("The media library could not be read. Its files are preserved. Restore a valid library.json and restart immersed.");
    }
  }
  const requireLibrary = () => { if (libraryError) throw libraryError; };
  const jobs = new Map(), queue = [];
  let active = false, downloading = false;
  function save(next) {
    requireLibrary();
    fs.writeFileSync(temporaryManifest, JSON.stringify(next));
    try {
      fs.renameSync(temporaryManifest, manifest);
    } catch (error) {
      fs.rmSync(temporaryManifest, { force: true });
      throw error;
    }
    items = next;
  }
  const get = (id) => items.find((x) => x.id === id);
  async function probe(file) {
    const { stdout } = await run(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_format",
        "-show_streams",
        "-show_chapters",
        "-of",
        "json",
        file,
      ],
      { timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
    );
    const data = JSON.parse(stdout);
    const streams = data.streams || [];
    const hasAudio = streams.some((s) => s.codec_type === "audio");
    const hasVideo = streams.some((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
    if (!hasAudio && !hasVideo)
      throw Error("This file has no playable audio or video track.");
    const duration = Number(data.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0)
      throw Error("The media duration could not be read.");
    return {
      duration,
      hasAudio,
      subtitleStream: streams
        .filter((s) => s.codec_type === "subtitle" &&
          /^(ja|jpn)([-_]|$)/i.test(s.tags?.language || "") &&
          !s.disposition?.forced && Number.isInteger(s.index) && s.index >= 0 &&
          ["subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text"].includes(s.codec_name))
        .sort((a, b) => (b.disposition?.default || 0) - (a.disposition?.default || 0))[0]?.index ?? null,
      kind: hasVideo ? "video" : "audio",
      chapters: (data.chapters || []).map((c) => ({
        start: Number(c.start_time),
        end: Number(c.end_time),
        title: c.tags?.title || "Chapter",
      })),
    };
  }
  const windows = createTranscriptWindows({ folder, get, recognize });
  const coverTasks = new Map();
  async function artwork(id) {
    const item = get(id);
    if (!item) throw Error("Media not found");
    const target = path.join(folder, id + ".cover.jpg");
    if (fs.existsSync(target)) return target;
    if (fs.existsSync(target + ".missing")) return null;
    if (!coverTasks.has(id))
      coverTasks.set(
        id,
        (async () => {
          try {
            await run(
              "ffmpeg",
              [
                "-v",
                "error",
                "-i",
                path.join(folder, item.file),
                "-map",
                "0:v:0",
                "-frames:v",
                "1",
                "-vf",
                "scale=1024:1024:force_original_aspect_ratio=decrease",
                "-q:v",
                "2",
                "-y",
                target,
              ],
              { timeout: 30000, maxBuffer: 2000 },
            );
            return target;
          } catch {
            fs.rmSync(target, { force: true });
            fs.writeFileSync(target + ".missing", "");
            return null;
          } finally {
            coverTasks.delete(id);
          }
        })(),
      );
    return coverTasks.get(id);
  }
  function progress(id, data) {
    const item = get(id);
    if (!item) throw Error("Media not found");
    if (data) {
      requireLibrary();
      const position = Number(data.position),
        rate = Number(data.rate);
      if (
        !Number.isFinite(position) ||
        position < 0 ||
        position > item.duration + 1
      )
        throw Error("Invalid playback position");
      const chapterIndex = (item.chapters || []).findLastIndex(
        (c) => c.start <= position,
      );
      const progress = {
        position: Math.min(position, item.duration),
        chapterIndex,
        rate: [0.5, 0.75, 1, 1.25, 1.5, 2].includes(rate) ? rate : 1,
        updatedAt: Date.now(),
      };
      save(items.map(entry => entry.id === id ? { ...entry, progress } : entry));
      return progress;
    }
    return item.progress || { position: 0, chapterIndex: 0, rate: 1 };
  }
  function transcript(id, quality = "balanced", at = 0) {
    const originalKey = id + ":original";
    if (!jobs.has(originalKey)) {
      try {
        jobs.set(originalKey, { status: "ready", ...JSON.parse(fs.readFileSync(path.join(folder, id + "-original.json"), "utf8")) });
      } catch { /* No original track cached yet. */ }
    }
    if (jobs.has(originalKey)) return jobs.get(originalKey);
    const active = jobs.get(id + ":" + quality);
    if (
      active &&
      ["processing", "queued", "unavailable"].includes(active.status)
    )
      return active;
    if (get(id)?.duration > 600) {
      const window = windows.result(id, quality, at);
      if (window.status !== "idle" || window.processedSeconds > 0)
        return window;
    }
    const file = path.join(folder, id + "-" + quality + ".json");
    try {
      return { status: "ready", ...JSON.parse(fs.readFileSync(file, "utf8")) };
    } catch {
      return get(id)?.duration > 600
        ? windows.result(id, quality, at)
        : jobs.get(id + ":" + quality) || { status: "idle" };
    }
  }
  async function drain() {
    if (active) return;
    active = true;
    while (queue.length) {
      const { id, quality } = queue.shift(),
        key = id + ":" + quality,
        item = get(id);
      if (!item) continue;
      jobs.set(key, {
        status: "processing",
        stage: "Recognizing Japanese speech",
        cues: [],
      });
      try {
        const cues = await recognize(
          path.join(folder, item.file),
          (progress) => jobs.set(key, progress),
          quality,
        );
        if (!cues.length)
          throw Error(
            "No Japanese speech was recognized. Try another section or check the audio language.",
          );
        const data = {
          cues,
          source: "generated",
          model:
            quality === "accurate"
              ? "Whisper large-v3 / MLX"
              : "Whisper large-v3-turbo / MLX",
          version: 3,
          pipeline: "mac-whisper-context-v4",
          quality,
        };
        fs.writeFileSync(
          path.join(folder, id + "-" + quality + ".json.tmp"),
          JSON.stringify(data),
        );
        fs.renameSync(
          path.join(folder, id + "-" + quality + ".json.tmp"),
          path.join(folder, id + "-" + quality + ".json"),
        );
        jobs.set(key, { status: "ready", ...data });
      } catch (e) {
        jobs.set(key, {
          status: "unavailable",
          message: String(e.message).slice(0, 240),
          canRetry: true,
        });
      }
    }
    active = false;
  }
  const originalTasks = new Map();
  async function originalTranscript(item) {
    if (!originalTasks.has(item.id)) originalTasks.set(item.id, (async () => {
      jobs.set(item.id + ":subtitles", { status: "processing" });
      try {
        const file = path.join(folder, item.file);
        if (item.subtitleStream === undefined) {
          const subtitleStream = (await probe(file)).subtitleStream;
          save(items.map(entry => entry.id === item.id ? { ...entry, subtitleStream } : entry));
          item = get(item.id);
        }
        if (!Number.isInteger(item.subtitleStream)) return;
        const { stdout } = await run("ffmpeg", ["-nostdin", "-v", "error", "-i", file,
          "-map", "0:" + item.subtitleStream, "-c:s", "webvtt", "-f", "webvtt", "pipe:1"],
        { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
        const { parseSubtitles } = require("../src/subtitles.ts");
        const cues = parseSubtitles(stdout).map(cue => ({ ...cue, end: Math.min(cue.end, item.duration) }))
          .filter(cue => cue.start < cue.end);
        if (!cues.length) return;
        const data = { cues, source: "human", model: "Original Japanese subtitles", version: 3 };
        const target = path.join(folder, item.id + "-original.json");
        fs.writeFileSync(target + ".tmp", JSON.stringify(data));
        fs.renameSync(target + ".tmp", target);
        jobs.set(item.id + ":original", { status: "ready", ...data });
      } catch { /* Unsupported or damaged tracks fall back to speech recognition. */ }
      finally { jobs.delete(item.id + ":subtitles"); }
    })().finally(() => originalTasks.delete(item.id)));
    await originalTasks.get(item.id);
  }
  async function start(id, retry = false, quality = "balanced", at = 0) {
    if (!get(id)) throw Error("Media was not found.");
    if (transcript(id, quality, at).source !== "human") await originalTranscript(get(id));
    const key = id + ":" + quality,
      current = transcript(id, quality, at);
    if (current.source === "human") return current;
    if (get(id).hasAudio === false) {
      const unavailable = { status: "unavailable", message: "No Japanese subtitles are available for this silent video.", canRetry: false };
      jobs.set(key, unavailable);
      return unavailable;
    }
    if (get(id).duration > 600 && (current.windowed || retry))
      return windows.start(id, quality, at, retry);
    if (current.status === "ready" && !retry) return current;
    if (!["processing", "queued"].includes(jobs.get(key)?.status)) {
      if (queue.length >= 20) throw Error("The speech queue is full.");
      jobs.set(key, {
        status: "queued",
        stage: "Waiting for the speech worker",
      });
      queue.push({ id, quality });
      void drain();
    }
    return transcript(id, quality);
  }
  async function importFile(req, name) {
    requireLibrary();
    const ext = path.extname(name).toLowerCase();
    if (!ALLOWED.has(ext))
      throw Error(
        "Choose MP4, MOV, M4B, M4A, MP3, WAV, AAC, FLAC, OGG or WebM.",
      );
    const id = crypto.randomUUID(),
      file = id + ext,
      partial = path.join(folder, file + ".part");
    let bytes = 0, moved = false;
    try {
      await pipeline(
        req,
        new Transform({
          transform(chunk, encoding, cb) {
            bytes += chunk.length;
            cb(
              bytes > 8 * 1024 ** 3
                ? Error("The file exceeds the 8 GB import limit.")
                : null,
              chunk,
            );
          },
        }),
        fs.createWriteStream(partial, { flags: "wx" }),
      );
      const info = await probe(partial);
      fs.renameSync(partial, path.join(folder, file));
      moved = true;
      const item = {
        id,
        file,
        title: path.basename(name).slice(0, 240),
        ...info,
        addedAt: Date.now(),
        source: "local",
      };
      save([item, ...items]);
      return item;
    } catch (e) {
      fs.rmSync(partial, { force: true });
      if (moved) fs.rmSync(path.join(folder, file), { force: true });
      throw e;
    }
  }
  async function download(videoId) {
    requireLibrary();
    const existing = items.find((x) => x.videoId === videoId);
    if (existing) return existing;
    if (downloading)
      throw Error("A download is already running. Wait for it to finish.");
    downloading = true;
    const id = crypto.randomUUID(),
      output = path.join(folder, id + ".%(ext)s");
    try {
      await run(
        "yt-dlp",
        [
          "--no-playlist",
          "--no-progress",
          "--write-info-json",
          "--max-filesize",
          "2G",
          "-f",
          "bv*[ext=mp4][vcodec^=avc1][height<=1080]+ba[ext=m4a]/b[ext=mp4]/best",
          "--merge-output-format",
          "mp4",
          "-o",
          output,
          "https://www.youtube.com/watch?v=" + videoId,
        ],
        { timeout: 30 * 60_000, maxBuffer: 2 * 1024 * 1024 },
      );
      const file = fs
        .readdirSync(folder)
        .find((f) => f.startsWith(id + ".") && ALLOWED.has(path.extname(f)));
      if (!file) throw Error("No playable file was downloaded.");
      const info = await probe(path.join(folder, file));
      let metadata = {};
      try {
        metadata = JSON.parse(
          fs.readFileSync(path.join(folder, id + ".info.json"), "utf8"),
        );
      } catch {}
      const item = {
        id,
        file,
        videoId,
        title: metadata.title || videoId,
        ...info,
        addedAt: Date.now(),
        source: "youtube",
      };
      save([item, ...items]);
      return item;
    } finally {
      downloading = false;
      for (const f of fs
        .readdirSync(folder)
        .filter(
          (f) => f.startsWith(id + ".") && !items.some((x) => x.file === f),
        ))
        fs.rmSync(path.join(folder, f), { force: true });
    }
  }
  function remove(id) {
    requireLibrary();
    const item = get(id);
    if (!item) throw Error("Media was not found.");
    if (windows.busy(id))
      throw Error(
        "Wait for the current minute to finish before removing this media.",
      );
    if (
      [...jobs.entries()].some(
        ([key, job]) => key.startsWith(id + ":") && job.status === "processing",
      )
    )
      throw Error(
        "Wait for speech recognition to finish before removing this media.",
      );
    for (let i = queue.length - 1; i >= 0; i--)
      if (queue[i].id === id) queue.splice(i, 1);
    save(items.filter((x) => x.id !== id));
    fs.rmSync(path.join(folder, item.file), { force: true });
    fs.rmSync(path.join(folder, "windows", id), {
      recursive: true,
      force: true,
    });
    for (const suffix of [".cover.jpg", ".cover.jpg.missing"])
      fs.rmSync(path.join(folder, id + suffix), { force: true });
    fs.rmSync(path.join(folder, id + "-original.json"), { force: true });
    fs.rmSync(path.join(folder, id + "-original.json.tmp"), { force: true });
    jobs.delete(id + ":original");
    originalTasks.delete(id);
    for (const quality of ["balanced", "accurate"]) {
      fs.rmSync(path.join(folder, id + "-" + quality + ".json"), {
        force: true,
      });
      jobs.delete(id + ":" + quality);
    }
  }
  function seed(id, data, quality = "balanced") {
    if (!get(id) || !Array.isArray(data.cues) || !data.cues.length) return;
    const file = path.join(folder, id + "-" + quality + ".json");
    fs.writeFileSync(
      file + ".tmp",
      JSON.stringify({
        cues: data.cues,
        source: data.source || "generated",
        model: data.model || "cached transcript",
        version: 2,
      }),
    );
    fs.renameSync(file + ".tmp", file);
  }
  function serve(req, res, id) {
    const item = get(id);
    if (!item) {
      res.writeHead(404);
      return res.end();
    }
    const file = path.join(folder, item.file),
      size = fs.statSync(file).size,
      type = TYPES[path.extname(file)] || "application/octet-stream";
    const range = req.headers.range;
    let start = 0,
      end = size - 1,
      status = 200;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (!m[1] && !m[2])) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` });
        return res.end();
      }
      if (m[1]) {
        start = Number(m[1]);
        if (m[2]) end = Math.min(Number(m[2]), end);
      } else start = Math.max(0, size - Number(m[2]));
      if (!Number.isSafeInteger(start) || start >= size || end < start) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` });
        return res.end();
      }
      status = 206;
    }
    res.writeHead(status, {
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      ...(status === 206
        ? { "Content-Range": `bytes ${start}-${end}/${size}` }
        : {}),
    });
    if (req.method === "HEAD") return res.end();
    const stream = fs.createReadStream(file, { start, end });
    res.on("close", () => stream.destroy());
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  }
  return {
    seed,
    artwork,
    progress,
    remove,
    list: () => {
      requireLibrary();
      return items.map(({ file, ...item }) => ({
        ...item,
        transcript: transcript(item.id).status,
      }));
    },
    get,
    importFile,
    download,
    serve,
    start,
    transcript,
  };
}
module.exports = { createMedia };
