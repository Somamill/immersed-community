#!/bin/sh
set -eu
source_dir="${1:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"
app_home="${IMMERSED_APP_HOME:-$HOME/Library/Application Support/Immersed Mac}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ "${2:-}" = "--install-app" ]; then
  exec /bin/sh "$source_dir/desktop/install-app.sh" "$source_dir"
fi
if [ "${2:-}" != "--service" ]; then
  installed="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$HOME/Applications/immersed.app/Contents/Info.plist" 2>/dev/null || true)"
  version="$(node -p 'require(process.argv[1]).version' "$source_dir/package.json")"
  if [ "$installed" != "$version" ] || [ "$source_dir/desktop/NativeApp.swift" -nt "$HOME/Applications/immersed.app/Contents/MacOS/ImmersedMac" ]; then
    /bin/sh "$source_dir/desktop/install-app.sh" "$source_dir"
  fi
  open "$HOME/Applications/immersed.app"
  exit 0
fi
# Run immutable installed source and keep the existing data directories.
export IMMERSED_APP_HOME="$app_home"
export IMMERSED_DATA_ROOT="$app_home"
export IMMERSED_PYTHON="$app_home/.venv/bin/python"
export IMMERSED_CONTEXT_PYTHON="$app_home/.venv-context/bin/python"
cd "$source_dir"
exec node desktop/server.cjs
