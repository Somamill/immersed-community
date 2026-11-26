# Immersed community edition

This public repository owns the Apple Silicon AppKit/WebKit Mac app, localhost Node service, and local Python speech and context workers. Homebrew and direct releases share this source and version. The private narai. Store apps ship independently. Keep Store source, credentials, and review evidence outside this repository.

The native window and install entry points live in `desktop/NativeApp.swift`, `desktop/launch.sh`, `desktop/install-app.sh`, and `Formula/immersed-mac.rb`. The study UI and its shared credits are in `desktop/index.html`, `desktop/study.js`, `desktop/study.css`, `desktop/macos-app/credits/`, and `branding/dot/`. The community interface uses English. The learning language and Atlas definitions are independent of interface language.

The launcher serves immutable source from the installed app or development checkout. The service binds loopback and keeps the existing Host, Origin and write-header checks. User media, progress, optional resources and setup checkpoints stay under `~/Library/Application Support/Immersed Mac`. Model setup and app updates are separate from the dictionary updater. Checkpoints, corpora and dictionary files retain their published provenance and license notices. See [Mac guide](../docs/MACOS.md) and [reliability validation](../docs/MACOS-RELIABILITY.md).

Use Node 24+ with both npm installs, the project’s targeted Node/Python and Chromium/WebKit checks, and the native Swift build on Apple Silicon. Keep hosted Actions disabled. Verify the signed artifact at its intended destination and use the authorized release workflow before publication. An ad-hoc local build verifies development behavior. It provides no notarization evidence.
