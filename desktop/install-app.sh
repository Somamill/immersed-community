#!/bin/sh
set -eu

source_dir="${1:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"
applications_dir="${IMMERSED_APPLICATIONS_DIR:-$HOME/Applications}"
app_bundle="$applications_dir/immersed.app"
mkdir -p "$applications_dir"
staging_dir="$(mktemp -d "$applications_dir/.immersed-stage.XXXXXX")"
staged_bundle="$staging_dir/immersed.app"

cleanup() {
  rm -rf "$staging_dir"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

mkdir -p "$applications_dir" "$staged_bundle/Contents/MacOS" "$staged_bundle/Contents/Resources"
cp "$source_dir/desktop/macos-app/Info.plist" "$staged_bundle/Contents/Info.plist"
cp "$source_dir/desktop/NativeApp.swift" "$staging_dir/NativeApp.swift"
xcrun swiftc -parse-as-library -O -target arm64-apple-macos13.0 -framework Cocoa -framework WebKit -framework MediaPlayer -framework Vision "$staging_dir/NativeApp.swift" -o "$staged_bundle/Contents/MacOS/ImmersedMac"
cp "$source_dir/desktop/macos-app/ImmersedMac.icns" "$staged_bundle/Contents/Resources/ImmersedMac.icns"
cp "$source_dir/desktop/netflix.js" "$source_dir/desktop/netflix-bridge.js" "$staged_bundle/Contents/Resources/"
cp "$source_dir/desktop/player-bridge.js" "$staged_bundle/Contents/Resources/"
if [ "${IMMERSED_BUNDLE_RUNTIME:-0}" = 1 ]; then
  runtime="$staged_bundle/Contents/Resources/runtime"
  mkdir -p "$runtime"
  for directory in desktop server src assets scripts; do
    rsync -a --exclude node_modules --exclude __pycache__ --exclude .hallmark --exclude '* 2.*' --exclude .DS_Store "$source_dir/$directory" "$runtime/"
  done
  cp "$source_dir/package.json" "$source_dir/package-lock.json" "$source_dir/dictionary.json" "$runtime/"
  for file in README.md LICENSE THIRD_PARTY.md; do
    if [ -f "$source_dir/$file" ]; then cp "$source_dir/$file" "$runtime/"; fi
  done
fi
channel="${IMMERSED_INSTALL_CHANNEL:-development}"
if [ "${IMMERSED_BUNDLE_RUNTIME:-0}" = 1 ] && [ -n "${IMMERSED_SIGN_IDENTITY:-}" ]; then channel=direct; fi
printf '%s\n' "$channel" > "$staged_bundle/Contents/Resources/InstallChannel"
chmod 755 "$staged_bundle/Contents/MacOS/ImmersedMac"

version="$(node -p 'require(process.argv[1]).version' "$source_dir/package.json")"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" "$staged_bundle/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $version" "$staged_bundle/Contents/Info.plist"
verification=development
if [ -n "${IMMERSED_SIGN_IDENTITY:-}" ]; then
  verification=signed
  case "$IMMERSED_SIGN_IDENTITY" in
    "Developer ID Application:"*) ;;
    *) printf 'Direct distribution requires a Developer ID Application identity.\n' >&2; exit 1 ;;
  esac
  /usr/bin/codesign --force --options runtime --timestamp --sign "$IMMERSED_SIGN_IDENTITY" "$staged_bundle"
else
  /usr/bin/codesign --force --sign - "$staged_bundle"
fi

python_bin="$(command -v python3.13 || command -v python3)"
"$python_bin" "$source_dir/desktop/replace-app.py" "$staged_bundle" "$app_bundle" "$version" "$verification"

lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [ -z "${IMMERSED_APPLICATIONS_DIR:-}" ] && [ -x "$lsregister" ]; then
  "$lsregister" -f "$app_bundle" >/dev/null 2>&1 || true
fi

printf 'Installed %s\n' "$app_bundle"
