# macOS reliability validation

The audit reviewed `8d11a2e25b3456f6e006430ccf4f6dfbadf78bf2`. The measured baseline was the current default branch at `a79365c2af66b661a2495cb601bb134a5d2ec104`, which already includes the merged Atlas mark. There were no open PRs at the start. The comparison used a separate baseline worktree and isolated candidate branch. The edition stayed at 0.22.13 during development.

## Measurements

Measured on a MacBook Pro `MacBookPro18,3`, Apple M1 Pro, 16 GiB RAM, arm64, macOS 27.2.1 (26B131), Node 26.13.1. The startup probe used a temporary launch home, loopback on a spare port, and APFS copy-on-write for warm dependencies/dictionary assets. It did not modify the installed app or its data. Timings are local observations, including launch and probe overhead.

| Probe | Default branch | Candidate |
| --- | ---: | ---: |
| Warm launcher to study, study script and Library API responses | 1,955 ms | 219 ms |
| Warm paired Chromium launcher to opening Library | 684 ms | 270 ms |
| Paired Chromium run, Node RSS about one second after opening Library | 889,664 KiB | 85,120 KiB |
| Idle transcript requests in a one-second quiet window | 0 | 0 |
| Transcript requests in ten seconds of visible, unchanged preparation | 28 | 5 |
| Transcript requests in ten seconds after hiding the study page | 28 | 0 |

The paired browser run started Chromium before starting the service, opened Library through the real controls, and intercepted only synthetic transcript progress and external browser traffic. It counted GET and PUT observations, excluding the one POST that started the job. Settings and media were empty. The warm RSS sample covers the Node service before any dictionary lookup, so some memory and CPU work has moved to first lookup. It does not establish peak memory, battery impact, or real subtitle accuracy.

For the offline sample the probe blocked HTTPS with a closed loopback proxy and started with warm JavaScript dependencies and missing dictionary assets. The default branch exited after 706 ms without serving the shell. The candidate served the shell at 169 ms, recorded a failed setup at 1,426 ms after launch following an explicit dictionary request, and still answered the shell request. The failure timestamp includes a one-second probe wait before requesting the setup.

For the native cold smoke, a staged arm64 ad-hoc bundle loaded the AppKit/WKWebView study shell at 1,938 ms from an empty isolated data directory. The test checked the Library API, confirmed that setup reported its resources still needed, then terminated the test host process and observed its owned server stop. The earlier app remained running on its normal port. Browser visibility tests exercise the native visibility callback with synthetic media and don't measure an AppKit window minimizing during live video.

## Reproduction and release

From the candidate checkout:

```sh
npm ci
npm ci --prefix desktop
npm run version:check
npm run test:mac:node
python3 -m unittest tests/test_mac_quality.py tests/test_mac_transcribe.py tests/test_mac_web_session.py tests/test_mac_focus.py tests/test_mac_install.py
./node_modules/.bin/playwright test --config playwright.mac.config.ts --retries=1
python3 .agent-tools/run.py requirements
```

The final run passed 71 Node tests, 17 Python tests and 164 Chromium/WebKit tests (the browser command used `--retries=1`, and all 164 passed on their first attempt). The old one-shot computed-style assertion could reproduce its detached-node race on the default branch. The updated assertion waits for the same style on the replacement element. The browser suite needs the pinned public dictionary fixtures or a compatible installed Atlas database copied into the ignored `.data` test directory. Reproduce warm/cold measurements with `/bin/sh desktop/launch.sh "$PWD" --service`, separate ports and temporary homes. A useful-shell sample waits for `/`, `/study.js`, and `/api/desktop/library`. Sample Node RSS with `ps -o rss= -p PID` after the Library opens. For paired polling use a stable synthetic response with status `processing` and count transcript requests over equal visible and hidden intervals. Keep the source pinned and identical across repetitions except for the candidate diff.

Build and package checks ran locally. An ad-hoc DMG and Homebrew source archive were built with `/bin/sh desktop/build-dmg.sh "$scratch"`. Both SHA-256 files checked, the tar archive contained the new runtime and attribution, and `hdiutil verify` passed. The staged Mach-O was arm64. A read-only mount verified the enclosed app’s identifier, development channel and code-signature integrity. That evidence is for the development package.

Native staging used `IMMERSED_APPLICATIONS_DIR="$scratch" IMMERSED_BUNDLE_RUNTIME=1 /bin/sh desktop/install-app.sh` and `codesign --verify --deep --strict "$scratch/immersed.app"`. A second native install removed a deliberately obsolete resource. Installer fixtures also exercised wrong identity, failed rename, failed final verification, signature rejection and recovery from an interrupted backup. The native smoke used the staged app binary with an isolated `IMMERSED_APP_HOME` and spare `IMMERSED_MAC_PORT`.

Release readiness is separate from these checks. The updater verifies the official repository, stable tag, exact channel asset and published SHA-256 metadata. The direct channel also requires the publisher's signed/notarized release declaration. Use `Distribution: Developer ID signed and notarized.` only after verifying the release artifact. The artifact is still subject to normal macOS signature and Gatekeeper checks. No installer runs automatically. This branch has no new Developer ID-signed/notarized artifact or release tag. Actual release staging still requires a versioned formula archive with its matching checksum, a verified signed and notarized download, and an upgrade smoke on that artifact.
