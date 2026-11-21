# Immersed platform capabilities

| Workflow | Community Mac | iPhone / iPad App Store |
| --- | --- | --- |
| Install | [Signed Mac release and Homebrew source](https://github.com/Somamill/immersed-community/releases/latest) | [App Store](https://apps.apple.com/us/app/immersed-learn-japanese/id6834110293) |
| Find content | Japanese YouTube discovery with source, conversation and length filters | File picker and imported-media library |
| Watch | Official YouTube embedded player; Netflix in a separate provider view on compatible Macs; local video and audiobooks | Local unprotected video |
| Captions | Original creator or Netflix captions when accessible; local files and compatible embedded text tracks; on-device speech fallback for permitted audio | Import timed SRT or WebVTT; no speech generation |
| Study | Caption navigation, pointer lookup, saved words, and optional readings and pitch | Tap lookup, saved words, and caption navigation in the prepared 0.21.8 source |
| Definition languages | Kotoba Atlas English or German | Public 0.21.6 uses the original bundled edition; 0.21.8 source adds English/German choice |
| Learning and interface languages | Japanese study, English UI | Japanese study, English UI |
| Anki | Preview and export through AnkiConnect v1 in the new source | Add, configuration return, search and sync handoffs in the new source. Device acceptance pending. |

The public Store listing and the community preview serve different workflows. For a video that cannot embed or a provider track that cannot be read, study a permitted local video and subtitle file. The [YouTube embedded-player requirements](https://developers.google.com/youtube/terms/required-minimum-functionality) govern the community player. Its fullscreen study controls sit beside the player rectangle.

The Mac has an opt-in reader for the verified Atlas native SQLite prerelease. Mobile native-Atlas integration and broader learning-language adapters, reliable dictionary data across languages, and RTL checks remain open. Desktop Anki note creation, media, retry and safe updates passed against Anki 26.09.4 in a disposable profile. AnkiMobile requires actual device acceptance. No protected video frames or private study material are required for public screenshots.


## Verification before release

A 20-sample local loopback baseline on the M1 measured new-caption analysis at 2.04 ms p50 and 3.46 ms p95, cached analysis at 0.59 ms and 1.12 ms, and exact definitions at 3.53 ms and 7.36 ms. The first analysis, including dictionary startup, took 3.22 s. These are service-request timings from Japanese fixtures and the installed public dictionary. They do not establish end-to-end startup, live discovery or pointer latency improvements.

Resolver and geometry tests used browser fixtures plus an AppKit layout harness at four viewport heights. Physical external display and live Netflix verification remain open. The Store candidate compiled and launched on a dedicated iPhone simulator. A local URL receiver verified add-note, configuration, search and sync handoffs. It returned sample configuration and an add-note confirmation to Immersed. The Store localization, native device acceptance, and release presentation gates remain open, and the public binary is still 0.21.6.
