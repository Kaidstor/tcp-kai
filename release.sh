#!/usr/bin/env bash
# Тонкая обёртка над общим релизным скриптом личных проектов —
# вся логика в ../_release/tauri-release.sh (версии, тег, GitHub-релиз,
# сборка app+dmg, updater-манифест, CLI-sidecar, аплоад артефактов).
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME=tcp-kai
# pnpm, не bun: в проекте поддерживается pnpm-lock.yaml (он и обновляется),
# pnpm-workspace.yaml с allowBuilds лежит в гите, а bun.lock заморожен с
# июля и разошёлся с package.json. С PM=bun релиз собирался бы по
# июльскому bun.lock и переписывал бы его.
PM=pnpm
FORGE=github
# автобамп Homebrew-каска (version/sha256 + push tap) после публикации
BREW_CASK=../homebrew-tap/Casks/tcp-kai.rb

source ../_release/tauri-release.sh
