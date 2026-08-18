#!/usr/bin/env bash
# Тонкая обёртка над общим релизным скриптом личных проектов —
# вся логика в ../_release/tauri-release.sh (версии, тег, GitHub-релиз,
# сборка app+dmg, updater-манифест, CLI-sidecar, аплоад артефактов).
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME=tcp-kai
PM=bun
FORGE=github
# автобамп Homebrew-каска (version/sha256 + push tap) после публикации
BREW_CASK=../homebrew-tap/Casks/tcp-kai.rb

source ../_release/tauri-release.sh
