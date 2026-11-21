const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createMedia } = require("../desktop/media.cjs");
const run = promisify(execFile);
test("damaged manifests block writes and recover from a valid interrupted save", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "immersed-manifest-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = { root, run: async () => assert.fail("must not start media processing") };
  const folder = path.join(root, ".data/mac-library");
  const manifest = path.join(folder, "library.json");
  assert.deepEqual(createMedia(options).list(), []);
  const mediaFile = path.join(folder, "book.m4b");
  fs.writeFileSync(mediaFile, "media fixture");
  for (const contents of ['{"truncated":', '{"items":[]}', '[{"id":"../outside","file":"book.m4b","duration":1}]']) {
    fs.writeFileSync(manifest, contents);
    const damaged = createMedia(options);
    assert.throws(() => damaged.list(), /files are preserved/);
    await assert.rejects(damaged.importFile(null, "new.mp4"), /files are preserved/);
    await assert.rejects(damaged.download("aaaaaaaaaaa"), /files are preserved/);
    assert.throws(() => damaged.remove("book"), /files are preserved/);
    assert.equal(fs.readFileSync(manifest, "utf8"), contents);
    assert.equal(fs.readFileSync(mediaFile, "utf8"), "media fixture");
  }
  const damagedBytes = fs.readFileSync(manifest, "utf8");
  const original = [{ id: "book", file: "book.m4b", duration: 60,
    progress: { position: 10, chapterIndex: 0, rate: 1 } }];
  fs.writeFileSync(manifest + ".tmp", JSON.stringify(original));
  const recovered = createMedia(options);
  assert.equal(recovered.list()[0].id, "book");
  assert.deepEqual(recovered.progress("book"), original[0].progress);
  assert.deepEqual(JSON.parse(fs.readFileSync(manifest, "utf8")), original);
  const quarantine = fs.readdirSync(folder).filter(name => name.startsWith("library.json.corrupt-"));
  assert.equal(quarantine.length, 1);
  assert.equal(fs.readFileSync(path.join(folder, quarantine[0]), "utf8"), damagedBytes);
});
test("local M4B import persists chapters, supports byte seeking, and serializes recognition", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "immersed-library-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const metadata = path.join(root, "chapters.txt");
  fs.writeFileSync(
    metadata,
    ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=第一章\n",
  );
  const fixture = path.join(root, "book.m4b");
  await run("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-i",
    metadata,
    "-map_metadata",
    "1",
    "-map_chapters",
    "1",
    "-c:a",
    "aac",
    fixture,
  ]);
  let running = 0,
    peak = 0;
  const media = createMedia({
    root,
    run,
    recognize: async (_file, progress) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 20));
      const cues = [{ start: 0, end: 1, text: "日本語です。" }];
      progress({ status: "processing", cues });
      running--;
      return cues;
    },
  });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "POST") {
        const item = await media.importFile(req, url.searchParams.get("name"));
        res.end(JSON.stringify(item));
      } else media.serve(req, res, url.searchParams.get("id"));
    } catch (e) {
      res.statusCode = 400;
      res.end(e.message);
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const base = "http://127.0.0.1:" + server.address().port;
  const response = await fetch(base + "/?name=book.m4b", {
    method: "POST",
    body: fs.readFileSync(fixture),
  });
  assert.equal(response.status, 200);
  const item = await response.json();
  assert.equal(item.kind, "audio");
  assert.equal(item.chapters[0].title, "第一章");
  assert.ok(item.duration >= 1);
  const range = await fetch(base + "/?id=" + item.id, {
    headers: { Range: "bytes=0-31" },
  });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 32);
  assert.equal(range.headers.get("content-type"), "audio/mp4");
  const suffix = await fetch(base + "/?id=" + item.id, {
    headers: { Range: "bytes=-12" },
  });
  assert.equal((await suffix.arrayBuffer()).byteLength, 12);
  assert.equal(
    (
      await fetch(base + "/?id=" + item.id, {
        headers: { Range: "bytes=99999999-" },
      })
    ).status,
    416,
  );
  assert.equal((await fetch(base + "/?id=../../etc/passwd")).status, 404);
  const second = await (
    await fetch(base + "/?name=second.m4b", {
      method: "POST",
      body: fs.readFileSync(fixture),
    })
  ).json();
  await media.start(item.id);
  await media.start(second.id);
  for (
    let i = 0;
    i < 100 && media.transcript(second.id).status !== "ready";
    i++
  )
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(peak, 1);
  assert.equal(media.transcript(item.id).status, "ready");
  assert.equal(media.transcript(second.id).status, "ready");
  media.progress(item.id, { position: 0.6, rate: 1.5 });
  assert.throws(() => media.progress(item.id, { position: 9999 }), /Invalid/);
  const restored = createMedia({
    root,
    run,
    recognize: async () => {
      throw Error("should use cache");
    },
  });
  assert.equal(restored.list().length, 2);
  assert.equal(restored.progress(item.id).position, 0.6);
  assert.equal(restored.progress(item.id).chapterIndex, 0);
  assert.equal(restored.progress(item.id).rate, 1.5);
  assert.equal(await restored.artwork(item.id), null);
  assert.equal(restored.transcript(item.id).cues[0].text, "日本語です。");
  await media.start(item.id, true);
  assert.equal(
    media.transcript(item.id).status,
    "processing",
    "retry must not be hidden behind the old cache",
  );
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(media.transcript(item.id).status, "ready");
  const bad = await fetch(base + "/?name=bad.mp4", {
    method: "POST",
    body: "not media",
  });
  assert.equal(bad.status, 400);
  assert.equal(media.list().length, 2);
  assert.ok(
    !fs
      .readdirSync(path.join(root, ".data/mac-library"))
      .some((x) => x.endsWith(".part")),
  );
});
test("shared iOS/Mac preference and level policy preserves explicit unknown overrides", () => {
  const { restorePreferences } = require("../src/preferences-core");
  const { familiarity } = require("../src/learning-core");
  const levels = require("../src/data/jlpt-levels.json");
  assert.equal(familiarity(levels, "食べる", "たべる", 5, {}), "known");
  assert.equal(familiarity(levels, "政治", "せいじ", 5, {}), "unknown");
  assert.equal(familiarity(levels, "政治", "せいじ", 1, {}), "known");
  assert.equal(
    familiarity(levels, "食べる", "たべる", 1, { 食べる: false }),
    "unknown",
  );
  assert.equal(familiarity(levels, "未登録test", "", 5, {}), "unlisted");
  const p = restorePreferences({
    level: 99,
    minimumMinutes: 7,
    knowledge: { 食べる: false, bad: "yes" },
    readings: false,
  });
  assert.equal(p.level, 5);
  assert.equal(p.minimumMinutes, 0);
  assert.deepEqual(p.knowledge, { 食べる: false });
  assert.equal(p.readings, false);
});

test("offline download storage reuses existing media, seeds subtitles and removes owned files", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "immersed-download-test-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = path.join(root, "fixture.m4a");
  await run("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-c:a",
    "aac",
    fixture,
  ]);
  let downloads = 0;
  const media = createMedia({
    root,
    recognize: async () => [],
    run: async (command, args, options) => {
      if (command !== "yt-dlp") return run(command, args, options);
      downloads++;
      const output = args[args.indexOf("-o") + 1];
      fs.copyFileSync(fixture, output.replace("%(ext)s", "mp4"));
      fs.writeFileSync(
        output.replace("%(ext)s", "info.json"),
        JSON.stringify({ title: "A downloaded example" }),
      );
      return { stdout: "" };
    },
  });
  const item = await media.download("abcdefghijk");
  assert.equal(item.title, "A downloaded example");
  assert.equal((await media.download("abcdefghijk")).id, item.id);
  assert.equal(downloads, 1);
  media.seed(
    item.id,
    { cues: [{ start: 0, end: 1, text: "日本語です。" }], source: "generated" },
    "accurate",
  );
  assert.equal(media.transcript(item.id, "accurate").status, "ready");
  assert.equal(media.transcript(item.id).status, "idle");
  media.remove(item.id);
  assert.equal(media.list().length, 0);
  assert.equal(
    fs
      .readdirSync(path.join(root, ".data/mac-library"))
      .filter((f) => f !== "library.json").length,
    0,
  );
});


test("embedded Japanese captions on silent video bypass Whisper and minute windows, survive restart, and retain timing", async (t) => {
  const { Readable } = require("node:stream");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "immersed-original-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const japanese = path.join(root, "ja.srt"), english = path.join(root, "en.srt");
  fs.writeFileSync(japanese, "1\n00:00:01,125 --> 00:00:02,375\n<b>公共性</b>について。\n\n2\n00:00:02,500 --> 00:00:03,750\n日本語です。\n");
  fs.writeFileSync(english, "1\n00:00:00,000 --> 00:00:03,000\nEnglish track\n");
  const fixture = path.join(root, "captions.mp4");
  await run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=s=32x32:d=4",
    "-i", english, "-i", japanese, "-map", "0:v", "-map", "1:0", "-map", "2:0", "-c:v", "mpeg4", "-c:s", "mov_text",
    "-metadata:s:s:0", "language=eng", "-metadata:s:s:1", "language=jpn", fixture]);
  let extracted = 0;
  const media = createMedia({ root, recognize: async () => assert.fail("Original subtitles must not start Whisper"),
    run: async (command, args, options) => {
      const result = await run(command, args, options);
      if (command === "ffprobe") {
        const data = JSON.parse(result.stdout);data.format.duration = "54000";
        return { stdout: JSON.stringify(data) };
      }
      if (command === "ffmpeg") extracted++;
      return result;
    } });
  const item = await media.importFile(Readable.from(fs.readFileSync(fixture)), "Japanese.mp4");
  assert.equal(item.kind, "video");
  assert.equal(item.hasAudio, false);
  media.seed(item.id, { cues: [{ start: 0, end: 3, text: "Old generated wording" }] }, "accurate");
  const [balanced, accurate] = await Promise.all([media.start(item.id), media.start(item.id, true, "accurate", 30000)]);
  assert.equal(balanced.source, "human");assert.equal(balanced.windowed, undefined);
  assert.deepEqual(balanced.cues, [{ start: 1.125, end: 2.375, text: "公共性について。" }, { start: 2.5, end: 3.75, text: "日本語です。" }]);
  assert.deepEqual(accurate.cues, balanced.cues);assert.equal(extracted, 1);
  const withoutCaptions = path.join(root, "no-captions.mp4");
  await run("ffmpeg", ["-v", "error", "-i", fixture, "-map", "0:v", "-c", "copy", withoutCaptions]);
  const silent = await media.importFile(fs.createReadStream(withoutCaptions), "Silent.mp4");
  assert.equal((await media.start(silent.id)).canRetry, false);
  assert.equal(media.transcript(silent.id).status, "unavailable");
  const restored = createMedia({ root, run: async () => assert.fail("Cached original captions must be immediate"), recognize: async () => assert.fail("Must not recognize") });
  assert.deepEqual((await restored.start(item.id, true, "accurate", 50000)).cues, balanced.cues);
  restored.remove(item.id);
  assert.equal(fs.readdirSync(path.join(root, ".data/mac-library")).some(f => f.includes(item.id)), false);
});

test("legacy library migration selects a full default Japanese text track and protects an active extraction", async (t) => {
  const { Readable } = require("node:stream");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "immersed-track-choice-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let requested;
  const media = createMedia({ root, recognize: async () => assert.fail("Must use Japanese text"), run: async (command, args) => {
    if (command === "ffprobe") return { stdout: JSON.stringify({ format: { duration: 10 }, streams: [
      { codec_type: "audio" },
      { index: 1, codec_type: "subtitle", codec_name: "subrip", tags: { language: "eng" }, disposition: { default: 1 } },
      { index: 2, codec_type: "subtitle", codec_name: "subrip", tags: { language: "jpn" }, disposition: { forced: 1 } },
      { index: 3, codec_type: "subtitle", codec_name: "subrip", tags: { language: "jpn" } },
      { index: 4, codec_type: "subtitle", codec_name: "mov_text", tags: { language: "ja-JP" }, disposition: { default: 1 } },
    ] }) };
    requested = args;await gate;
    return { stdout: "WEBVTT\n\n00:01.000 --> 00:03.000\n日本語の字幕\n" };
  } });
  const item = await media.importFile(Readable.from("media bytes"), "legacy.mp4");
  delete item.subtitleStream;
  const pending = media.start(item.id);
  await new Promise(resolve => setImmediate(resolve));
  assert.throws(() => media.remove(item.id), /Wait for speech recognition/);
  assert.equal(requested[requested.indexOf("-map") + 1], "0:4");
  release();assert.equal((await pending).source, "human");
});

test("foreign, forced-only, untagged, bitmap and broken subtitle tracks keep the speech fallback", async (t) => {
  const { Readable } = require("node:stream");
  for (const track of [
    { tags: { language: "eng" } }, { tags: { language: "jpn" }, disposition: { forced: 1 } },
    {}, { tags: { language: "jpn" }, codec_name: "hdmv_pgs_subtitle" }, { tags: { language: "jpn" } },
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "immersed-track-fallback-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    let recognized = 0;
    const media = createMedia({ root, recognize: async () => { recognized++;return [{ start: 0, end: 1, text: "音声から" }]; },
      run: async command => command === "ffprobe"
        ? { stdout: JSON.stringify({ format: { duration: 2 }, streams: [{ codec_type: "audio" }, { index: 1, codec_type: "subtitle", codec_name: "subrip", ...track }] }) }
        : { stdout: "Malformed subtitles" } });
    const item = await media.importFile(Readable.from("media bytes"), "fallback.mp4");
    await media.start(item.id);await new Promise(resolve => setImmediate(resolve));
    assert.equal(recognized, 1);assert.equal(media.transcript(item.id).source, "generated");
  }
});
