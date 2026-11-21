(function (root) {
  "use strict";
  function createBoundary() {
    let previous = null, armed = null, completed = null;
    const key = cue => JSON.stringify([cue.start, cue.end, cue.text]);
    function reset() { previous = armed = completed = null; }
    function update({ time, playing, enabled, cues, rate = 1 }) {
      if (!enabled || !Number.isFinite(time)) { reset(); return null; }
      if (!playing) { previous = null; armed = null; return null; }
      const jump = previous !== null && (time < previous - .05 || time - previous > Math.max(1, rate * .75));
      if (jump) reset();
      const ended = armed && previous !== null && previous < armed.end && time >= armed.end;
      previous = time;
      if (ended) {
        const cue = armed; completed = key(cue); armed = null;
        return cue;
      }
      const cue = armed && armed.start <= time && time < armed.end ? armed : cues.findLast(c => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start && c.start <= time && time < c.end);
      armed = cue && key(cue) !== completed ? cue : null;
      return null;
    }
    return { update, reset };
  }
  // Keep a line readable briefly after its timed end, but never show it over
  // the next line or across an explicit clear in the source caption track.
  function readableIndex(cues, time, rate = 1) {
    if (!Number.isFinite(time)) return -1;
    const active = cues.findLastIndex((cue, i) => cue.start <= time && time < cue.end && (!cues[i + 1] || cues[i + 1].start > time));
    if (active >= 0) return active;
    const previous = cues.findLastIndex(cue => cue.start <= time);
    if (previous < 0) return -1;
    const cue = cues[previous], next = cues[previous + 1];
    const grace = Math.min(2.4, 1.6 * Math.max(.5, Number(rate) || 1));
    return !cue.hardEnd && time >= cue.end && time < Math.min(cue.end + grace, next?.start ?? Infinity) ? previous : -1;
  }
  const api = { createBoundary, readableIndex };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ImmersedSubtitlePlayback = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
