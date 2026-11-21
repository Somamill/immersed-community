# Mac video audit — 0.22.9 (2026-11-18)

Video: https://youtu.be/AnKu-KThJPE — 詩人・吉増剛造とは何者か【彗星読書ゼミ】, 75:07.

| Reproduced finding | Correction |
| --- | --- |
| The installed Mac app used YouTube automatic captions: 12,816 reveal frames, with a median duration of 0.181 seconds. These redrew phrases and made navigation extremely granular. | The Mac reading parser collapses progressive prefixes into 1,619 complete blocks. Original wording, explicit clears and source gaps remain. Existing caches migrate atomically with an original-file backup. |
| Independent phrases inherited the first sentence start through most of the video. | Only real append events inherit a sentence start. Complete reading blocks have independent seek targets. |
| Accurate mode returned YouTube automatic captions without running the selected local model. | Automatic tracks are bypassed in accurate mode; creator-authored Japanese tracks retain priority. |
| Both automatic captions and an unhinted large-v3 sample misspelled the poet’s name. | Local speech jobs receive bounded title/channel vocabulary hints, cleared between jobs. No name substitutions are hardcoded. |

The installed Mac player was observed playing this video before changes. Source JSON3 and its entire cached timeline were checked structurally. A 95-second opening-audio diagnostic using the cached MLX large-v3 model produced four exact mentions of the published name with title/channel hints, compared with none without hints. The hinted diagnostic took 26.12 seconds on this Mac. This is a small diagnostic, not a word-error-rate benchmark: other recognition mistakes remain, and the entire 75-minute recording was not independently transcribed and human-checked.

Regression coverage includes original/automatic track selection, cache backup/migration, source clears, independent repeated phrases, subtitle seek boundaries, bounded prompt context and clearing context between jobs. Existing local-speech caches and audiobook progress are retained.

---

# Subtitle and preview audit — 0.5.18

This checks the cloud preview, source-caption parser, cache, analysis/lookup, display and local recognition worker separately. Browser simulations do not establish physical-iPhone synchronization or successful live YouTube transcription.

## Fixed in this update

| Finding | Fix and verification |
| --- | --- |
| JSON3 per-word offsets were ignored, revealing words before their source time. | Rolling text updates respect `tOffsetMs`; their shared sentence start keeps previous/next controls at caption-unit boundaries. Windows and explicit clears are retained. |
| An append after an expired window could include an old sentence. | Appends reuse only a window still active at that time; exact-boundary continuation remains valid. |
| Window-only clears and malformed input were not handled safely. | Explicit window clears expire text. Invalid event/segment shapes are ignored, and malformed or out-of-order generated tracks are rejected. |
| Cache records lost creator/ASR/generated provenance and verified processing coverage. | Format 5 records source and generated coverage. Creator captions retain priority on repeat visits, and lower-priority writes cannot overwrite them. Old format-4 caches are invalidated; saved vocabulary is unchanged. |
| An exhausted or unusable track could block new live captions. | Fresh live captions may continue beyond known coverage; old text and verified interior gaps/silence do not become fallback captions. |
| Word analysis could stay failed until the sentence changed. | Two bounded automatic retries recover the same sentence; successful analysis clears its error. Original text remains visible during recovery. |

## Still not good enough

- **Captionless YouTube generation remains blocked here.** A fresh access check again returned the runtime proxy's `403 Forbidden`. No audio-access bypass, alternate extraction route, account import or paid service was added. Native Japanese tracks remain the useful path for this preview.
- **Recognition is still imperfect on real Japanese.** The local ReazonSpeech / Whisper Small / Kotoba comparison is rerun on the retained six public short clips. The manifest has provisional, unreviewed references, so its character-error figures are diagnostics rather than a trusted natural-conversation benchmark. It does not cover slang, overlapping speakers, poor microphones or the user's screenshots representatively.
- **Timing is not forced alignment.** Source offsets improve the source-caption path; recognizer timings can still be estimated. In particular, Kotoba uses character interpolation because its distributed alignment heads are incompatible with the runtime. A real recording plus independently checked word timings is needed to measure drift.
- **Three-model review is slow on CPU.** A fast first track is followed by incremental review. This is not guaranteed real-time recognition. The worker retains the preview's 30-minute / 150 MB source limit and a 15-minute job timeout.
- **Context plausibility is not what the speaker said.** The prior held-out count check recovered 146/500 synthetic homophone corruptions and abstained on 354; it also suggested one unwanted change on clean input. Source-caption suggestions remain explicit. Names, uncommon words and out-of-domain speech still need careful review.
- **The preview is temporary.** A supervisor can recover a process while the workspace runs. It cannot keep a stopped workspace online or preserve an Expo account tunnel URL after Expo replaces it. Open the latest printed address when an older one shows 502.

## Checks

The release runs lint, TypeScript, version consistency, all browser tests, dictionary/morphology checks, server validation and Python timing/consensus/decoder checks. New regression cases cover source word offsets, expired appends, window clears, malformed input, sentence skipping across rolling updates, cache provenance/coverage and same-sentence analysis recovery. The small-viewport three-row test, raw-glyph preservation and paused lookup/dictionary/settings behavior remain in the full suite.

Detailed language/recognizer findings: [SUBTITLE_QUALITY.md](SUBTITLE_QUALITY.md). Runtime setup: [DEVELOPMENT.md](DEVELOPMENT.md).

## Fresh local audio diagnostic

The retained 6 clips total 43.46 seconds and 139 normalized reference characters. This repeats the installed engines against the same provisional references; it is not a new natural-conversation test set.

| Engine / selection | Normalized character edits | Diagnostic CER | Model processing seconds |
| --- | ---: | ---: | ---: |
| reazon | 31 / 139 | 22.30% | 24.95 |
| whisper-small | 66 / 139 | 47.48% | 44.05 |
| kotoba | 44 / 139 | 31.65% | 106.90 |
| ensemble | 31 / 139 | 22.30% | 175.90 |

The context stage made 0 changes and retained 31 edits. Comparing three models did not beat the primary recognizer on this diagnostic. The roughly 4.0× audio-duration compute cost excludes additional request/queue overhead. These measurements identify unresolved accuracy and throughput problems; the UI/parser repairs do not establish a recognition-quality gain.

A modified-beam-search trial with four active paths produced 32 edits / 139 characters (23.02%), versus 31 / 139 (22.30%) for the existing greedy recognizer. It did not improve this small diagnostic and is not enabled. Processing times above include per-process model loading and reflect concurrent test load.
