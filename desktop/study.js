"use strict";
const $ = (id) => document.getElementById(id),
  el = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
const iconPaths = {
  previous: '<path d="m14 6-6 6 6 6"/>', next: '<path d="m10 6 6 6-6 6"/>',
  netflix: '<path d="M7 20V4l10 16V4"/>',
  discover: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z"/>',
  play: '<path d="m9 5 11 7-11 7Z"/>', watch: '<rect x="3" y="4" width="18" height="14" rx="4"/><path d="m10 8 5 3-5 3M8 21h8"/>',
  pause: '<path d="M8 5v14m8-14v14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 9h18"/>',
  library: '<path d="M4 4v16M9 4v16m5-15 5 14M3 4h7M3 20h7"/>',
  words: '<path d="M12 5C8 2 4 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-2-10 1Zm0 0v15"/>',
  settings: '<path d="m9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 2 3h3l1-3 3-1 2-3-2-2 1-3-2-3-3 1-2-3Z"/><circle cx="11.5" cy="11.5" r="3"/>',
  fullscreen: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  save: '<path d="M6 3h12v19l-6-4-6 4Z"/>', check: '<path d="m5 12 4 4L20 5"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9Zm13-1c3 2 3 6 0 8m3-11c5 4 5 10 0 14"/>',
  trash: '<path d="M3 6h18M9 3h6M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>', refresh: '<path d="M20 8a9 9 0 1 0 0 9M20 3v6h-6"/>',
};
function decorateButton(node, label, icon) {
  node.setAttribute("aria-label", label); node.title = label;
  node.classList.add("iconButton");
  node.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + iconPaths[icon] + '</svg>';
  node.append(el("span", label, "srOnly"));
  return node;
}
function iconButton(label, icon, action) { return decorateButton(button("", action), label, icon); }
function setPlayIcon(playing) {
  const control = $("play");
  control.dataset.playing = String(playing);
  control.innerHTML = '<svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + iconPaths[playing ? "pause" : "play"] + '</svg>';
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds)),
    hours = Math.floor(total / 3600),
    minutes = Math.floor((total % 3600) / 60),
    s = String(total % 60).padStart(2, "0");
  return hours
    ? hours + ":" + String(minutes).padStart(2, "0") + ":" + s
    : minutes + ":" + s;
}
function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
let prefs = ImmersedPreferences.restorePreferences(
  read("immersed.preferences", {}),
);
if (!localStorage.getItem("immersed.preferences")) {
  prefs.level = Number(
    (localStorage.getItem("immersed.mac.level") || "N5").slice(1),
  );
  for (const word of read("immersed.mac.known", []))
    prefs.knowledge[word] = true;
}
let extras = {
    blockAds: true,
    originalOnly: true,
    conversationFirst: true,
    nativeAudience: true,
    hoverLookup: true,
    screenCaptionCheck: true,
    pauseOnHover: true,
    dictionaryDetails: false,
    pauseAfterSubtitle: false,
    netflixOriginal: true,
    wordStates: {},
    speechQuality: "balanced",
    playbackRate: 1,
    paneShare: .6,
    ...read("immersed.mac.options", {}),
  },
  saved = read("immersed.savedWords", []);
let recentWords = read("immersed.recentWords", []);
if (!Array.isArray(recentWords)) recentWords = [];
let localMedia = null,
  netflix = null,
  youtube = null,
  source = null,
  cues = [],
  cueIndex = -1,
  renderedCue = null,
  pollTimer = null,
  renderGeneration = 0,
  requestGeneration = 0,
  selected = null,
  lookupEntries = [],
  lookupMeaning = "",
  lookupPinned = false,
  resumeAfterLookup = false,
  resumePending = false,
  lookupAnchor = null,
  lookupRevision = 0,
  lookupCue = null,
  hoverCooldownUntil = 0,
  cueSeek = null,
  hoverTimer = null,
  hoverSequence = 0,
  leaveTimer = null,
  levels = {},
  library = [],
  youtubeReady = null,
  youtubePlaybackIntent = false;
// Repair the 0.9.5 forced model switch. Later explicit model choices persist.
if (!read("immersed.kanjiDefault", false)) {
  extras.speechQuality = "balanced";
  try {
    localStorage.setItem("immersed.kanjiDefault", "true");
    localStorage.setItem("immersed.mac.options", JSON.stringify(extras));
  } catch {}
}
const screenCaptions = read("immersed.screenCaptions", {});
const screenFrames = new Map();
let transcriptKind = "generated", lastScreenScan = 0;
function screenCaptionKey(cue) { return [source?.id, extras.speechQuality, cue.start.toFixed(2), cue.end.toFixed(2)].join(":"); }
function restoredScreenCaption(cue) {
  const stored = screenCaptions[screenCaptionKey(cue)];
  return stored?.original === cue.text ? { ...cue, text: stored.text, asrText: cue.text, screenVerified: true } : cue;
}
function scanCurrentVideoCaption(now) {
  if (!extras.screenCaptionCheck || !document.hasFocus() || selected || !window.webkit?.messageHandlers?.immersed || source?.type !== "youtube" || !["generated", "youtube-asr"].includes(transcriptKind) || document.visibilityState === "hidden" || now - lastScreenScan < 900) return;
  const cue = cues[cueIndex];
  if (!cue || cue.screenVerified || (playing() && currentTime() - cue.start < 0.2)) return;
  const key = requestGeneration + ":" + screenCaptionKey(cue);
  let frame = screenFrames.get(key);
  if (!frame) {
    frame = { cue, original: cue.text, attempts: 0, confirmations: 0, responses: 0, pending: false, complete: false };
    screenFrames.set(key, frame);
  }
  if (frame.pending || frame.complete || frame.attempts >= 3) return;
  const rect = $("video").getBoundingClientRect();
  if (rect.width < 100 || rect.height < 50) return;
  frame.pending = true; frame.attempts++; frame.responses = 0;
  const attempt = frame.sequence = (frame.sequence || 0) + 1;
  const sample = frame.attempts;
  lastScreenScan = now;
  window.webkit.messageHandlers.immersed.postMessage({ action: "captionFrame", key,
    videoId: source.id, attempt, at: Math.max(cue.start, Math.min(cue.end - 0.05, !playing() && sample === 1 && currentTime() >= cue.start && currentTime() < cue.end ? currentTime() : cue.start + sample * 0.8)) });
  setTimeout(() => { if (frame.sequence === attempt) frame.pending = false; }, 45000);
}
window.immersedVideoText = async (key, lines, attempt, busy = false, confidence = 1, totalFrames = 2) => {
  const frame = screenFrames.get(key);
  if (!frame || frame.complete || !Array.isArray(lines) || !key.startsWith(requestGeneration + ":") || (attempt != null && attempt !== frame.sequence)) return;
  frame.expectedResponses = Math.max(2, Math.min(3, totalFrames));
  if (busy) { frame.pending = false; frame.attempts = Math.max(0, frame.attempts - 1); return; }
  if (!extras.screenCaptionCheck || selected) { frame.pending = false; frame.attempts = 0; frame.sequence = (frame.sequence || 0) + 1; return; }
  try {
    const result = await api("immersion/screen-caption", { sentence: frame.original, lines: JSON.stringify(lines) });
    if (!screenFrames.has(key) || (attempt != null && attempt !== frame.sequence)) return;
    if (!result.match) return;
    const same = frame.text === result.match.text;
    frame.confirmations = same ? frame.confirmations + 1 : 1;
    frame.confidence = same ? Math.min(frame.confidence ?? 1, confidence) : confidence;
    frame.text = result.match.text;
    if (frame.confirmations < (frame.confidence < .87 ? 3 : 2)) return;
    frame.complete = true;
    const index = cues.findIndex(c => c.start === frame.cue.start && (c.text === frame.original || c.asrText === frame.original));
    if (index < 0) return;
    const correction = { original: frame.original, text: frame.text };
    screenCaptions[screenCaptionKey(cues[index])] = correction;
    const keys = Object.keys(screenCaptions);
    for (const old of keys.slice(0, Math.max(0, keys.length - 800))) delete screenCaptions[old];
    try { localStorage.setItem("immersed.screenCaptions", JSON.stringify(screenCaptions)); } catch {}
    cues[index] = { ...cues[index], screenText: frame.text, asrText: frame.original, screenVerified: true };
    if (!selected) { cues[index].text = frame.text; cueIndex = -1; void renderCue(); }
  } catch { /* Keep acoustic subtitles when the frame cannot be matched. */ }
  finally { if (attempt == null || attempt === frame.sequence) { frame.responses = (frame.responses || 0) + 1; if (frame.responses >= (frame.expectedResponses || 2) || frame.complete) { frame.pending = false; if (frame.attempts >= 3) frame.complete = true; } } }
};
const positions = read("immersed.positions", {});
let lastPositionSave = 0,
  coverageTokens = [];
$("understanding").hidden = true;
const analysisCache = new Map(),
  dictionaryCache = new Map(),
  pendingAnalysis = new Map();
function persist() {
  try {
    localStorage.setItem("immersed.preferences", JSON.stringify(prefs));
    localStorage.setItem("immersed.mac.options", JSON.stringify(extras));
    localStorage.setItem("immersed.savedWords", JSON.stringify(saved));
    localStorage.setItem("immersed.recentWords", JSON.stringify(recentWords));
  } catch {
    status("Settings could not be saved. Export a backup from Settings.", true);
  }
}
function applyPreferences() {
  if (netflix) netflixCommand("original", extras.netflixOriginal !== false);
  document.body.classList.toggle("light", !prefs.dark);
  document.documentElement.dataset.dotTheme = prefs.dark ? "dark" : "light";
  window.webkit?.messageHandlers?.immersed?.postMessage({
    action: "blockAds",
    enabled: extras.blockAds,
  });
  cueIndex = -1;
  void renderCue();
  updateCoverage();
  if (!$("discovery").hidden) discoveryPaint?.();
}
function speechProgress(data = null) {
  const panel = $("speechProgress"), bar = $("speechBar");
  panel.hidden = !data || ["ready", "unavailable"].includes(data.status);
  $("status").hidden = !panel.hidden;
  if (panel.hidden) return;
  const measured = data.phase === "recognizing" && data.duration > 0;
  const percent = Math.max(0, Math.min(100, Math.floor(100 * (data.processedSeconds || 0) / data.duration)));
  const stage = data.phase === "recognizing" ? "Transcribing" : data.phase === "loading" ? "Loading model" : /audio/i.test(data.stage || "") ? "Preparing audio" : "Preparing subtitles";
  $("speechStage").textContent = (extras.speechQuality === "accurate" ? "Large v3" : "Whisper Turbo") + " · " + stage;
  $("speechPercent").textContent = measured ? percent + "%" : "Preparing…";
  if (measured) bar.value = percent; else bar.removeAttribute("value");
}
function status(text, error = false) {
  if (error || !text) speechProgress();
  $("status").textContent = text;
  $("status").className = error ? "error" : "";
}
async function api(route, params = {}, method = "GET", body) {
  const response = await fetch(
    "/api/" + route + "?" + new URLSearchParams(params),
    {
      method,
      headers: method === "GET" ? {} : { "X-Immersed-Request": "1" },
      body,
    },
  );
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "Request failed");
  return data;
}
function cacheSet(cache, key, value, max = 250) {
  cache.set(key, value);
  if (cache.size > max) cache.delete(cache.keys().next().value);
}
const pendingDictionary = new Map();
const dictionaryKey = token => [token.lemma, token.reading, token.pos, token.proper].join(":");
function dictionaryFor(token) {
  const key = dictionaryKey(token);
  if (dictionaryCache.has(key)) return Promise.resolve(dictionaryCache.get(key));
  if (!pendingDictionary.has(key)) pendingDictionary.set(key, api("immersion/dictionary", {
    word: token.lemma, reading: token.reading || "", pos: token.pos || "", proper: String(!!token.proper),
  }).then(data => { cacheSet(dictionaryCache, key, data); return data; }).finally(() => pendingDictionary.delete(key)));
  return pendingDictionary.get(key);
}
function analyze(text) {
  if (analysisCache.has(text)) return Promise.resolve(analysisCache.get(text));
  if (pendingAnalysis.has(text)) return pendingAnalysis.get(text);
  const task = api("immersion/analyze", { text })
    .then((data) => {
      cacheSet(analysisCache, text, data.tokens);
      for (const token of data.tokens) {
        const key = ["particle", "auxiliary"].includes(token.pos)
          ? "grammar:" + token.pos + ":" + token.lemma
          : token.proper
            ? token.lemma + ":name:" + token.reading
            : token.lemma;
        const exact = [
          token.lemma,
          token.reading,
          token.pos,
          token.proper,
        ].join(":");
        if (data.lookups && Object.hasOwn(data.lookups, exact))
          cacheSet(dictionaryCache, exact, { data: data.lookups[exact] });
        else if (data.dictionary && Object.hasOwn(data.dictionary, key))
          cacheSet(dictionaryCache, exact, { data: data.dictionary[key] });
      }
      // Make the line interactive before warming its dictionary entries.
      for (const token of data.tokens.filter(t => t.word).slice(0, 6)) void dictionaryFor(token).catch(() => {});
      return data.tokens;
    })
    .finally(() => pendingAnalysis.delete(text));
  pendingAnalysis.set(text, task);
  return task;
}
const wordStates = { '1': 'unknown', '2': 'learning', '3': 'known', '4': 'ignored' };
const stateLabel = state => ({unknown:'Unknown',learning:'Learning',known:'Known',ignored:'Ignored'})[state];
if (!extras.wordStates || typeof extras.wordStates !== 'object' || Array.isArray(extras.wordStates)) extras.wordStates = {};
extras.wordStates = Object.fromEntries(Object.entries(extras.wordStates).filter(([key,value])=>key.length<=120 && Object.values(wordStates).includes(value)));
const familiarity = (t) =>
  extras.wordStates[t.lemma] === 'ignored' ? 'ignored' : extras.wordStates[t.lemma] === 'learning' ? 'learning' : ImmersedLearning.familiarity(
    levels,
    t.lemma,
    t.reading,
    prefs.level,
    prefs.knowledge,
  );
function handleYouTubeState(event) {
  if (event.data === 1) { youtubePlaybackIntent = true; resumePending = false; }
  else if (event.data === 0) youtubePlaybackIntent = false;
  else if (event.data === 2) {
    if (!resumePending && !(selected && resumeAfterLookup)) youtubePlaybackIntent = false;
    if (resumePending && !selected) youtube?.playVideo?.();
  }
}
function playbackWasRunning() {
  if (netflix) return !netflix.paused || resumePending;
  if (localMedia) return !localMedia.paused;
  const state = youtube?.getPlayerState?.();
  return state === 1 || (state === 3 && youtubePlaybackIntent);
}

function currentTime() {
  if (netflix) return netflix.time;
  return localMedia?.currentTime || youtube?.getCurrentTime?.() || 0;
}
function playing() {
  if (netflix) return !netflix.paused;
  return localMedia ? !localMedia.paused : youtube?.getPlayerState?.() === 1;
}
function pause() {
  resumePending = false;
  if (netflix) { netflix.paused = true; netflixCommand("pause"); return; }
  if (localMedia) localMedia.pause();
  else youtube?.pauseVideo?.();
}
function play() {
  subtitlePauseCue = null;
  if (netflix) { netflix.navigationCue = null; netflix.paused = false; netflixCommand("play"); return; }
  if (!localMedia) youtubePlaybackIntent = true;
  if (localMedia) localMedia.play().catch((e) => status(e.message, true));
  else youtube?.playVideo?.();
}
function seekTo(t) {
  subtitleBoundary.reset(); subtitlePauseCue = null;
  closeLookup();
  if (source) {
    positions[source.type + ":" + source.id] = Math.max(0, t);
    try { localStorage.setItem("immersed.positions", JSON.stringify(positions)); } catch {}
  }
  cueSeek = { index: cues.findIndex(c => c.start <= t + 0.02 && t < c.end), until: performance.now() + 1600, paused: !playing(), from: currentTime() };
  if (netflix) { netflix.navigationCue = netflix.paused && cueSeek.index >= 0 ? {index:cueSeek.index,cue:cues[cueSeek.index]} : null; netflix.time = Math.max(0, t); netflixCommand("seek", netflix.time); }
  else if (localMedia) localMedia.currentTime = Math.max(0, t);
  else youtube?.seekTo?.(Math.max(0, t), true);
  cueIndex = -1;
  void renderCue();
}
function stopMedia() {
  subtitleBoundary.reset(); subtitlePauseCue = null;
  speechProgress();
  void flushPlayback();
  clearTimeout(pollTimer);
  clearTimeout(hoverTimer);
  clearTimeout(leaveTimer);
  requestGeneration++;
  screenFrames.clear();
  cueSeek = null;
  renderGeneration++;
  pause();
  if (netflix) {
    window.webkit?.messageHandlers?.immersed?.postMessage({ action: "closeNetflix" });
    netflix = null; $("netflixBack").hidden = true; document.body.classList.remove("netflixError"); document.documentElement.classList.remove("netflixFocus"); document.body.classList.remove("netflixMode", "netflixFocus", "lookupOpen"); $("netflixOptions").hidden = true;
  }
  if (localMedia) {
    for (const event of [
      "timeupdate",
      "pause",
      "play",
      "ratechange",
      "seeked",
      "loadedmetadata",
    ])
      localMedia["on" + event] = null;
    localMedia.removeAttribute("src");
    localMedia.load();
  }
  youtube?.destroy?.();
  youtube = null;
  youtubePlaybackIntent = false;
  localMedia = null;
  source = null;
  cues = [];
  cueIndex = -1;
  renderedCue = null;
  closeLookup(false);
  $("chapters").hidden = true;

  coverageTokens = [];
  $("coverage").textContent = "";
  $("understanding").hidden = true;
  $("download").hidden = true;
  restoreFullscreenStudy();
  if (document.fullscreenElement) void document.exitFullscreen();
  $("video").replaceChildren();
  $("count").textContent = "Japanese subtitles";
  $("subtitles").textContent = "Preparing subtitles…";
}
function idFrom(input) {
  try {
    const u = new URL(input.trim());
    const id =
      u.hostname === "youtu.be"
        ? u.pathname.slice(1)
        : /^(?:www\.|m\.)?youtube\.com$/.test(u.hostname)
          ? u.searchParams.get("v") ||
            u.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1]
          : null;
    return /^[\w-]{11}$/.test(id || "") ? id : null;
  } catch {
    return null;
  }
}
function netflixCommand(command, value) {
  window.webkit?.messageHandlers?.immersed?.postMessage({ action: "netflixCommand", command, value: value ?? null });
}
function openNetflix(url = null, startAt = null) {
  if (!window.webkit?.messageHandlers?.immersed) {
    const body = showPanel("Netflix");
    body.append(el("p", "Open the immersed Mac app to use Netflix. Netflix needs an account and may restrict playback in embedded players."));
    return;
  }
  stopMedia(); closePanel(); showWatch();
  $("netflixRecovery").hidden = true; $("netflixBack").hidden = false; document.body.classList.remove("netflixError");
  netflix = { time: 0, paused: true, duration: 0, id: "", language: "", fullTrack: false, liveCue: null };
  const targetURL = ImmersedNetflix.netflixURL(url);
  if (targetURL && Number.isFinite(startAt) && startAt >= 0)
    netflix.contextReplay = { id: targetURL.split('/').at(-1), time: startAt };
  document.body.classList.add("netflixMode"); $("netflixOptions").hidden = false;
  $("netflixOriginal").checked = extras.netflixOriginal !== false;

  $("netflixStatus").textContent = "Sign in and choose a title. Select subtitles in Netflix’s Audio & Subtitles menu. Playback depends on Netflix’s embedded-player support.";
  $("count").textContent = "Original subtitles"; $("subtitles").textContent = "Choose subtitles in Netflix to begin.";
  window.webkit.messageHandlers.immersed.postMessage({ action: "openNetflix", url: targetURL });
}
window.openNetflix = openNetflix;
window.immersedNetflixEvent = data => {
  if (!netflix || !data || typeof data !== "object") return;
  if (data.event === "reset") {
    closeLookup(false); cues = []; cueIndex = -1; renderGeneration++; requestGeneration++;
    coverageTokens = []; updateCoverage();
    netflix.id = String(data.id || ""); netflix.fullTrack = false; netflix.liveCue = null; netflix.originalSent = false;
    netflix.visibleObserved = false; netflix.visibleCue = null; netflix.visibleIndex = -1; netflix.navigationCue = null;
    source = null; $("subtitles").textContent = "Choose subtitles in Netflix to begin.";
    $("count").textContent = "Original subtitles"; $("coverage").textContent = "";
  } else if (data.event === "state" && Number.isFinite(data.time)) {
    if (data.duration > 0 && !data.paused) { $("netflixRecovery").hidden = true; document.body.classList.remove("netflixError"); }
    if (!data.paused) netflix.navigationCue = null;
    netflix.time = Math.max(0, data.time); netflix.paused = Boolean(data.paused); netflix.duration = Number(data.duration) || 0;
    if (Number.isFinite(data.rate) && data.rate >= .5 && data.rate <= 2 && extras.playbackRate !== data.rate) {
      extras.playbackRate = data.rate; updateSpeedButton(); persist();
    }
    netflix.id = String(data.id || netflix.id);
    source = { type: "netflix", id: netflix.id, title: String(data.title || "Netflix") };
    if (!netflix.originalSent) { netflix.originalSent = true; netflixCommand("original", extras.netflixOriginal !== false); }
    if (netflix.contextReplay?.id === netflix.id && netflix.duration > 0) {
      const replay = netflix.contextReplay; netflix.contextReplay = null;
      seekTo(Math.min(replay.time, Math.max(0, netflix.duration - .05))); play();
    }
    // A delayed pause acknowledgement must not undo a hover-resume command.
    if (!netflix.paused) resumePending = false;
    void renderCue();
    if (!netflix.reportedAt || performance.now() - netflix.reportedAt > 1000) { netflix.reportedAt = performance.now(); playbackChanged(); }
  } else if (data.event === "cues" && Array.isArray(data.cues)) {
    closeLookup();
    requestGeneration++;
    cues = data.cues.slice(0, 30000).filter(c => typeof c.text === "string" && c.text.length <= 4000 && Number.isFinite(c.start) && c.start >= 0 && Number.isFinite(c.end) && c.end > c.start)
      .map(c => ({ start: c.start, end: c.end, text: c.text })).sort((a,b) => a.start-b.start || a.end-b.end);
    netflix.fullTrack = cues.length > 0; netflix.liveCue = null; netflix.language = String(data.language || "");
    transcriptKind = "netflix-original"; cueIndex = -1; renderGeneration++;
    $("count").textContent = "Original subtitles · " + cues.length + " segments";
    $("netflixStatus").textContent = data.label || (netflix.language ? "Original subtitles · " + netflix.language : "Original Netflix subtitles");
    if (netflix.visibleObserved) window.immersedNetflixEvent({ event: "line", text: netflix.visibleCue?.text || "", time: netflix.time });
    void renderCue(); void sampleCoverage();
  } else if (data.event === "line" && typeof data.text === "string" && Number.isFinite(data.time)) {
    if (data.id && data.id !== netflix.id) return;
    const text = data.text.slice(0,4000).trim(), at = Math.max(0, data.time);
    const normalized = value => value.replace(/\s/gu, '');
    let index = -1, distance = Infinity;
    if (text) for (let i=0; i<cues.length; i++) {
      if (normalized(cues[i].text) !== normalized(text)) continue;
      const delta = at < cues[i].start ? cues[i].start - at : at > cues[i].end ? at - cues[i].end : 0;
      if (delta < distance) { index=i; distance=delta; }
    }
    if (netflix.navigationCue && (text || Math.abs(at - netflix.navigationCue.cue.start) > .15)) netflix.navigationCue = null;
    netflix.visibleObserved = true; netflix.visibleIndex = distance < 20 ? index : -1;
    netflix.visibleCue = text ? { start: at, end: Infinity, text } : null;
    netflix.time = at; cueIndex = -1;
    if (netflix.fullTrack) { void renderCue(); return; }
    // If the player exposes only its current line, retain encountered blocks for
    // backward navigation. Never invent future words or transcribe its audio.
    if (netflix.liveCue) netflix.liveCue.end = Math.max(netflix.liveCue.start + .05, at);
    netflix.liveCue = null;
    if (text) {
      let cue = cues.find(c => c.text === text && c.start <= at && at < c.end);
      if (!cue) { cue = { start: at, end: at + 86400, text }; cues.push(cue); cues.sort((a,b)=>a.start-b.start); }
      netflix.liveCue = cue;
      netflix.visibleIndex = cues.indexOf(cue);
      $("netflixStatus").textContent = "Original Netflix subtitles · current lines";
      if (cues.length === 1 || cues.length % 10 === 0) void sampleCoverage();
    }
    cueIndex = -1; void renderCue();
  } else if (data.event === "error") {
    resumePending = false; netflix.paused = true;
    $("netflixStatus").textContent = String(data.message || "Netflix playback is unavailable.");
    $("netflixRecovery").hidden = false; document.body.classList.add("netflixError");
  }
};
$("netflixRetry").onclick = () => {
  $("netflixRecovery").hidden = true;
  $("netflixStatus").textContent = "Restarting Netflix playback…"; document.body.classList.remove("netflixError");
  window.webkit?.messageHandlers?.immersed?.postMessage({action:"netflixRepair"});
};
$("netflixSafari").onclick = () => window.webkit?.messageHandlers?.immersed?.postMessage({action:"netflixSafari"});
$("netflixButton").onclick = () => openNetflix();
$("netflixBrowse").onclick = () => openNetflix();
$("leaveNetflix").onclick = () => {
  stopMedia(); $("subtitles").textContent = "Choose a video or audiobook to begin.";
  $("video").append(el("div", "Open a YouTube video, local video or audiobook to begin.", "placeholder"));
  $("sourceBadge").textContent = "LOCAL STUDY"; status("Ready when you are");
};
$("netflixBack").onclick = $("leaveNetflix").onclick;
decorateButton($("netflixBack"), "Back to immersed", "close");
$("netflixOriginal").onchange = () => { extras.netflixOriginal = $("netflixOriginal").checked; persist(); netflixCommand("original", extras.netflixOriginal); };
$("netflixSubtitles").onclick = () => netflixCommand("subtitles");
window.immersedNetflixFullscreen = enabled => {
  document.body.classList.toggle("netflixFocus", Boolean(enabled));
  document.documentElement.classList.toggle("netflixFocus", Boolean(enabled));
  if (!enabled) document.body.classList.remove("lookupOpen");
  requestAnimationFrame(positionLookup);
};
function loadYouTubeAPI() {
  if (window.YT?.Player) return Promise.resolve();
  if (youtubeReady) return youtubeReady;
  youtubeReady = new Promise((resolve, reject) => {
    window.onYouTubeIframeAPIReady = resolve;
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      youtubeReady = null;
      reject(
        Error("YouTube is unavailable. Imported media still works offline."),
      );
    };
    document.head.append(script);
  });
  return youtubeReady;
}
async function loadVideo(id, title, startAt = null) {
  showWatch();
  stopMedia();
  source = { type: "youtube", id, title: title || id };
  const generation = requestGeneration;
  status("Checking original language…");
  try {
    const info = await api("desktop/video-info", { videoId: id });
    if (generation !== requestGeneration) return;
    if (extras.originalOnly && info.language !== "ja") {
      status(
        "This video’s original language is not confirmed as Japanese. Change “Original Japanese only” in Settings to open it.",
        true,
      );
      return;
    }
    if (prefs.hideShorts && info.isShort) {
      status("Shorts are hidden in Settings.", true);
      return;
    }
    if (info.duration < prefs.minimumMinutes * 60) {
      status("This video is shorter than your minimum-length setting.", true);
      return;
    }
    source.title = info.title || source.title;
  } catch (error) {
    if (generation !== requestGeneration) return;
    if (extras.originalOnly) {
      status(
        "Original language could not be checked. Try again, or turn off “Original Japanese only” in Settings.",
        true,
      );
      return;
    }
  }
  $("sourceBadge").textContent = "YOUTUBE";
  $("download").hidden = false;
  $("download").disabled = false;
  $("downloadLabel").textContent = "Save offline";
  $("download").onclick = download;
  if (idFrom($("query").value) === id) $("query").value = "";
  status("Loading YouTube…");
  const target = el("div");
  target.id = "player";
  $("video").append(target);
  try {
    await loadYouTubeAPI();
    if (generation !== requestGeneration) return;
    youtube = new YT.Player("player", {
      videoId: id,
      playerVars: {
        playsinline: 1,
        cc_load_policy: 0,
        fs: 0,
        start: Math.max(0, Math.floor(startAt ?? positions["youtube:" + id] ?? 0)),
        autoplay: 0,
        origin: location.origin,
      },
      events: {
        onStateChange: handleYouTubeState,
        onPlaybackRateChange: event => {
          extras.playbackRate = event.data; updateSpeedButton(); persist();
        },
        onReady: () => {
          youtube.setPlaybackRate(Number(extras.playbackRate || 1));
          void beginTranscript();
        },
        onError: (e) =>
          status(
            "YouTube playback failed (" +
              e.data +
              "). Some videos restrict embedding or access.",
            true,
          ),
      },
    });
  } catch (e) {
    status(e.message, true);
  }
}
async function refreshLibrary() {
  library = (await api("desktop/library")).items;
  return library;
}
let localWindow = -1,
  prefetchedWindow = -1,
  progressWrite = 0;
function updateChapter() {
  if (!source?.chapters?.length) return;
  const index = source.chapters.findLastIndex((c) => c.start <= currentTime());
  if (index >= 0) $("chapterSelect").selectedIndex = index;
}
async function flushPlayback() {
  if (source?.type === "youtube") {
    positions["youtube:" + source.id] = currentTime();
    try { localStorage.setItem("immersed.positions", JSON.stringify(positions)); } catch {}
    return;
  }

  if (!source) return;
  const position = currentTime();
  positions[source.type + ":" + source.id] = position;
  try {
    localStorage.setItem("immersed.positions", JSON.stringify(positions));
  } catch {}
  if (source.type !== "local" || !localMedia || localMedia.readyState < 1)
    return;
  const id = source.id,
    rate = localMedia.playbackRate;
  const response = await fetch(
    "/api/desktop/progress?id=" + encodeURIComponent(id),
    {
      method: "PUT",
      headers: { "X-Immersed-Request": "1" },
      body: JSON.stringify({ position, rate }),
      keepalive: true,
    },
  ).catch(() => null);
  if (!response?.ok)
    status(
      "Listening position could not be saved. Keep this window open and try again.",
      true,
    );
}
window.flushPlayback = flushPlayback;
window.immersedPlayback = (action, value) => {
  if (["play", "pause", "toggle"].includes(action)) {
    resumePending = false;
    resumeAfterLookup = false;
    closeLookup(false);
  }
  if (action === "play") play();
  else if (action === "pause") pause();
  else if (action === "toggle") playing() ? pause() : play();
  else if (action === "seek") seekTo(value);
  else if (action === "skip") skip(value < 0 ? -1 : 1);
  else if (action === "word") navigateWord(value < 0 ? -1 : 1);
  else if (action === "replay") replaySubtitle();
};
function playbackChanged(force = false) {
  if (localMedia && extras.playbackRate !== localMedia.playbackRate) {
    extras.playbackRate = localMedia.playbackRate; updateSpeedButton(); persist();
  }
  updateChapter();
  window.webkit?.messageHandlers?.immersed?.postMessage({
    action: "playback",
    title: source?.title || "",
    position: currentTime(),
    duration: netflix?.duration || localMedia?.duration || 0,
    rate: localMedia?.playbackRate || 1,
    playing: playing(),
  });
  if (force || Date.now() - progressWrite > 5000) {
    progressWrite = Date.now();
    void flushPlayback();
  }
  if (
    source?.type === "local" &&
    transcriptKind !== "human" &&
    source.duration > 600 &&
    localMedia?.readyState >= 1
  ) {
    const minute = Math.floor(currentTime() / 60);
    if (minute !== localWindow) {
      localWindow = minute;
      requestGeneration++;
      clearTimeout(pollTimer);
      void beginTranscript();
    } else if (
      playing() &&
      currentTime() % 60 > 2 &&
      prefetchedWindow !== minute + 1 &&
      (minute + 1) * 60 < source.duration
    ) {
      prefetchedWindow = minute + 1;
      void api(
        "desktop/local-transcript",
        { id: source.id, quality: extras.speechQuality, at: (minute + 1) * 60 },
        "POST",
      ).catch(() => {});
    }
  }
}
document.addEventListener("visibilitychange", () => void flushPlayback());
window.addEventListener("pagehide", () => void flushPlayback());
async function openLocal(id, time = null) {
  showWatch();
  const item = (await refreshLibrary()).find((x) => x.id === id);
  if (!item) throw Error("This media is no longer in the library.");
  stopMedia();
  source = {
    type: "local",
    id,
    title: item.title,
    duration: item.duration,
    chapters: item.chapters,
  };
  localWindow = -1;
  prefetchedWindow = -1;
  $("sourceBadge").textContent =
    item.kind === "audio" ? "AUDIOBOOK / AUDIO" : "LOCAL VIDEO";
  const media = document.createElement(
    item.kind === "audio" ? "audio" : "video",
  );
  media.controls = true;
  media.preload = "metadata";
  media.src = "/api/desktop/media?id=" + encodeURIComponent(id);
  media.playbackRate = item.progress?.rate || Number(extras.playbackRate || 1);
  extras.playbackRate = media.playbackRate;
  updateSpeedButton();
  media.onloadedmetadata = () => {
    const resume =
      time ?? item.progress?.position ?? positions["local:" + id] ?? 0;
    if (resume && resume < media.duration - 1) media.currentTime = resume;
    localWindow = Math.floor(media.currentTime / 60);
    playbackChanged(true);
    void beginTranscript();
  };
  media.ontimeupdate = () => playbackChanged();
  media.onpause =
    media.onplay =
    media.onratechange =
      () => playbackChanged(true);
  media.onseeked = () => {
    cueIndex = -1;
    void renderCue();
    playbackChanged(true);
  };
  media.onerror = () =>
    status(
      "This codec could not be played. Try an H.264/AAC MP4 or AAC M4B/M4A file.",
      true,
    );
  if (item.kind === "audio") {
    const box = el("div", null, "audioBook");
    const cover = el("img", null, "bookCover"),
      background = el("img", null, "bookBackdrop");
    cover.alt = "Audiobook cover";
    background.alt = "";
    cover.src = background.src =
      "/api/desktop/artwork?id=" + encodeURIComponent(id);
    cover.onerror = () => {
      cover.remove();
      background.remove();
    };
    box.append(background, cover);
    box.append(
      el("h2", item.title),
      el(
        "p",
        "Local Japanese listening · " + formatDuration(item.duration),
        "hint",
      ),
      media,
    );
    $("video").append(box);
  } else $("video").append(media);
  localMedia = media;
  if (item.chapters?.length) {
    $("chapters").hidden = false;
    $("chapterSelect").replaceChildren(
      ...item.chapters.map((c) => {
        const option = el("option", c.title);
        option.value = c.start;
        return option;
      }),
    );
    $("chapterSelect").onchange = () =>
      seekTo(Number($("chapterSelect").value));
  }
  closePanel();
}
window.openLocalMedia = (id, time = null) =>
  openLocal(id, time).catch((e) => status(e.message, true));
window.loadVideo = loadVideo;
const subtitleRetries = new Map();
function recoverSubtitles(generation) {
  if (!source || source.type === "netflix" || generation !== requestGeneration) return;
  const key = [
    source.type,
    source.id,
    extras.speechQuality,
    source.type === "local" ? Math.floor(currentTime() / 60) : "track",
  ].join(":");
  const attempt = subtitleRetries.get(key) || 0;
  if (attempt >= 2) return;
  subtitleRetries.set(key, attempt + 1);
  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    if (generation === requestGeneration) void beginTranscript(true);
  }, [2000, 5000][attempt]);
}
async function beginTranscript(retry = false) {
  if (!source || !["youtube", "local"].includes(source.type)) return;
  const generation = requestGeneration;
  const params =
    source.type === "local"
      ? { id: source.id, quality: extras.speechQuality, at: currentTime() }
      : { videoId: source.id, quality: extras.speechQuality, at: currentTime() };
  if (retry) params.retry = "true";
  const route =
    source.type === "local" ? "desktop/local-transcript" : "desktop/transcribe";

  status("Preparing Japanese subtitles…");
  speechProgress({ status: "processing" });
  try {
    await api(route, params, "POST");
    if (generation !== requestGeneration) return;
    pollTranscript(route, params, generation);
  } catch (e) {
    if (generation === requestGeneration) {
      status(e.message, true);
      recoverSubtitles(generation);
    }
  }
}
async function pollTranscript(route, params, generation) {
  if (generation !== requestGeneration) return;
  try {
    const at = currentTime();
    const moved = source?.type === "youtube" && Math.abs(at - params.at) >= 5;
    if (moved) params.at = at;
    const data = await api(route, params, moved ? "PUT" : "GET");
    if (generation !== requestGeneration) return;
    if (Array.isArray(data.cues) && (data.cues.length || data.windowed)) {
      const previous = JSON.stringify(cues[cueIndex]);
      transcriptKind = data.source || "generated";
      cues = transcriptKind === "human" ? data.cues : ImmersedReadingCues.apply(data.cues.map(restoredScreenCaption), readingJoins);
      const active = cues.findLastIndex(
        (c) => c.start <= currentTime() && currentTime() < c.end,
      );
      if (JSON.stringify(cues[active]) !== previous) {
        cueIndex = -1;
        renderGeneration++;
      } else cueIndex = active;
      if (!cues.length) $("subtitles").textContent = "";

      void renderCue();
      $("count").textContent =
        (data.windowed
          ? "Current section · "
          : data.status === "ready"
            ? ""
            : "Preparing · ") +
        cues.length +
        " segments";
    }
    speechProgress(data);
    if (data.status === "ready") {
      status("");

      void sampleCoverage();
      return;
    }
    if (data.status === "paused") {
      await api(route, params, "POST");
      if (generation === requestGeneration) pollTimer = setTimeout(() => pollTranscript(route, params, generation), 350);
      return;
    }
    if (data.status === "unavailable") {
      status(data.message || "Speech recognition failed.", true);
      if (data.canRetry !== false) recoverSubtitles(generation);

      return;
    }
    status(
      (data.stage || "Preparing subtitles") +
        (data.duration && data.phase !== "loading"
          ? " · " +
            Math.round((100 * (data.processedSeconds || 0)) / data.duration) +
            "%"
          : ""),
    );
    pollTimer = setTimeout(
      () => pollTranscript(route, params, generation),
      cues.some((c) => c.start <= currentTime() && currentTime() < c.end)
        ? 1500
        : 350,
    );
  } catch (e) {
    if (generation === requestGeneration) {
      status(e.message, true);
      recoverSubtitles(generation);
    }
  }
}
const readingJoins = new Map(), readingPending = new Set(), readingWindows = new Map();
function refineNearCue(index) {
  if (netflix || transcriptKind === "human") return; // Preserve original subtitle boundaries/text.
  const batch=cues.slice(Math.max(0,index-3),Math.min(cues.length,index+4));
  if(batch.length<2)return;
  const windowKey=ImmersedReadingCues.groupKey(batch),generation=requestGeneration;
  if(readingWindows.has(windowKey)||readingPending.has(windowKey))return;
  readingPending.add(windowKey);
  void api("immersion/reflow",{},"POST",JSON.stringify({cues:batch,reading:true})).then(data=>{
    if(!Array.isArray(data.cues))return;
    let offset=0;const joins=[];
    for(const fixed of data.cues){
      const start=offset;let text="";
      while(offset<batch.length && text.length<fixed.text?.length)text+=batch[offset++].text;
      const group=batch.slice(start,offset);
      if(!group.length||fixed.text!==text||fixed.start!==group[0].start||fixed.end!==group.at(-1).end)return;
      if(group.length>1){if(!ImmersedReadingCues.candidateGroup(group))return;joins.push(ImmersedReadingCues.groupKey(group));}
    }
    if(offset!==batch.length)return;
    cacheSet(readingWindows,windowKey,true,600);
    for(const key of joins)cacheSet(readingJoins,key,true,600);
    if(joins.length&&generation===requestGeneration&&!selected){cues=ImmersedReadingCues.apply(cues,readingJoins);cueIndex=-1;void renderCue();}
  }).catch(()=>{}).finally(()=>readingPending.delete(windowKey));
}

function bindJapanesePunctuation(line) {
  const unitFor = node => {
    if (node.matches(".wordUnit")) return node;
    const unit=el("span",null,"wordUnit");node.replaceWith(unit);unit.append(node);return unit;
  };
  for (const node of [...line.childNodes]) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const close=node.textContent.match(/^[、。，．？！!?：；:;）］｝〕〉》」』】〙〗〟’”]+/u);
    const previous=node.previousSibling;
    if (close && previous?.nodeType===Node.ELEMENT_NODE && previous.matches(".word, .wordUnit")) {
      unitFor(previous).append(document.createTextNode(close[0]));node.textContent=node.textContent.slice(close[0].length);
    }
    const open=node.textContent.match(/[（［｛〔〈《「『【〘〖〝‘“]+$/u), next=node.nextSibling;
    if(open && next?.nodeType===Node.ELEMENT_NODE && next.matches(".word, .wordUnit")) {
      node.textContent=node.textContent.slice(0,-open[0].length);unitFor(next).prepend(document.createTextNode(open[0]));
    }
  }
}
const captionGraphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
async function renderCue() {
  if (selected && lookupAnchor && lookupCue && (currentTime() < lookupCue.start - .5 || currentTime() > lookupCue.end + .5)) closeLookup();
  if (!cues.length && !netflix?.visibleCue) {
    if (lookupAnchor) closeLookup();
    renderGeneration++;
    cueIndex = -1;
    if (source) $("subtitles").textContent = "";
    return;
  }
  const t = currentTime();
  let i = cueIndex >= 0 && cues[cueIndex]?.start <= t && t < cues[cueIndex]?.end && (!cues[cueIndex + 1] || cues[cueIndex + 1].start > t) ? cueIndex : cues.findLastIndex((c) => c.start <= t && t < c.end);
  if (i < 0 && !netflix) i = ImmersedSubtitlePlayback.readableIndex(cues, t, extras.playbackRate);
  let cue = cues[i];
  if (netflix?.visibleObserved) { i = netflix.visibleIndex ?? -1; cue = netflix.visibleCue; }
  if (netflix?.paused && netflix.navigationCue) { i = netflix.navigationCue.index; cue = netflix.navigationCue.cue; }
  if (cueSeek) {
    if (i === cueSeek.index || (performance.now() > cueSeek.until && !(cueSeek.paused && !playing() && Math.abs(t - cueSeek.from) < .1))) cueSeek = null;
    else if (!netflix?.visibleObserved) { i = cueSeek.index; cue = cues[i]; }
  }
  if (subtitlePauseCue && !playing()) { cue = subtitlePauseCue; i = cues.indexOf(cue); }
  if (i === cueIndex && renderedCue?.text === cue?.text && renderedCue?.start === cue?.start && renderedCue?.end === cue?.end) { if (!cue && $("subtitles").hasChildNodes()) $("subtitles").replaceChildren(); return; }
  if (lookupAnchor) closeLookup();
  cueIndex = i;
  renderedCue = cue || null;
  const generation = ++renderGeneration;
  if (!cue) {
    $("subtitles").textContent = "";
    return;
  }
  refineNearCue(i);
  const text = cue.text;
  $("subtitles").textContent = text;
  let tokens;
  try {
    tokens = await analyze(text);
  } catch {
    if (generation === renderGeneration)
      status(
        "The local dictionary is unavailable; subtitle text is preserved.",
        true,
      );
    return;
  }
  if (generation !== renderGeneration) return;
  const line = el(
    "div",
    null,
    "line" + (cue.uncertain ? " uncertain" : ""),
  );
  const boundaries = new Set([text.length]);
  for (const { index } of captionGraphemes.segment(text)) boundaries.add(index);
  let offset = 0;
  for (const token of tokens) {
    if (!boundaries.has(token.start) || !boundaries.has(token.end) ||
        token.start < offset || token.end <= token.start ||
        text.slice(token.start, token.end) !== token.text) continue;
    if (token.start > offset)
      line.append(document.createTextNode(text.slice(offset, token.start)));
    offset = token.end;
    if (!token.word) {
      line.append(document.createTextNode(token.text));
      continue;
    }
    const unknown = familiarity(token) !== "ignored" && ImmersedLearning.shouldHighlightToken(
        levels,
        token,
        prefs.level,
        prefs.knowledge,
      ),
      button = el("button", null, "word" + (unknown ? " unknown" : ""));
    button.setAttribute("aria-label", "Look up " + token.text);
    if (
      prefs.readings &&
      unknown &&
      /[一-龯]/.test(token.text) &&
      token.reading
    ) {
      const ruby = el("ruby", token.text);
      ruby.append(el("rt", token.reading));
      button.append(ruby);
    } else button.textContent = token.text;
    wordTokens.set(button, token);
    button.dataset.lemma = token.lemma; button.dataset.wordState = extras.wordStates[token.lemma] || familiarity(token);
    button.onclick = () => openLookup(token, false, button);
    button.onmouseenter = () => {
      clearTimeout(leaveTimer); leaveTimer = null;
      clearTimeout(hoverTimer);
      if (extras.hoverLookup && performance.now() >= hoverCooldownUntil)
        hoverTimer = setTimeout(() => openLookup(token, false, button), selected ? 35 : 65);
    };
    button.onmouseleave = () => {
      clearTimeout(hoverTimer);
      scheduleLookupLeave();
    };
    line.append(button);
  }
  if (offset < text.length)
    line.append(document.createTextNode(text.slice(offset)));
  bindJapanesePunctuation(line);
  $("subtitles").replaceChildren(line);
  const next = cues[i + 1]?.text;
  if (next && !pendingAnalysis.size) void analyze(next).catch(() => {});
}
function positionLookup() {
  const card = $("lookup");
  if (!card.classList.contains("show")) return;
  const viewport = window.visualViewport;
  const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
  const right = x + (viewport?.width ?? innerWidth);
  const bottom = y + (viewport?.height ?? innerHeight);
  const panel = document.querySelector(".youtubeFullscreen .fullscreenStudy")?.getBoundingClientRect();
  const leftEdge = Math.max(x, panel?.left ?? x) + 12;
  const rightEdge = Math.min(right, panel?.right ?? right) - 12;
  const topEdge = y + 12, bottomEdge = bottom - 12;
  const width = Math.max(1, Math.min(440, rightEdge - leftEdge));
  const fullscreen = document.fullscreenElement || document.body.classList.contains("netflixFocus");
  const anchor = lookupAnchor?.isConnected ? lookupAnchor : selected?.start != null ? $("subtitles") : null;
  const rect = anchor?.getBoundingClientRect();
  const above = rect ? rect.top - topEdge - 8 : 0;
  const below = rect ? bottomEdge - rect.bottom - 8 : 0;
  const placeAbove = fullscreen ? above >= 240 || above > below : below < 260 && above > below;
  const room = placeAbove ? above : below;
  const maxHeight = Math.max(1, Math.min(480, bottomEdge - topEdge, room >= 120 ? room : Infinity));
  card.style.width = width + "px";
  card.style.maxHeight = maxHeight + "px";
  const height = card.getBoundingClientRect().height;
  const left = rect ? rect.left - 12 : (leftEdge + rightEdge - width) / 2;
  const top = rect ? placeAbove ? rect.top - height - 8 : rect.bottom + 8 : (topEdge + bottomEdge - height) / 2;
  card.style.left = Math.max(leftEdge, Math.min(rightEdge - width, left)) + "px";
  card.style.top = Math.max(topEdge, Math.min(bottomEdge - height, top)) + "px";
}
new ResizeObserver(() => positionLookup()).observe($("lookup"));
window.addEventListener("resize", positionLookup);
document.addEventListener("scroll", () => { if (selected) positionLookup(); }, true);
window.visualViewport?.addEventListener("resize", positionLookup);
window.visualViewport?.addEventListener("scroll", positionLookup);
window.addEventListener("blur", () => { if (selected && !lookupPinned) closeLookup(); });
function scheduleLookupLeave() {
  clearTimeout(hoverTimer);
  if (!selected || lookupPinned || leaveTimer) return;
  leaveTimer = setTimeout(() => { leaveTimer = null; closeLookup(); }, 200);
}
document.addEventListener("pointermove", event => {
  if (!selected || lookupPinned) return;
  if (event.target.closest?.(".word, #lookup")) { clearTimeout(leaveTimer); leaveTimer = null; }
  else scheduleLookupLeave();
});
document.addEventListener("pointerout", event => { if (!event.relatedTarget) scheduleLookupLeave(); });
document.addEventListener("focusin", event => { if (selected && !lookupPinned && !event.target.closest?.("#lookup, .word")) closeLookup(); });
document.documentElement.addEventListener("mouseleave", scheduleLookupLeave);
function closeLookup(resume = true) {
  clearTimeout(hoverTimer);
  clearTimeout(leaveTimer); leaveTimer = null;
  $("lookup").classList.remove("show");
  selected = null;
  lookupRevision++;
  if (netflix && document.body.classList.contains("netflixFocus")) {
    document.body.classList.remove("lookupOpen");
    window.webkit?.messageHandlers?.immersed?.postMessage({ action: "netflixLookup", open: false });
  }
  lookupCue = null;
  lookupAnchor = null;
  lookupPinned = false;
  if (netflix?.hoverSession != null) {
    const id = netflix.hoverSession; netflix.hoverSession = null; resumePending = false;
    netflixCommand(resume ? 'hoverEnd' : 'hoverCancel', id);
  } else if (resume && resumeAfterLookup) {
    resumePending = !localMedia;
    play();
  }
  resumeAfterLookup = false;
  if (!netflix) cues = ImmersedReadingCues.apply(cues, readingJoins);
  cueIndex = -1;
  for (const cue of cues) if (cue.screenText && cue.text !== cue.screenText) { cue.text = cue.screenText; cueIndex = -1; }
}
function pauseForLookup() {
  if (!netflix) { pause(); return; }
  resumePending = false;
  if (netflix.hoverSession == null) netflix.hoverSession = ++hoverSequence;
  netflixCommand('hoverStart', netflix.hoverSession);
}
const wordTokens = new WeakMap();
function navigateWord(direction) {
  const words = [...$("subtitles").querySelectorAll(".word")];
  const index = words.indexOf(lookupAnchor);
  const target = words[index < 0 ? (direction < 0 ? words.length - 1 : 0) : index + direction];
  if (target) void openLookup(wordTokens.get(target), lookupPinned, target);
}
function updateWordNavigation() {
  const words = [...$("subtitles").querySelectorAll(".word")], index = words.indexOf(lookupAnchor);
  $("previousWord").disabled = index <= 0;
  $("nextWord").disabled = index < 0 || index >= words.length - 1;
}
for (const [id, direction, icon] of [["previousWord", -1, "previous"], ["nextWord", 1, "next"]]) {
  decorateButton($(id), direction < 0 ? "Previous word" : "Next word", icon);
  $(id).setAttribute("aria-keyshortcuts", direction < 0 ? "Alt+ArrowLeft" : "Alt+ArrowRight");
  $(id).onclick = () => navigateWord(direction);
}
async function openLookup(token, pinned = false, anchor = null) {
  if (!token || (anchor && !anchor.isConnected)) return;
  clearTimeout(hoverTimer);
  lookupAnchor = anchor || lookupAnchor;
  clearTimeout(leaveTimer); leaveTimer = null;
  if (selected === token) { positionLookup(); return; }
  if (!selected) {
    resumeAfterLookup = resumePending || playbackWasRunning();
    if (pinned || extras.pauseOnHover) pauseForLookup();
    else resumeAfterLookup = false;
  }
  if (pinned && playing()) {
    resumeAfterLookup = true;
    pauseForLookup();
  }
  lookupPinned = pinned;
  selected = token;
  const revision = ++lookupRevision;
  $("phraseMeaning").hidden = true;
  $("learningFeedback").hidden = true;
  lookupCue = renderedCue || cues[cueIndex];
  if (netflix && document.body.classList.contains("netflixFocus")) {
    document.body.classList.add("lookupOpen");
    window.webkit?.messageHandlers?.immersed?.postMessage({ action: "netflixLookup", open: true });
  }
  decorateButton($("saveWord"), "Save word", "save");
  lookupEntries = [];
  lookupMeaning = "";
  $("saveWord").disabled = true;
  $("phraseMeaning").hidden = true;
  $("phraseMeaning").replaceChildren();
  $("lookup").classList.add("show");
  positionLookup();
  updateWordNavigation();
  $("lookupWord").textContent = token.text;
  $("reading").textContent = token.reading || "";
  $("grammar").hidden = !extras.dictionaryDetails;
  $("grammar").textContent = [
    token.lemma !== token.text ? token.lemma : "",
    ...(token.grammar || []),
  ]
    .filter(Boolean)
    .join(" · ");
  $("definitions").textContent = "Looking up…";
  $("alternatives").replaceChildren();
  $("contextMeaning").hidden = true;
  $("contextMeaning").replaceChildren();
  updateKnown();
  const caption = lookupCue;
  if (caption && token.start != null) {
    const context = {
      word: token.text,
      lemma: token.lemma,
      reading: token.reading || "",
      pos: token.pos || "",
      sentence: caption.text,
      start: String(token.start),
      end: String(token.end),
      before: cues.slice(Math.max(0, cueIndex - 3), cueIndex).map(c => c.text).join(" ").slice(-240),
      after: cues.slice(cueIndex + 1, cueIndex + 9).map(c => c.text).join(" ").slice(0, 240),
    };
    void api("immersion/phrase-context", context).then(data => {
      if (revision !== lookupRevision || !data.phrases?.length) return;
      const phrase = data.phrases[0], gloss = phrase.definitions?.[0] || phrase.senses[0]?.english_definitions.join("; ");
      if (!gloss) return;
      lookupMeaning = phrase.form + ": " + gloss;
      $("phraseMeaning").replaceChildren(el("small", "Expression", "hint"), el("strong", phrase.form), el("p", gloss));
      $("phraseMeaning").hidden = false;
    }).catch(() => {});
    setTimeout(() => {
      if (revision === lookupRevision) void explainContext(revision, context);
    }, 120);

  }
  try {
    const data = await dictionaryFor(token);
    if (revision !== lookupRevision) return;
    lookupEntries = data.data || [];
    $("saveWord").disabled = !lookupEntries.length;
    renderDefinitions();
    recordLookup();

  } catch (e) {
    if (revision === lookupRevision) $("definitions").textContent = e.message;
  }
}
const contextCache = new Map(), pendingContext = new Map();
async function contextFor(context) {
  const key=JSON.stringify(context);
  if(contextCache.has(key)) return contextCache.get(key);
  if(!pendingContext.has(key)) pendingContext.set(key,api("immersion/context-meaning",context).then(value=>{
    if(["ready","unclear"].includes(value.status)) cacheSet(contextCache,key,value,200);
    return value;
  }).finally(()=>pendingContext.delete(key)));
  return pendingContext.get(key);
}
async function explainContext(revision, context, attempts = 0) {
  try {
    const result = await contextFor(context);
    if (revision !== lookupRevision) return;
    const box = $("contextMeaning");
    if (result.status === "ready") {
      box.replaceChildren(
        el("small", "Meaning in context", "hint"),
        el("strong", result.gloss),

      );
      box.hidden = false;
      if (!lookupMeaning) lookupMeaning = result.gloss;
    } else if (["preparing", "busy"].includes(result.status) && attempts < 30) {
      box.textContent = result.status === "preparing"
        ? "Setting up on-device context explanations…"
        : "Reading the sentence…";
      box.hidden = false;
      setTimeout(() => {
        if (revision === lookupRevision) void explainContext(revision, context, attempts + 1);
      }, result.status === "busy" ? 500 : 2000);
    } else box.hidden = true;
  } catch { /* Definitions remain available when the optional model is offline. */ }
}
function renderDefinitions() {
  $("definitions").replaceChildren();
  if (!lookupEntries.length) {
    $("definitions").textContent = /^[ァ-ヿ]$/u.test(selected?.lemma || "")
      ? "No reliable word match. This subtitle may be misheard; replay the line to check the audio."
      : "No dictionary entry found.";
    return;
  }
  const seenEntries = new Set();
  for (const entry of lookupEntries.slice(0, 4)) {
    const signature = JSON.stringify([entry.japanese, entry.definitions || entry.senses]);
    if (seenEntries.has(signature)) continue;
    seenEntries.add(signature);
    const box = el("div", null, "dictionaryEntry");
    const form =
      entry.japanese?.find((j) => j.word === entry.matchedForm) ||
      entry.japanese?.[0];
    if (form && ![selected?.text, selected?.lemma].includes(form.word))
      box.append(
        el("strong", [form.word, form.reading].filter(Boolean).join(" · ")),
      );
    if (entry.matchedBy === "reading")
      box.append(
        el(
          "small",
          "Matched by reading · verify the subtitle spelling",
          "hint",
        ),
      );
    else if (entry.matchedBy === "inflection" && entry.matchedForm !== selected?.lemma)
      box.append(el("small", "Dictionary form: " + entry.matchedForm, "hint"));
    if (prefs.pitchAccent && entry.pitch?.length) {
      const accents = el("div", null, "pitch");
      for (const a of entry.pitch.slice(0, 5)) {
        const pattern = el("span");
        const morae =
          a.reading.match(
            /[ぁ-ゖァ-ヺー][ゃゅょぁぃぅぇぉャュョァィゥェォ]?/g,
          ) || [];
        if (a.downstep < 0 || a.downstep > morae.length) continue;
        morae.forEach((m, i) => {
          const high =
              a.downstep === 1
                ? i === 0
                : i > 0 && (a.downstep === 0 || i < a.downstep),
            letter = el("span", m);
          letter.style[high ? "borderTop" : "borderBottom"] = "1px solid";
          if (high && i + 1 === a.downstep)
            letter.style.borderRight = "1px solid";
          pattern.append(letter);
        });
        pattern.append(document.createTextNode(" [" + a.downstep + "]"));
        accents.append(pattern);
      }
      box.append(accents);
    }
    const senses = entry.definitions?.length
      ? entry.definitions.map((text, index) => ({ english_definitions: [text], parts_of_speech: entry.senses?.[index]?.parts_of_speech || [] }))
      : entry.senses || [];
    const meaning = (sense) => {
      const row = el("div", null, "dictionarySense");
      if (extras.dictionaryDetails && sense.parts_of_speech?.length)
        row.append(el("small", sense.parts_of_speech.join(" · "), "hint"));
      row.append(el("p", sense.english_definitions.join("; ")));
      return row;
    };
    const unique = senses.filter((sense, i) => senses.findIndex(other => other.english_definitions.join("; ") === sense.english_definitions.join("; ")) === i);
    for (const sense of unique.slice(0, 3)) box.append(meaning(sense));
    if (unique.length > 3) {
      const more = el("details");
      more.append(el("summary", "More meanings (" + (unique.length - 3) + ")"));
      for (const sense of unique.slice(3)) more.append(meaning(sense));
      box.append(more);
    }
    if (entry.source) box.append(el("small", [entry.source, entry.dictionaryVersion, entry.dictionaryLanguage === "de" ? "Deutsch" : entry.dictionaryLanguage === "en" ? "English" : ""].filter(Boolean).join(" · "), "hint"));
    $("definitions").append(box);
  }
}
function updateKnown() {
  if (!selected) return;
  decorateButton($("known"), familiarity(selected) === "known" ? "Mark unknown" : "Mark known", "check");
  const active = extras.wordStates[selected.lemma] || familiarity(selected);
  for (const item of $("wordStates").children) item.setAttribute("aria-pressed", String(item.dataset.state === active));
}
function setWordState(state) {
  if (!selected || !Object.values(wordStates).includes(state)) return;
  const lemma = selected.lemma, wasKnown = prefs.knowledge[selected.lemma] === true;
  extras.wordStates[lemma] = state;
  if (state === 'ignored') delete prefs.knowledge[lemma];
  else prefs.knowledge[lemma] = state === 'known';
  persist(); updateKnown(); updateCoverage();
  $("learningFeedback").hidden = state !== "known" || wasKnown;
  if (state === "known" && !wasKnown) {
    const count = Object.values(prefs.knowledge).filter(value => value === true).length;
    $("learningFeedback").textContent = count % 10 === 0 ? count + " words marked known" : "+1 word marked known";
  }
  for (const node of $("subtitles").querySelectorAll('.word')) if (node.dataset.lemma === lemma) {
    node.classList.toggle('unknown', state !== 'ignored' && state !== 'known'); node.dataset.wordState = state;
  }
  // Keep the hovered node and popup stable; redraw after lookup closes.
  cueIndex = -1;
}
for (const [key,state] of Object.entries(wordStates)) {
  const item = button('', () => setWordState(state)); item.dataset.state = state;
  item.setAttribute('aria-label','Mark '+state); item.title = stateLabel(state)+' · '+key;
  item.append(el('kbd',key),el('span',stateLabel(state))); $("wordStates").append(item);
}
window.immersedWordShortcut = key => { if (!selected) return false; const state=wordStates[key]; if (!state) return false; setWordState(state); return true; };

function lookupWordRecord() {
  if (!selected || !lookupEntries[0]) return null;
  const entry = lookupEntries[0], j = entry.japanese?.[0] || {},
    hasContext = selected.start !== undefined && source;
  return { key: (entry.slug || selected.lemma) + ":" + (j.reading || ""),
    lemma: selected.lemma,
    word: j.word || selected.lemma, reading: j.reading || selected.reading || "",
    meaning: entry.definitions?.[0] || lookupMeaning || entry.senses?.[0]?.english_definitions?.join("; ") || "",
    sentence: hasContext ? lookupCue?.text || "" : "", title: hasContext ? source.title : "",
url: hasContext ? source.type === "local" ? "local:" + source.id : source.type === "netflix" ? "https://www.netflix.com/watch/" + source.id : "https://www.youtube.com/watch?v=" + source.id : "",
    time: hasContext ? (Number.isFinite(lookupCue?.start) ? lookupCue.start : currentTime()) : 0 };
}
function recordLookup() {
  const word = lookupWordRecord();
  if (!word) return;
  recentWords = ImmersedWordHistory.record(recentWords, word);
  persist();
}
function saveWord() {
  const word = lookupWordRecord();
  if (!word) return;
  const old = saved.find(w => w.key === word.key);
  const recent = recentWords.find(w => w.key === word.key);
  const context = !word.url && recent?.url ? { url: recent.url, time: recent.time, sentence: recent.sentence, title: recent.title } : {};
  if (!old) saved.unshift({ ...word, ...context, savedAt: Date.now() });
  persist();
  decorateButton($("saveWord"), "Saved", "check");
}

function showPanel(title) {
  $("panel").classList.remove("searchPanel");
  resumeAfterLookup = false; resumePending = false; closeLookup(false);
  pause();
  $("panelTitle").textContent = title;
  $("panelBody").replaceChildren();
  $("panel").showModal();
  return $("panelBody");
}
function closePanel() {
  $("panel").classList.remove("searchPanel");
  $("panel").close();
}
function button(text, action) {
  const b = el("button", text);
  b.onclick = action;
  return b;
}
async function showLibrary() {
  const body = showPanel("Library");
  body.textContent = "Loading local media…";
  try {
    await refreshLibrary();
    body.replaceChildren();
    body.append(
      el(
        "p",
        "Media, chapters and generated transcripts stay on this Mac. Imported media and saved transcripts work without an internet connection.",
        "hint",
      ),
    );
    if (!library.length)
      body.append(
        el("p", "Open a local video or Japanese audiobook to begin."),
      );
    const cards = el("div", null, "cards");
    for (const item of library) {
      const card = el("article", null, "entry");
      card.append(
        el("h3", item.title),
        el(
          "p",
          `${item.kind} · ${Math.round(item.duration / 60)} minutes · transcript ${item.transcript}`,
        ),
        button(
          "Study",
          () => void openLocal(item.id).catch((e) => status(e.message, true)),
        ),
      );
      let confirming = false;
      const removeButton = button("Remove", async () => {
        if (!confirming) {
          confirming = true;
          removeButton.textContent = "Remove from this Mac?";
          return;
        }
        try {
          await api("desktop/library", { id: item.id }, "DELETE");
          if (source?.type === "local" && source.id === item.id) {
            stopMedia();
            status("Media removed from the library.");
          }
          await showLibrary();
        } catch (error) {
          status(error.message, true);
        }
      });
      card.append(removeButton);
      cards.append(card);
    }
    body.append(cards);
  } catch (e) {
    body.textContent = e.message;
  }
}
async function showAnki(word) {
  closePanel();
  const body = showPanel("Send to Anki"), message = el("p", "Connecting to Anki…", "hint");
  message.setAttribute("role", "status");
  const active = () => body.parentElement && $("panel").open && $("panelTitle").textContent === "Send to Anki" && message.isConnected;
  body.append(message);
  try {
    const connection = await api("desktop/anki");
    if (!active()) return;
    if (!connection.decks.length || !connection.models.length) throw Error("Create a deck and note type in Anki, then retry.");
    let settings = {};
    try { settings = JSON.parse(localStorage.getItem("immersed.anki") || "{}") || {}; } catch {}
    const values = {
      Expression: word.word,
      Reading: word.reading || "",
      Definition: word.meaning || "",
      Example: word.sentence || "",
      Source: [word.title, /^https:\/\//.test(word.url || "") ? word.url : "", word.time > 0 ? formatDuration(word.time) : ""].filter(Boolean).join("\n"),
    };
    values.Details = [values.Reading, values.Definition, values.Example, values.Source].filter(Boolean).join("\n");
    const select = (label, options) => {
      const control = el("select");
      for (const [value, title] of options) {
        const option = el("option", title); option.value = value; control.append(option);
      }
      const row = el("label", null, "settingRow"); row.append(el("span", label), control);
      return [row, control];
    };
    const [deckRow, deck] = select("Deck", connection.decks.filter(item => item.kind !== "filtered").map(item => [item.id, item.name]));
    const [typeRow, model] = select("Note type", connection.models.map(item => [item.id, item.name]));
    if ([...deck.options].some(option => option.value === settings.deck)) deck.value = settings.deck;
    if ([...model.options].some(option => option.value === settings.model)) model.value = settings.model;
    const tags = el("input"), tagsRow = el("label", null, "settingRow");
    tags.value = settings.tags || ""; tags.placeholder = "Separate tags with spaces";
    tagsRow.append(el("span", "Tags"), tags);
    const mapping = el("div"), preview = el("div", null, "ankiPreview");
    const file = el("input"); file.type = "file"; file.accept = "image/png,image/jpeg,audio/mpeg,audio/wav";
    const mediaRow = el("label", null, "settingRow");
    mediaRow.append(el("span", "Optional Anki attachment"), file);
    const mediaField = el("select"), mediaFieldRow = el("label", null, "settingRow");
    mediaFieldRow.append(el("span", "Attachment field"), mediaField); mediaFieldRow.hidden = true;
    const doc = el("a", "AnkiConnect setup");
    doc.href = "https://git.sr.ht/~foosoft/anki-connect"; doc.target = "_blank"; doc.rel = "noopener";
    const confirm = button("Add to Anki", () => {}); confirm.hidden = true;
    const check = button("Preview note", () => void submit());
    const actions = el("div", null, "ankiActions"); actions.append(confirm, doc);
    body.append(deckRow, typeRow, mapping, tagsRow, mediaRow, mediaFieldRow, check, preview, actions);
    let revision = 0, controls = [];
    function invalidate() {
      revision++; confirm.hidden = true; preview.replaceChildren(); check.disabled = controls.length === 0;
      message.textContent = "Anki " + connection.ankiVersion;
    }
    async function loadFields() {
      invalidate(); mapping.replaceChildren(); controls = []; check.disabled = true;
      const type = model.value;
      try {
        const data = await api("desktop/anki", { model: type });
        if (!active() || model.value !== type) return;
        controls = data.fields.map((field, index) => {
          const [row, control] = select(field, [["", "Leave blank"], ...Object.keys(values).map(name => [name, name])]);
          const saved = settings.model === type ? settings.mapping?.[field] : undefined;
          control.value = saved ?? (index === 0 ? "Expression" : index === 1 ? "Details" : "");
          control.onchange = invalidate; mapping.append(row); return [field, control];
        });
        mediaField.replaceChildren(...data.fields.map(field => {
          const option = el("option", field); option.value = field; return option;
        }));
        if (data.fields.length > 1) mediaField.selectedIndex = 1;
        check.disabled = false;
      } catch (error) { if (active() && model.value === type) message.textContent = error.message; }
    }
    async function submit(action = "preview") {
      const current = ++revision;
      confirm.hidden = true; check.disabled = true;
      const selected = Object.fromEntries(controls.map(([field, control]) => [field, control.value]));
      const fields = Object.fromEntries(Object.entries(selected).filter(([, value]) => value).map(([field, value]) => [field, values[value]]));
      preview.replaceChildren(...Object.entries(fields).map(([field, value]) => {
        const row = el("div", null, "entry"); row.append(el("strong", field), el("p", value)); return row;
      }));
      message.textContent = action === "preview" ? "Checking note…" : "Saving note…";
      try {
        if (!Object.values(selected).includes("Expression")) throw Error("Map Expression to a note field.");
        let attachment;
        const chosen = file.files[0];
        if (chosen) {
          if (chosen.size > 2 * 1024 * 1024 || !chosen.type) throw Error("Choose a supported attachment up to 2 MB.");
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1]);
            reader.onerror = () => reject(Error("The attachment could not be read."));
            reader.readAsDataURL(chosen);
          });
          if (!active() || current !== revision) return;
          attachment = { field: mediaField.value, type: chosen.type, data };
          preview.append(el("p", "Anki attachment: " + chosen.name));
        }
        const result = await api("desktop/anki", {}, "POST", JSON.stringify({
          model: model.value, deck: deck.value, identity: word.key || word.word, fields, tags: tags.value, action, attachment,
        }));
        if (!active() || current !== revision) return;
        settings = { model: model.value, deck: deck.value, mapping: selected, tags: tags.value };
        try { localStorage.setItem("immersed.anki", JSON.stringify(settings)); } catch {}
        const messages = {
          ready: "Ready to add. Review the fields below.",
          canUpdate: "A note from Immersed already exists. Review the fields before updating it.",
          added: "Note added to Anki.", updated: "Note updated in Anki.", exists: "This note is already in Anki.",
          edited: "This Anki note has manual changes. Open it in Anki to update it.",
          duplicate: "More than one matching note exists. Review them in Anki.",
          invalid: result.issues?.map(issue => issue.message).filter(Boolean).join(" ") || "Anki rejected the note. Check for duplicates and required fields.",
        };
        message.textContent = messages[result.status] || "Anki returned an unexpected status.";
        if (result.status === "ready" || result.status === "canUpdate") {
          const next = result.status === "ready" ? "add" : "update";
          confirm.textContent = next === "add" ? "Add to Anki" : "Update Immersed note";
          confirm.onclick = () => void submit(next); confirm.hidden = false;
        }
      } catch (error) {
        if (active() && current === revision) message.textContent = error.message;
      } finally {
        if (active() && current === revision) check.disabled = false;
      }
    }
    deck.onchange = invalidate; tags.oninput = invalidate; mediaField.onchange = invalidate;
    file.onchange = () => { mediaFieldRow.hidden = !file.files.length; invalidate(); };
    model.onchange = () => void loadFields();
    await loadFields();
  } catch (error) {
    if (active()) {
      message.textContent = error.message;
      body.append(button("Retry connection", () => void showAnki(word)));
    }
  }
}

function showWords() {
  function replayContext(word) {
    closePanel();
    const time = Number.isFinite(word.time) && word.time >= 0 ? word.time : 0;
    const netflixURL = ImmersedNetflix.netflixURL(word.url);
    if (netflixURL) {
      if (netflix?.id === netflixURL.split('/').at(-1)) { seekTo(time); play(); }
      else openNetflix(netflixURL, time);
    } else if (word.url.startsWith("local:")) {
      if (source?.type === "local" && source.id === word.url.slice(6)) { seekTo(time); play(); }
      else void openLocal(word.url.slice(6), time).catch(e => status(e.message, true));
    } else {
      const id = idFrom(word.url);
      if (id) {
        if (source?.type === "youtube" && source.id === id) { seekTo(time); play(); }
        else void loadVideo(id, word.title, time);
      }
    }
  }
  const body = showPanel("Words"),
    form = el("form"),
    input = el("input");
  input.placeholder = "Japanese, German or English";
  input.setAttribute("aria-label", "Search dictionary");
  form.append(input, el("button", "Search"));
  const results = el("div");
  let dictionaryTimer,
    searchId = 0;
  async function searchDictionary() {
    const query = input.value.trim(),
      generation = ++searchId;
    if (!query) {
      results.replaceChildren();
      return;
    }
    results.textContent = "Searching…";
    try {
      const data = await api("immersion/search", { query });
      if (
        generation !== searchId ||
        !$("panel").open ||
        $("panelTitle").textContent !== "Words"
      )
        return;
      results.replaceChildren();
      for (const entry of (data.data || []).slice(0, 12)) {
        const j = entry.japanese?.[0] || {},
          title = [j.word, j.reading].filter(Boolean).join(" · ");
        const result = button("", () => {
          closePanel();
          void openLookup(
            {
              text: j.word || j.reading,
              lemma: j.word || j.reading,
              reading: j.reading || "",
              grammar: [],
              pos: "",
            },
            true,
          );
        });
        result.className = "dictionaryResult";
        result.setAttribute("aria-label", title);
        result.append(
          el("strong", title),
          el(
            "small",
            entry.definitions?.[0] || entry.senses?.[0]?.english_definitions?.slice(0, 2).join("; ") ||
              "",
            "hint",
          ),
        );
        results.append(result);
      }
      if (!data.data?.length) results.textContent = "No matching entries.";
    } catch (error) {
      if (generation === searchId) results.textContent = error.message;
    }
  }
  form.onsubmit = (e) => {
    e.preventDefault();
    clearTimeout(dictionaryTimer);
    void searchDictionary();
  };
  input.oninput = () => {
    searchId++;
    clearTimeout(dictionaryTimer);
    dictionaryTimer = setTimeout(() => void searchDictionary(), 180);
  };
  const summary = ImmersedWordHistory.progress(saved.filter(w=>extras.wordStates[w.lemma || w.word]!=="ignored"), prefs.knowledge);
  const marked = Object.values(prefs.knowledge).filter(value => value === true).length, goal = (Math.floor(marked / 10) + 1) * 10;
  const dashboard = el("div", null, "wordProgress");
  for (const [label, count] of [["Saved", summary.saved], ["Saved to study", summary.learning], ["Marked known", marked]]) {
    const metric = el("div"); metric.append(el("strong", String(count)), el("span", label)); dashboard.append(metric);
  }
  const milestone = el("progress"); milestone.max=goal;milestone.value=marked;milestone.setAttribute("aria-label","Next vocabulary milestone");
  body.append(dashboard, el("p",marked + " / " + goal + " words marked known"),milestone);
  if (coverageTokens.length) {
    const estimate = ImmersedLearning.estimateVocabulary(levels,coverageTokens.filter(t=>extras.wordStates[t.lemma]!=="ignored"),prefs.level,prefs.knowledge);
    if (estimate) body.append(el("p", "Current video sample: " + estimate.known + " / " + estimate.total + " word occurrences estimated familiar. " + estimate.confirmed + " marked known; " + estimate.assumed + " assumed from your level; " + estimate.unrated + " unrated. Repeated words count as repeated occurrences. Names are excluded unless marked; grammar is excluded. This estimates vocabulary coverage, not comprehension.", "hint"));
  }
  body.append(form,results,el("h3", "Recent lookups"));
  const recentList = el("div", null, "recentWords");
  if (!recentWords.length) recentList.append(el("p", "Words you look up appear here automatically.", "hint"));
  for (const word of recentWords) {
    const row = el("article", null, "recentWord");
    const details = button("", () => {
      closePanel(); void openLookup({ text: word.word, lemma: word.lemma || word.word, reading: word.reading || "", grammar: [] }, true);
    });
    details.className = "recentWordDetail"; details.setAttribute("aria-label", "Look up " + word.word);
    details.append(el("strong", word.word), el("small", word.reading, "hint"), el("span", word.meaning, "recentMeaning"));
    const isSaved = saved.some(w => w.key === word.key);
    const add = iconButton(isSaved ? "Saved" : "Save " + word.word, isSaved ? "check" : "save", () => {
      if (!saved.some(w => w.key === word.key)) saved.unshift({ ...word, savedAt: Date.now() });
      persist(); showWords();
    });
    add.disabled = isSaved;
    row.append(details, el("small", (word.lookups || 1) + (word.lookups === 1 ? " lookup" : " lookups"), "hint"), add);
    if (word.url) row.append(iconButton("Play context for " + word.word, "play", () => replayContext(word)));
    recentList.append(row);
  }
  body.append(recentList, el("h3", "Saved words"));
  if (!saved.length) body.append(el("p", "Save a recent lookup to start your word collection.", "hint"));
  for (const word of saved) {
    const entry = el("article", null, "entry savedWord");
    const lemma = word.lemma || word.word, known = prefs.knowledge[lemma] === true;
    entry.append(el("h3", word.word), el("p", word.reading), el("p", word.meaning), el("p", word.sentence), el("small", stateLabel(extras.wordStates[lemma]) || (known ? "Known" : "Learning"), "wordState"));
    const actions = el("div", null, "wordActions");
    actions.append(iconButton(known ? "Mark " + word.word + " learning" : "Mark " + word.word + " known", "check", () => {
      prefs.knowledge[lemma] = !known; extras.wordStates[lemma] = known ? 'learning' : 'known';
      persist(); applyPreferences(); showWords();
    }));
    if (word.url) actions.append(iconButton("Play context for " + word.word, "play", () => replayContext(word)));
    actions.append(iconButton("Remove " + word.word, "trash", () => {
      saved = saved.filter(w => w.key !== word.key); persist(); showWords();
    }));
    actions.append(button("Send to Anki", () => void showAnki(word)));
    entry.append(actions); body.append(entry);
  }
}

let pendingSeek = 0;
function setting(body, label, description, key, options, isExtra = false) {
  const row = el("label", null, "settingRow"),
    text = el("span", label);
  if (description) text.append(el("small", description));
  const object = isExtra ? extras : prefs;
  let control;
  if (options) {
    control = el("select");
    for (const [value, title] of options) {
      const option = el("option", title);
      option.value = value;
      control.append(option);
    }
    control.value = object[key];
    control.onchange = () => {
      object[key] =
        typeof object[key] === "number" ? Number(control.value) : control.value;
      persist();
      applyPreferences();
      if (!$("discovery").hidden && key === "minimumMinutes") void searchYouTube(discoveryQuery);
      if (key === "speechQuality" && source && source.type !== "netflix") {
        requestGeneration++;
        clearTimeout(pollTimer);
        prefetchedWindow = -1;
        void beginTranscript();
      }
    };
  } else {
    control = el("input");
    control.type = "checkbox";
    control.checked = object[key];
    control.onchange = () => {
      object[key] = control.checked;
      persist();
      applyPreferences();
      if (!$("discovery").hidden && ["hideShorts", "originalOnly", "conversationFirst", "nativeAudience"].includes(key)) void searchYouTube(discoveryQuery);
      if (["pitchAccent","dictionaryDetails"].includes(key)) { renderDefinitions(); $("grammar").hidden = !extras.dictionaryDetails; }
    };
  }
  control.setAttribute("aria-label", label);
  row.append(text, control);
  body.append(row);
}
function atlasHeading(title) {
  const heading = el("h3", null, "atlasHeading");
  const icon = el("img");
  icon.src = "/credits/kotoba-atlas.png";
  icon.alt = "";
  icon.width = 22;
  icon.height = 22;
  heading.append(icon, document.createTextNode(title));
  return heading;
}

function showSettings(focusCredits = false) {
  const body = showPanel("Settings");
  const suite = document.createElement("section");
  suite.innerHTML = '<h3>Immersed</h3><details class="dot-suite"><summary>Part of <b>dot.</b></summary><nav aria-label="More from dot."><a href="https://github.com/Somamill/read">read.<small>Books, articles, and highlights.</small></a><a href="https://github.com/Somamill/listen">listen.<small>Find your next audiobook.</small></a></nav></details>';
  body.append(suite);
  body.append(button("Version history", showHistory));
  const dictionaryStatus = el("p",null,"hint"), dictionaryUpdate = button("Check dictionary updates",async()=>{
    dictionaryUpdate.disabled=true;
    try {
      let data=await api("desktop/dictionary-update",{check:"1"});
      dictionaryStatus.textContent="Installed: " + data.current + (data.available ? " · Available: " + data.latest : " · Up to date");
      if (data.available) {
        dictionaryUpdate.textContent="Update to " + data.latest;dictionaryUpdate.disabled=false;
        dictionaryUpdate.onclick=async()=>{
          dictionaryUpdate.disabled=true;
          try {
            data=await api("desktop/dictionary-update",{},"POST");
            while (data.status === "updating") {
              dictionaryStatus.textContent="Downloading and indexing the verified dictionary…";
              await new Promise(resolve=>setTimeout(resolve,1000)); data=await api("desktop/dictionary-update");
            }
            if (data.status === "error") throw Error(data.error);
            analysisCache.clear();dictionaryCache.clear();contextCache.clear();cueIndex=-1;void renderCue();
            dictionaryStatus.textContent="Installed: " + data.current;dictionaryUpdate.textContent="Dictionary updated";
          } catch(error) {dictionaryStatus.textContent=error.message;dictionaryUpdate.disabled=false;}
        };
      }
    } catch(error) {dictionaryStatus.textContent=error.message;dictionaryUpdate.disabled=false;}
    finally {if (!dictionaryUpdate.textContent.startsWith("Update to")) dictionaryUpdate.disabled=false;}
  });
  dictionaryUpdate.classList.add("dictionaryUpdate");
  dictionaryStatus.setAttribute("role","status");
  body.append(atlasHeading("Kotoba Atlas"),dictionaryStatus,dictionaryUpdate);
  const languageRow=el("label",null,"settingRow"), languageSelect=el("select");
  languageRow.append(el("span","Kotoba Atlas language"),languageSelect);
  for(const [value,label] of [["en","English"],["de","Deutsch"]]){const option=el("option",label);option.value=value;languageSelect.append(option);}
  languageSelect.setAttribute("aria-label","Kotoba Atlas language");languageSelect.disabled=true;
  void api("desktop/dictionary-update").then(data=>{languageSelect.value=data.language || "de";languageSelect.disabled=data.status==="updating";}).catch(()=>{languageSelect.disabled=false;});
  languageSelect.onchange=async()=>{
    languageSelect.disabled=true;dictionaryUpdate.disabled=true;
    try {
      let data=await api("desktop/dictionary-update",{language:languageSelect.value},"POST");
      while(data.status==="updating"){
        dictionaryStatus.textContent="Preparing the selected dictionary…";
        await new Promise(resolve=>setTimeout(resolve,1000));data=await api("desktop/dictionary-update");
      }
      if(data.status==="error")throw Error(data.error);
      closeLookup(false);analysisCache.clear();dictionaryCache.clear();contextCache.clear();cueIndex=-1;void renderCue();
      showSettings();
    }catch(error){dictionaryStatus.textContent=error.message;languageSelect.disabled=false;dictionaryUpdate.disabled=false;}
  };
  body.append(languageRow);

  if (source && source.type !== "netflix" && transcriptKind !== "human" && cues.length)
    body.append(button("Compare speech models", compareTranscript));
  setting(body, "Dark mode", "", "dark");
  setting(
    body,
    "Completed Japanese level",
    "Only words above your completed level or explicitly marked unknown are highlighted. Unlisted words have no assumed JLPT level.",
    "level",
    [5, 4, 3, 2, 1].map((n) => [n, "N" + n]),
  );
  setting(body, "Dictionary grammar details", "Show technical word classes and conjugation labels in lookups.", "dictionaryDetails", null, true);
  setting(body, "Furigana", "Readings for unfamiliar words.", "readings");
  setting(body, "Pause after each subtitle", "Pause at each subtitle’s end for reading. Requires timed subtitles; replay the current line with R.", "pauseAfterSubtitle", null, true);
  setting(
    body,
    "Pitch accent",
    "Tokyo accent patterns in dictionary lookup.",
    "pitchAccent",
  );
  setting(
    body,
    "Hide Shorts",
    "Filter short-format search results.",
    "hideShorts",
  );
  setting(
    body,
    "Minimum video length",
    "Applies to Discover and YouTube search results.",
    "minimumMinutes",
    [
      [0, "Any"],
      [15, "15+ minutes"],
      [30, "30+ minutes"],
      [60, "60+ minutes"],
    ],
  );
  setting(
    body,
    "Original Japanese only",
    "Only show search results whose original language is reported as Japanese. Results with unknown language are excluded.",
    "originalOnly",
    null,
    true,
  );
  setting(body, "Native audience", "Favor Japanese domestic discussions and filter recognizable learner content in Discover.", "nativeAudience", null, true);
  setting(body, "Conversation first", "Prioritize podcasts, interviews and discussion in Discover. Hide obvious music and gameplay results.", "conversationFirst", null, true);
  setting(
    body,
    "Block ad requests",
    "WebKit blocks known advertising domains and ad request paths. Same-origin YouTube video ads may still appear.",
    "blockAds",
    null,
    true,
  );
  setting(
    body,
    "Lookup on hover",
    "Hover or click a subtitle word. Move away from the word and lookup card to close it and resume hover-paused playback.",
    "hoverLookup",
    null,
    true,
  );
  setting(
    body,
    "Pause during hover lookup",
    "Resume when hover lookup closes, if playback was running.",
    "pauseOnHover",
    null,
    true,
  );
  if (netflix) {
    setting(body, "Also show Netflix’s original subtitles", "", "netflixOriginal", null, true);
    body.append(button("Choose audio and subtitles in Netflix", () => { closePanel(); netflixCommand("subtitles"); }));
  }
  setting(body, "Read captions from video", "Match Japanese text visible in the video. Uses small frame downloads.", "screenCaptionCheck", null, true);
  if (source?.type !== "netflix") setting(
    body,
    "Speech model",
    "Turbo is the default. The alternate large-v3 model can produce different spelling or more kana and is not always more accurate. Its first use downloads model weights.",
    "speechQuality",
    [
      ["balanced", "Turbo · recommended"],
      ["accurate", "Large v3 · slower"],
    ],
    true,
  );
  body.append(
    el("h3", "Settings backup"),
    el(
      "p",
      "Settings and saved words stay on this Mac. Export a backup to iCloud Drive through the Mac save dialog. Automatic iPhone/Mac sync is deferred until Apple signing is configured.",
      "hint",
    ),
    button("Export backup", exportBackup),
    button("Import backup", () => $("settingsInput").click()),
    el("h3", "Keyboard"),
    el(
      "p",
      "Space: play/pause · ←/→ or J/L: previous/next subtitle · F: video fullscreen · K: play/pause · Esc: close lookup · ⌘L: search · ⌘O: open media",
      "hint",
    ),
    atlasHeading("Dictionary sources"),
    el(
      "p",
      "Kotoba Atlas · English or German definitions, selected in Settings. German uses English fallback where needed. Full sources and licenses: https://github.com/Somamill/kotoba-atlas/blob/main/DATA-LICENSES.md. JMdict and JMnedict © EDRDG; Kanjium pitch accents © Uros O., CC BY-SA 4.0. Kuromoji/IPADIC supplies Japanese morphology. Tatoeba contributors supply context counts, CC BY 2.0 FR. On Apple Silicon, Qwen3-4B-Instruct-2507 (MLX, Apache 2.0) ranks dictionary meanings locally; it can select an incorrect sense. Context plausibility is not audio verification. JLPT levels are community estimates. Speech transcripts are generated estimates; verify uncertain words with the audio.",
      "hint",
    ),
  );
  const credits = el("section", null, "settingsCredits");
  const heading = el("h3", "Credits");
  heading.tabIndex = -1;
  credits.append(heading);
  body.append(credits);

  void fetch("/credits/credits.json").then(response => {
    if (!response.ok) throw new Error("Credits unavailable");
    return response.json();
  }).then(({ creator, contact, support, socials }) => {
    const addLink = (title, href, icon) => {
      const link = el("a", null, "creditLink");
      link.href = href;
      if (icon) {
        const image = el("img");
        image.src = "/credits/" + icon + ".png";
        image.alt = "";
        image.width = image.height = 32;
        link.append(image);
      }
      link.append(title);
      credits.append(link);
    };
    credits.append(
      el("p", "Made by " + creator + " · Part of dot."),
      el("p", "Questions, ideas, and bug reports are welcome.", "hint"),
    );
    addLink("Email " + contact.email, "mailto:" + contact.email + "?subject=Immersed%20feedback");
    addLink("Support on " + support.service, support.url, "kofi");
    for (const social of socials)
      addLink(social.name, social.url, social.name === "Reddit" ? "reddit" : undefined);
    if (focusCredits === true && credits.isConnected && $("panel").open) heading.focus();
  }).catch(() => credits.remove());
}
async function showHistory() {
  const body = showPanel("Version history");
  try {
    const history = await api("desktop/history");
    for (const release of history) {
      const row = el("article", null, "entry");
      row.append(
        el("h3", release.version + " · " + release.date),
        el("p", release.title),
      );
      for (const note of release.notes) row.append(el("p", note));
      body.append(row);
    }
  } catch (error) {
    body.textContent = error.message;
  }
}
function exportBackup() {
  const text = JSON.stringify(
    { schema: 3, preferences: prefs, savedWords: saved, recentWords, macOptions: extras },
    null,
    2,
  );
  if (window.webkit?.messageHandlers?.immersed)
    window.webkit.messageHandlers.immersed.postMessage({
      action: "exportSettings",
      text,
    });
  else {
    const link = el("a");
    link.href = URL.createObjectURL(
      new Blob([text], { type: "application/json" }),
    );
    link.download = "immersed-settings.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
}
let searchGeneration = 0;
let discoveryQuery = "社会 対談", discoveryTopic = "Conversations", discoveryPaint = null;
const discoveryTopics = [
  ["Conversations", "社会 対談"], ["Podcasts", "ポッドキャスト 雑談"],
  ["Interviews", "作家 インタビュー"], ["Books & culture", "読書 文学 文化"],
  ["Everyday life", "暮らし 日常 会話"], ["Ideas", "社会 哲学 対話"],
];
function showWatch() {
  $("discovery").hidden = true;
  $("watchPage").hidden = false;
  $("discoverButton").setAttribute("aria-pressed", "false");
  $("watchButton").setAttribute("aria-pressed", "true");
  $("fullscreen").disabled = false;
  searchGeneration++;
}
function showDiscovery(query = discoveryQuery) {
  speechProgress();
  if (document.fullscreenElement) void document.exitFullscreen();
  closePanel();
  closeLookup();
  pause();
  $("watchPage").hidden = true;
  $("discovery").hidden = false;
  $("discoverButton").setAttribute("aria-pressed", "true");
  $("watchButton").setAttribute("aria-pressed", "false");
  $("fullscreen").disabled = true;
  for (const topic of $("discoveryTopics").children)
    topic.setAttribute("aria-pressed", String(topic.textContent === discoveryTopic));
  void searchYouTube(query);
}
for (const [name, query] of discoveryTopics) {
  const topic = button(name, () => { discoveryTopic = name; showDiscovery(query); });
  topic.setAttribute("aria-pressed", "false");
  $("discoveryTopics").append(topic);
}
async function searchYouTube(query) {
  if ($("discovery").hidden) { showDiscovery(query); return; }
  discoveryQuery = query;
  const generation = ++searchGeneration, body = $("discoveryBody");
  body.replaceChildren();
  const heading = el("div", null, "searchSummary"),
    title = el("h2", discoveryTopic || query),
    progress = el("span", "Finding conversations…", "hint");
  heading.append(title, progress);
  const controls = el("div", null, "searchFilters");
  function check(label, checked) {
    const row = el("label", null, "searchToggle"), input = el("input");
    input.type = "checkbox"; input.checked = checked;
    input.setAttribute("aria-label", label);
    row.append(input, document.createTextNode(label)); controls.append(row);
    return input;
  }
  const nativeAudience = check("Native audience", extras.nativeAudience),
    conversation = check("Conversation first", extras.conversationFirst);
  const lengthLabel = el("label", null, "discoveryLength"), length = el("select");
  length.setAttribute("aria-label", "Minimum video length");
  for (const minutes of [0, 15, 30, 60]) {
    const option = el("option", minutes ? minutes + "+ minutes" : "Any length");
    option.value = String(minutes); length.append(option);
  }
  length.value = String(prefs.minimumMinutes);
  lengthLabel.append(el("span", "Length"), length); controls.append(lengthLabel);
  const cards = el("div", null, "searchResults"), message = el("p", "", "hint");
  const retry = button("Try again", () => void searchYouTube(query)); retry.hidden = true;
  const more = button("Find more videos", () => { page++; void fetchResults(); });
  more.className = "discoveryMore"; more.hidden = true;
  body.append(controls, heading, cards, message, retry, more);
  const rendered = new Map();
  let latest = { items: [], status: "loading" }, page = 1;
  const collected = new Map();
  let prefetched;
  const searchPage = page => api("desktop/search", {
    query, page, nativeAudience: extras.nativeAudience, conversation: extras.conversationFirst,
    minimumMinutes: prefs.minimumMinutes, hideShorts: prefs.hideShorts,
  });
  function paint() {
    conversation.checked = extras.conversationFirst;
    nativeAudience.checked = extras.nativeAudience;
    length.value = String(prefs.minimumMinutes);
    const data = latest, filters = { ...prefs, conversation: extras.conversationFirst, nativeAudience: extras.nativeAudience },
      filtered = data.items.filter(x => (!extras.originalOnly || x.language === "ja") && ImmersedDiscovery.eligible(x, filters))
        .sort((a, b) => extras.conversationFirst ? ImmersedDiscovery.score(b) - ImmersedDiscovery.score(a) : 0),
      ids = new Set(filtered.map(x => x.id));
    for (const [id, node] of rendered) if (!ids.has(id)) { node.remove(); rendered.delete(id); }
    for (const [index, item] of filtered.entries()) {
      let card = rendered.get(item.id);
      if (!card) {
        card = el("button", null, "searchVideo"); card.type = "button";
        const art = el("div", null, "searchArtwork"), image = el("img");
        image.alt = ""; image.loading = "lazy"; image.decoding = "async";
        if (/^https:\/\/i\.ytimg\.com\//.test(item.thumbnail || "")) image.src = item.thumbnail;
        art.append(image, el("span", "", "searchDuration"));
        card.append(art, el("h3"), el("p", "", "hint"), el("small", "", "searchLanguage"));
        card.onclick = () => { showWatch(); void loadVideo(item.id, item.title); };
        cards.append(card); rendered.set(item.id, card);
      }
      card.style.order = String(index); card.setAttribute("aria-label", "Watch " + item.title);
      card.querySelector("h3").textContent = item.title;
      card.querySelector("p").textContent = item.channel || "";
      card.querySelector(".searchDuration").textContent = formatDuration(item.duration);
      card.querySelector(".searchLanguage").textContent = item.language === "ja" ? "Japanese original" : item.language || "Language unverified";
    }
    progress.textContent = data.status === "loading" ? "Finding conversations…" : data.status === "checking"
      ? "Checking originals · " + (data.checked || 0) + "/" + (data.total || data.items.length)
      : filtered.length + (filtered.length === 1 ? " video" : " videos");
    message.textContent = !filtered.length
      ? data.status === "checking" ? "Checking the language of these videos…"
        : data.status === "loading" ? "" : "No matching videos. Try another topic, a shorter minimum length, or change the filters."
      : "";
    cards.classList.toggle("loading", !filtered.length && data.status !== "ready");
  }
  discoveryPaint = paint;
  nativeAudience.onchange = () => { extras.nativeAudience = nativeAudience.checked; persist(); void searchYouTube(query); };
  conversation.onchange = () => { extras.conversationFirst = conversation.checked; persist(); void searchYouTube(query); };
  length.onchange = () => { prefs.minimumMinutes = Number(length.value); persist(); void searchYouTube(query); };
  paint();
  async function fetchResults() {
    more.disabled = true; more.textContent = "Finding more…";
    try {
      while (generation === searchGeneration && !$("discovery").hidden) {
        const pending = prefetched;
        prefetched = null;
        const data = (pending && await pending) || await searchPage(page);
        if (generation !== searchGeneration || $("discovery").hidden) return;
        for (const item of data.items) collected.set(item.id, item);
        latest = { ...data, items: [...collected.values()] };
        paint();
        more.hidden = data.hasMore !== true;
        if (data.status === "checking") {
          await new Promise(resolve => setTimeout(resolve, 650));
          continue;
        }
        if (data.hasMore !== true || page >= 4) break;
        if (cards.getBoundingClientRect().bottom >= innerHeight && rendered.size) {
          prefetched = searchPage(page + 1).catch(() => null);
          break;
        }
        page++;
      }
    } catch (error) {
      if (generation !== searchGeneration || $("discovery").hidden) return;
      progress.textContent = "Couldn’t load videos"; message.textContent = error.message;
      cards.classList.remove("loading");
      more.hidden = true;
      retry.hidden = false;
    } finally {
      more.disabled = false; more.textContent = "Find more videos";
    }
  }
  await fetchResults();
}

async function importMedia(file) {
  if (!file) return;
  status("Importing " + file.name + "…");
  $("openFile").disabled = true;
  try {
    const item = await api("desktop/import", { name: file.name }, "POST", file);
    await openLocal(item.id);
  } catch (e) {
    status(e.message, true);
  } finally {
    $("openFile").disabled = false;
    $("fileInput").value = "";
  }
}
async function download() {
  if (source?.type !== "youtube") return;
  const current = { ...source };
  $("download").disabled = true;
  $("downloadLabel").textContent = "Saving…";
  status("");
  try {
    const item = await api(
      "desktop/download",
      { videoId: current.id, quality: extras.speechQuality },
      "POST",
    );
    if (source?.id === current.id) {
      $("downloadLabel").textContent = "Saved offline ✓";
      $("download").onclick = () => void showLibrary();
      $("download").title = "Open Library to watch the saved video without internet";
    }
  } catch (e) {
    status(e.message, true);
    $("downloadLabel").textContent = "Retry save";
  } finally {
    $("download").disabled = false;
  }
}
async function sampleCoverage() {
  const generation = requestGeneration,
    all = [];
  for (let i = 0; i < Math.min(10, cues.length); i++) {
    const cue =
      cues[
        Math.round(
          (i * (cues.length - 1)) / Math.max(1, Math.min(10, cues.length) - 1),
        )
      ];
    try {
      all.push(...(await analyze(cue.text)));
    } catch {}
    if (generation !== requestGeneration) return;
  }
  coverageTokens = all;
  updateCoverage();
}
function updateCoverage() {
  if (!coverageTokens.length) { $("understanding").hidden = true; return; }
  const coverage = ImmersedLearning.estimateVocabulary(
    levels,
    coverageTokens.filter(t => extras.wordStates[t.lemma] !== "ignored"),
    prefs.level,
    prefs.knowledge,
  );
  $("coverage").textContent = coverage
    ? "Sampled vocabulary: " +
      coverage.lower +
      "% known · " +
      coverage.unrated +
      " unlisted"
    : "";
  $("understanding").hidden = !coverage;
  if (coverage) {
    $("understanding").textContent = coverage.lower + "%";
    $("understanding").title = coverage.known + " / " + coverage.total + " sampled word occurrences estimated familiar (" + coverage.confirmed + " explicitly marked known, " + coverage.assumed + " assumed from your level). " + coverage.unrated + " unrated. Open Words for details. This is not a comprehension or fluency score.";
    $("understanding").setAttribute("aria-label", "Estimated vocabulary coverage: " + coverage.lower + "%");
  }
}
async function compareTranscript() {
  if (!source || source.type === "netflix" || transcriptKind === "human" || !cues.length) return;
  const generation = requestGeneration,
    baseline = [...cues],
    quality = extras.speechQuality === "accurate" ? "balanced" : "accurate",
    params = {
      ...(source.type === "local"
        ? { id: source.id, at: currentTime() }
        : { videoId: source.id }),
      quality,
    },
    route =
      source.type === "local"
        ? "desktop/local-transcript"
        : "desktop/transcribe";
  const body = showPanel("Check transcript");
  body.append(
    el(
      "p",
      "Comparing two local speech models. The larger model downloads on first use. Agreement does not verify the audio.",
      "hint",
    ),
  );
  const progress = el("p", "Preparing the second model…");
  body.append(progress);
  try {
    await api(route, params, "POST");
    while (
      $("panel").open &&
      $("panelTitle").textContent === "Check transcript" &&
      generation === requestGeneration
    ) {
      const data = await api(route, params);
      if (data.status === "unavailable")
        throw Error(data.message || "The second model failed.");
      if (data.status === "ready") {
        const differences = ImmersedTranscript.compare(
          baseline,
          data.cues || [],
          data.windowed
            ? { start: data.rangeStart, end: data.rangeEnd }
            : undefined,
        );
        progress.textContent = differences.length
          ? "Passages with different wording (first 20). Listen to check each result."
          : "No text differences found in this section. Agreement does not verify the audio.";
        for (const passage of differences.slice(0, 20)) {
          const row = el("article", null, "entry");
          row.append(
            el("p", "Current: " + (passage.current || "No speech recognized")),
            el(
              "p",
              "Second model: " + (passage.other || "No speech recognized"),
            ),
            button("Play at " + formatDuration(passage.start), () => {
              closePanel();
              seekTo(passage.start);
              play();
            }),
          );
          body.append(row);
        }
        return;
      }
      progress.textContent =
        (data.stage || "Comparing…") +
        (data.duration && data.phase !== "loading"
          ? " · " +
            Math.round((100 * (data.processedSeconds || 0)) / data.duration) +
            "%"
          : "");
      await new Promise((r) => setTimeout(r, 1500));
    }
  } catch (error) {
    progress.textContent = error.message;
  }
}
function skip(direction) {
  if (!cues.length) return;
  const t = currentTime();
  const heldIndex = subtitlePauseCue ? cues.indexOf(subtitlePauseCue) : -1;
  const active = heldIndex >= 0 ? heldIndex : netflix?.navigationCue ? netflix.navigationCue.index : cueSeek?.index >= 0 ? cueSeek.index : netflix?.visibleIndex >= 0 ? netflix.visibleIndex : cues.findLastIndex(c => c.start <= t && t < c.end);
  const index = active >= 0
    ? Math.max(0, Math.min(cues.length - 1, active + direction))
    : direction < 0 ? cues.findLastIndex(c => c.end <= t) : cues.findIndex(c => c.start > t);
  if (index >= 0) seekTo(cues[index].start + 0.015);
}
function replaySubtitle() {
  hoverCooldownUntil = performance.now() + 350;
  const cue = lookupCue || (netflix?.navigationCue?.cue) || renderedCue;
  if (!cue || !Number.isFinite(cue.start)) return;
  closeLookup(false);
  seekTo(cue.start + .015);
  play();
}

$("search").onsubmit = (e) => {
  e.preventDefault();
  const value = $("query").value.trim(),
    id = idFrom(value);
if (ImmersedNetflix.netflixURL(value)) { $("query").value = ""; openNetflix(value); return; }
  if (id) {
    closePanel();
    let startAt = null;
    try {
      const url = new URL(value), raw = url.searchParams.get("t") || url.searchParams.get("start");
      const time = raw?.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
      if (time) startAt = Number(time[1] || 0) * 3600 + Number(time[2] || 0) * 60 + Number(time[3] || 0);
    } catch {}
    void loadVideo(id, undefined, startAt);
  } else if (value) {
    discoveryTopic = "";
    showDiscovery(value.slice(0, 120));
  }
};
async function toggleFullscreen() {
if (netflix) { window.webkit?.messageHandlers?.immersed?.postMessage({ action: "netflixFullscreen" }); return; }
  if (document.fullscreenElement) await document.exitFullscreen();
  else {
    const video = $("video");
    video.tabIndex = -1;
    await video.requestFullscreen();
    video.focus();
  }
}
const fullscreenHomes = new Map();
let fullscreenControlsTimer;
function revealFullscreenControls() {
  if (document.fullscreenElement !== $("video")) return;
  $("video").classList.add("controlsVisible");
  for (const id of ["controls", "speechProgress", "exitVideoFullscreen"]) $(id)?.classList.remove("fullscreenChromeHidden");
  clearTimeout(fullscreenControlsTimer);
  fullscreenControlsTimer = setTimeout(() => {
    if (!$("speedMenu").hidden) return;
    $("video").classList.remove("controlsVisible");
    for (const id of ["controls", "speechProgress", "exitVideoFullscreen"]) $(id)?.classList.add("fullscreenChromeHidden");
  }, 1600);
}
$("video").addEventListener("pointermove", e => {
  if (!e.target.closest("#subtitles, #lookup")) revealFullscreenControls();
});
$("video").addEventListener("focusin", e => {
  if (e.target.closest("#controls, #exitVideoFullscreen")) revealFullscreenControls();
});
function restoreFullscreenStudy() {
  for (const [node, home] of fullscreenHomes) home.replaceWith(node);
  fullscreenHomes.clear();
  $("fullscreenStudy")?.remove();
  $("exitVideoFullscreen")?.remove();
  $("fullscreenWake")?.remove();
  clearTimeout(fullscreenControlsTimer); $("video").classList.remove("controlsVisible", "fullscreenActive", "youtubeFullscreen");
  for (const id of ["controls", "speechProgress", "exitVideoFullscreen"]) $(id)?.classList.remove("fullscreenChromeHidden");
}
document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement === $("video")) {
    $("video").classList.add("fullscreenActive");
    $("video").classList.toggle("youtubeFullscreen", source?.type === "youtube");
    const overlay = el("div", null, "fullscreenStudy");
    overlay.id = "fullscreenStudy";
    for (const id of ["speechProgress", "subtitles", "lookup", "controls"]) {
      const node = $(id), home = document.createComment(id + " home");
      node.replaceWith(home); fullscreenHomes.set(node, home); overlay.append(node);
    }
    $("video").append(overlay);
    const wake = el("div", null, "fullscreenWake");
    wake.id = "fullscreenWake"; wake.tabIndex = 0;
    wake.setAttribute("aria-label", "Show fullscreen controls");
    wake.onpointerenter = revealFullscreenControls; wake.onfocus = revealFullscreenControls;
    $("video").append(wake);
    const exit = el("button", "✕", "exitVideoFullscreen");
    exit.id = "exitVideoFullscreen";
    exit.setAttribute("aria-label", "Exit video fullscreen");
    exit.title = "Exit fullscreen · Escape";
    exit.onclick = () => void document.exitFullscreen();
    $("video").append(exit);
    exit.focus();
    revealFullscreenControls();
  } else restoreFullscreenStudy();
  requestAnimationFrame(() => requestAnimationFrame(positionLookup));
});
$("fullscreen").onclick = () =>
  void toggleFullscreen().catch((e) => status(e.message, true));
$("play").onclick = () => {
  const wasPlaying = playing();
  resumePending = false;
  resumeAfterLookup = false;
  closeLookup(false);
  wasPlaying ? pause() : play();
};
decorateButton($("replay"), "Replay subtitle", "refresh");
$("replay").title = "Replay subtitle · R";
$("replay").setAttribute("aria-keyshortcuts", "R");
$("replay").onclick = replaySubtitle;
window.immersedTrackpad = direction => {
  if (!$("panel").open && $("discovery").hidden && !selected &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) skip(direction);
};
$("previous").onclick = () => skip(-1);
$("next").onclick = () => skip(1);
function updateSpeedButton() {
  const rate = Number(extras.playbackRate || 1);
  $("speedValue").textContent = rate + "×";
  $("speed").title = "Playback speed · " + rate + "×";
  for (const item of $("speedMenu").children) item.setAttribute("aria-checked", String(Number(item.dataset.rate) === rate));
}
function closeSpeedMenu() {
  $("speedMenu").hidden = true;
  revealFullscreenControls();
  $("speed").setAttribute("aria-expanded", "false");
}
for (const rate of [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]) {
  const item = el("button", rate === 1 ? "1× · Normal" : rate + "×");
  item.dataset.rate = rate;
  item.setAttribute("role", "menuitemradio");
  item.onclick = () => {
    extras.playbackRate = rate; persist(); updateSpeedButton(); closeSpeedMenu();
    if (netflix) netflixCommand("rate", rate);
    else if (localMedia) localMedia.playbackRate = rate;
    else youtube?.setPlaybackRate?.(rate);
    $("speed").focus();
  };
  $("speedMenu").append(item);
}
updateSpeedButton();
$("speed").onclick = () => {
  const open = $("speedMenu").hidden;
  $("speedMenu").hidden = !open;
  $("speed").setAttribute("aria-expanded", String(open));
  if (open) $("speedMenu").querySelector('[aria-checked="true"]').focus();
};
$("speedMenu").onkeydown = (event) => {
  if (["ArrowDown", "ArrowUp"].includes(event.key)) {
    event.preventDefault(); event.stopPropagation();
    const items = [...$("speedMenu").children], index = items.indexOf(document.activeElement);
    items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
  }
};
document.addEventListener("pointerdown", event => {
  if (!event.target.closest(".speedControl")) closeSpeedMenu();
  if (selected && !event.target.closest("#lookup, .word")) closeLookup();
});
$("closeLookup").onclick = () => { hoverCooldownUntil = performance.now() + 350; closeLookup(); };
$("lookup").onmouseenter = () => { clearTimeout(leaveTimer); leaveTimer = null; };
$("lookup").onmouseleave = scheduleLookupLeave;
$("known").onclick = () => { if (selected) setWordState(familiarity(selected) === "known" ? "unknown" : "known"); };
$("saveWord").onclick = saveWord;
$("speak").onclick = () => {
  if (!selected) return;
  pause();
  const speech = new SpeechSynthesisUtterance(
    selected.reading || selected.text,
  );
  speech.lang = "ja-JP";
  speechSynthesis.cancel();
  speechSynthesis.speak(speech);
};
$("openFile").onclick = () =>
  window.webkit?.messageHandlers?.immersed
    ? window.webkit.messageHandlers.immersed.postMessage({
        action: "openMedia",
      })
    : $("fileInput").click();
$("fileInput").onchange = () => void importMedia($("fileInput").files[0]);
$("discoverButton").onclick = () => showDiscovery();
$("watchButton").onclick = showWatch;
$("refreshDiscovery").onclick = () => void searchYouTube(discoveryQuery);
$("libraryButton").onclick = showLibrary;
$("wordsButton").onclick = showWords;
$("understanding").onclick = showWords;
$("settingsButton").onclick = showSettings;
window.showSettings = showSettings;
window.showLibrary = showLibrary;
window.showWords = showWords;
$("closePanel").onclick = closePanel;
$("download").onclick = download;

$("settingsInput").onchange = async () => {
  try {
    const file = $("settingsInput").files[0];
    if (!file || file.size > 5 * 1024 * 1024)
      throw Error("Choose a JSON backup smaller than 5 MB.");
    const data = JSON.parse(await file.text());
    if (
      data.schema !== 3 ||
      !data.preferences ||
      !Array.isArray(data.savedWords)
    )
      throw Error("This is not an immersed. settings backup.");
    prefs = ImmersedPreferences.restorePreferences(data.preferences);
    saved = data.savedWords
      .filter(
        (w) =>
          w &&
          typeof w.key === "string" &&
          typeof w.word === "string" &&
          typeof w.url === "string" &&
          Number.isFinite(w.time),
      )
      .slice(0, 50000);
    if (Array.isArray(data.recentWords)) recentWords = data.recentWords.filter(w => w && typeof w.key === "string" && typeof w.word === "string" && typeof w.url === "string" && Number.isFinite(w.time)).slice(0, 100);
    if (data.macOptions)
      for (const key of Object.keys(extras))
        if (typeof data.macOptions[key] === "boolean")
          extras[key] = data.macOptions[key];
    if (["balanced", "accurate"].includes(data.macOptions?.speechQuality))
      extras.speechQuality = data.macOptions.speechQuality;
    if ([0.75, 1, 1.25, 1.5, 2].includes(data.macOptions?.playbackRate))
      extras.playbackRate = data.macOptions.playbackRate;
    if (Number.isFinite(data.macOptions?.paneShare)) extras.paneShare=Math.max(.3,Math.min(.7,data.macOptions.paneShare));
    applyPaneShare(extras.paneShare);
    persist();
    applyPreferences();
    showSettings();
    status("Backup restored.");
  } catch (e) {
    status(e.message, true);
  } finally {
    $("settingsInput").value = "";
  }
};
document.addEventListener("keydown", (e) => {
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing && ["ArrowLeft", "ArrowRight"].includes(e.key) &&
      !e.target.closest?.('input,textarea,select,[contenteditable="true"]') && !$("panel").open) {
    e.preventDefault(); navigateWord(e.key === "ArrowLeft" ? -1 : 1); return;
  }
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.isComposing && !e.repeat &&
      !e.target.closest?.('input,textarea,select,[contenteditable="true"]') && !$("panel").open &&
      window.immersedWordShortcut(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); return; }

  if (
    e.key.toLowerCase() === "f" &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey &&
    $("discovery").hidden &&
    !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)
  ) {
    e.preventDefault();
    void toggleFullscreen().catch(() => {});
    return;
  }
  if (e.key === "Escape") {
    if (!$("speedMenu").hidden) { closeSpeedMenu(); $("speed").focus(); return; }
    if (selected) { closeLookup(); return; }
    if (netflix && document.body.classList.contains("netflixFocus")) { e.preventDefault(); toggleFullscreen(); return; }
    if (document.fullscreenElement) {
      e.preventDefault();
      void document.exitFullscreen();
      return;
    }
    closeLookup();
    return;
  }
  if (
    ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) ||
    e.metaKey ||
    e.ctrlKey ||
    $("panel").open ||
    !$("discovery").hidden
  )
    return;
  if (e.code === "Space" || e.key.toLowerCase() === "k") {
    e.preventDefault();
    $("play").click();
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    skip(-1);
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    skip(1);
  } else if (e.key.toLowerCase() === "r" && !e.altKey && !e.shiftKey && !e.repeat && !e.isComposing && !e.target.closest?.('[contenteditable="true"]')) {
    e.preventDefault(); replaySubtitle();
  } else if (e.key.toLowerCase() === "j") skip(-1);
  else if (e.key.toLowerCase() === "l") skip(1);
});
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length) void importMedia(e.dataTransfer.files[0]);
});
const subtitleBoundary = ImmersedSubtitlePlayback.createBoundary();
let subtitlePauseCue = null, boundarySource = null;
let last = 0, lastPlayingState = null;
function tick(t) {
  if (t - last > 100 && document.visibilityState !== "hidden" && $("discovery").hidden) {
    last = t;
    const sourceKey = source ? source.type + ":" + source.id : null;
    if (sourceKey !== boundarySource) { boundarySource = sourceKey; subtitleBoundary.reset(); subtitlePauseCue = null; }
    if (playing()) subtitlePauseCue = null;
    const finished = subtitleBoundary.update({time: currentTime(), playing: playing(),
      enabled: extras.pauseAfterSubtitle && !!source && (!netflix || netflix.fullTrack) && !selected,
      cues, rate: extras.playbackRate});
    if (finished) { pause(); subtitlePauseCue = finished; cueIndex = -1; }
    if (source && playing() && t - lastPositionSave > 5000) {
      lastPositionSave = t;
      positions[source.type + ":" + source.id] = currentTime();
      try {
        localStorage.setItem("immersed.positions", JSON.stringify(positions));
      } catch {}
    }
    void renderCue();
    scanCurrentVideoCaption(t);
    $("replay").disabled = !(lookupCue || netflix?.navigationCue?.cue || renderedCue);
    const isPlaying = playing();
    if (isPlaying !== lastPlayingState) { lastPlayingState = isPlaying; setPlayIcon(isPlaying); }
    if (pendingSeek && youtube?.getPlayerState) {
      seekTo(pendingSeek);
      pendingSeek = 0;
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
api("desktop/levels")
  .then((data) => {
    levels = data;
    cueIndex = -1;
    void renderCue();
  })
  .catch(() => status("Level data unavailable.", true));
applyPreferences();

for (const [id, label, icon] of [
  ["discoverButton", "Discover", "discover"], ["watchButton", "Watch", "watch"],
  ["netflixButton", "Netflix", "netflix"],
  ["openFile", "Open file", "folder"], ["libraryButton", "Library", "library"],
  ["wordsButton", "Words", "words"], ["settingsButton", "Settings", "settings"],
  ["fullscreen", "Video fullscreen", "fullscreen"], ["closeLookup", "Close lookup", "close"],
  ["closePanel", "Close panel", "close"], ["speak", "Pronounce", "sound"],
  ["refreshDiscovery", "Refresh", "refresh"],
]) decorateButton($(id), label, icon);
decorateButton($("search").querySelector("button"), "Search", "search");

const divider = $("studyDivider");
function applyPaneShare(value) {
  const pane=$("watchPage"), style=getComputedStyle(pane), available=pane.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)-24;
  const min=available>=560?Math.max(.3,280/available):.3,max=available>=560?Math.min(.7,1-280/available):.7;
  extras.paneShare=Math.max(min,Math.min(max,Number(value)||.6));
  $("watchPage").style.setProperty("--video-share",String(extras.paneShare));
  divider.setAttribute("aria-valuenow",String(Math.round(extras.paneShare*100)));
  if (selected) positionLookup();
}
applyPaneShare(extras.paneShare);
window.addEventListener("resize",()=>applyPaneShare(extras.paneShare));
let resizeFrame = null, resizeValue = extras.paneShare;
divider.onpointerdown = event => { if(event.button!==0)return;divider.setPointerCapture(event.pointerId);event.preventDefault(); };
divider.onpointermove = event => {
  if(!divider.hasPointerCapture(event.pointerId))return;
  const rect=$("watchPage").getBoundingClientRect(),style=getComputedStyle($("watchPage"));
  const left=rect.left+parseFloat(style.paddingLeft),available=rect.width-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)-24;
  const ratio=(event.clientX-left)/available;resizeValue=ratio;
  if(resizeFrame!==null)cancelAnimationFrame(resizeFrame);
  resizeFrame=requestAnimationFrame(()=>{applyPaneShare(ratio);resizeFrame=null;});
};
divider.onpointerup = event => { if(divider.hasPointerCapture(event.pointerId))divider.releasePointerCapture(event.pointerId);if(resizeFrame!==null){cancelAnimationFrame(resizeFrame);resizeFrame=null;applyPaneShare(resizeValue);}persist(); };
divider.onpointercancel = divider.onpointerup;
divider.onkeydown = event => {
  if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
  event.preventDefault();event.stopPropagation();applyPaneShare(event.key==="Home"?.3:event.key==="End"?.7:extras.paneShare+(event.key==="ArrowLeft"?-.02:.02));persist();
};
