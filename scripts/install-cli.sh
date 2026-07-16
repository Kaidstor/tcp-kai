#!/usr/bin/env bash

set -euo pipefail

# Делает `tcp-kai` в PATH симлинком на CLI-бинарь (tcp-kai-cli) внутри
# установленного tcp-kai.app (модель VS Code: обновление приложения через
# updater обновляет и CLI).
# Использование:
#   ./scripts/install-cli.sh                     — ищет приложение в /Applications и ~/Applications
#   ./scripts/install-cli.sh /path/to/tcp-kai.app

LINK="${TCP_KAI_LINK:-$HOME/.cargo/bin/tcp-kai}"

if [ $# -ge 1 ]; then
  APP="$1"
else
  for candidate in "/Applications/tcp-kai.app" "$HOME/Applications/tcp-kai.app"; do
    if [ -d "$candidate" ]; then
      APP="$candidate"
      break
    fi
  done
  if [ -z "${APP:-}" ]; then
    echo "ERROR: tcp-kai.app не найден в /Applications и ~/Applications." >&2
    echo "Установите приложение из релиза (или укажите путь аргументом) и повторите." >&2
    exit 1
  fi
fi

BIN="$APP/Contents/MacOS/tcp-kai-cli"
if [ ! -x "$BIN" ]; then
  echo "ERROR: в бандле нет CLI: $BIN" >&2
  echo "Нужна версия приложения, собранная с sidecar tcp-kai-cli (release.sh с externalBin)." >&2
  exit 1
fi

# Проверяем, что бинарь запускается, до того как трогать текущий симлинк
"$BIN" --version >/dev/null

LINK_DIR="$(dirname "$LINK")"
if [ ! -d "$LINK_DIR" ]; then
  echo "ERROR: каталога $LINK_DIR нет — создайте его или задайте TCP_KAI_LINK." >&2
  exit 1
fi

ln -sf "$BIN" "$LINK"
echo "✓ $LINK → $BIN"
echo "  ($("$LINK" --version))"

case ":$PATH:" in
  *":$LINK_DIR:"*) ;;
  *) echo "  ⚠ $LINK_DIR не в PATH — добавьте его, иначе команда tcp-kai не найдётся" >&2 ;;
esac
