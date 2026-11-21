# Lookup and contrast audit — 0.22.10

## User reports and ownership

- `言いやがって`: morphology incorrectly chose 嫌がる. The app now validates the continuative verb + contemptuous auxiliary against dictionary verb classes and keeps the original caption glyphs.
- `やっとかなきゃいけねえ`: app normalization now recovers やる with preparatory and obligation grammar. This does not require an invented dictionary entry.
- `筋 通しに行くんだよ`: the original caption’s space and purpose stem blocked the attested expression 筋を通す. Context matching now bridges whitespace, validates the expression against the dictionary, and gives the sense selector expression choices rather than unrelated literal senses of 筋.
- `無に帰す` / `無に帰した`: normalize to attested special-class suru expression 無に帰する. Unrelated godan verbs retain their normal entries.
- `ノリのいい`: exact expression lookup was correct, but Atlas English fallback included flattened tags, linked-entry text and duplicated forms. Prefer clean structured glosses when available and retain attribution. Upstream handoff: https://github.com/Somamill/kotoba-atlas/issues/5 . The best contextual sense still depends on the full sentence.
- `隠密局`: complete named-organization coverage is absent; components are present. Do not invent an established translation. Names-data handoff with publisher evidence: https://github.com/Somamill/kotoba-atlas/issues/6 .

## Responsiveness

The frontend previously waited for dictionary retrieval and then another fixed 160 ms before starting context selection. It now starts both independently, shares in-flight requests and retains ready results for identical contexts. Errors and model-preparation responses remain retryable. Dictionary update clears the client context cache. Server cache version advances to exclude old candidate sets.

Subtitle analysis no longer awaits complete dictionary prefetch; the line becomes interactive and a bounded set of definitions warms asynchronously. Chrome DevTools on the local test server measured a first dictionary request at 227 ms, followed by three cached requests at 1 ms each. This diagnostic is not a whole-app or model-inference benchmark. An 8-second native Time Profiler capture was collected, but it did not establish a fullscreen transition speed improvement. The fullscreen player is positioned directly within the fullscreen container rather than participating in grid sizing. System fullscreen animation remains owned by WebKit/macOS.

Technical grammar labels are off by default and available through Settings → Dictionary grammar details. The top indicator shows one conservative sampled-coverage percentage; uncertainty and explicit versus level-assumed familiarity remain in its accessible description and Words details.

## Readability

White video subtitles use a dark glyph outline and inherited shadow in both players, including readings. The subtitle container stays transparent. Rendered regression evidence uses a fully white image; no opaque caption rectangle is used.

## References consulted

- Netflix subtitle appearance, including shadow controls: https://help.netflix.com/en/node/100267
- Layout cost and avoiding repeated read/write layout cycles: https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing
- WebKit element fullscreen moves the WKWebView out of the app hierarchy: https://developer.apple.com/documentation/webkit/wkpreferences/iselementfullscreenenabled
- MLX-LM prompt caching: https://github.com/ml-explore/mlx-lm . Model-prefix caching was considered but not introduced here; shared response caching and removal of serial waits are the smaller verified change.

Original captions and dictionary sense selection remain fallible. No full-episode linguistic accuracy claim is made.
