#!/bin/sh
# Separate from speech dependencies; setup never blocks playback or word lookup.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
source_dir="$(pwd)"
cd "${IMMERSED_APP_HOME:-$source_dir}"
[ "$(uname -m)" = arm64 ] || exit 0
revision="${1:-$(shasum -a 256 "$source_dir/desktop/requirements-context.txt" | cut -d ' ' -f 1)}"
[ -x .venv-context/bin/python ] &&
  [ "$(cat .venv-context/.ready 2>/dev/null || true)" = "$revision" ] &&
  [ -f .data/context-model/model.safetensors ] && exit 0
if ! mkdir .context-setup-lock 2>/dev/null; then
  if [ -f .context-setup-lock/pid ] && kill -0 "$(cat .context-setup-lock/pid)" 2>/dev/null; then exit 0; fi
  rm -f .context-setup-lock/pid
  rmdir .context-setup-lock 2>/dev/null || exit 0
  mkdir .context-setup-lock 2>/dev/null || exit 0
fi
printf '%s' "$$" > .context-setup-lock/pid
trap 'rm -f .context-setup-lock/pid; rmdir .context-setup-lock' EXIT
trap 'exit 130' HUP INT TERM
if [ ! -x .venv-context/bin/python ]; then
  "${IMMERSED_PYTHON:-python3.13}" -m venv .venv-context
fi
.venv-context/bin/python -m pip install -r "$source_dir/desktop/requirements-context.txt"
.venv-context/bin/python -m pip check
HF_HUB_DISABLE_XET=1 .venv-context/bin/python "$source_dir/server/context_meaning.py" --prepare
printf '%s\n' "$revision" > .venv-context/.ready.tmp
mv .venv-context/.ready.tmp .venv-context/.ready
