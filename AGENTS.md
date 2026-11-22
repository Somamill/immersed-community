# Immersed community edition

This repository owns the direct-download Apple Silicon Mac app, Homebrew formula, and local Node/Python runtime. Treat its source, issues, and releases as public. Never copy private Store app source, metadata drafts, signing credentials, or test evidence into this repository.

Use the [dot. brand kit](https://github.com/Somamill/dot-brand-kit) and pinned requirements. Run `python3 .agent-tools/run.py requirements` before changing shared standards. The private Store apps release independently. Preserve the community bundle ID and local data paths. Use the public [support guidance](SUPPORT.md) and [Store privacy policy](STORE-PRIVACY.md) for public links.

## Local development and release

Use Node 24 or newer, `npm ci`, and `npm ci --prefix desktop`. Run `npm run version:check`, `npm run test:mac:node`, and the applicable native, Python, and browser checks. Build the DMG and formula source archive with `sh desktop/build-dmg.sh <output-directory>`. Maintain matching version notes, Homebrew URL and checksum, and signed artifacts. Run signing and notarization through the existing unattended release Keychain setup. Check the actual artifact before publishing. GitHub Actions stay disabled.

The dictionary mark in Settings and About is bundled from `products/kotoba-atlas.svg` in the dot. brand kit.
