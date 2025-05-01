#!/usr/bin/env bash
set -euo pipefail

# если есть .env — подгружаем все переменные
if [ -f ".env" ]; then
  set -o allexport
  source .env
  set +o allexport
  echo "✅ Loaded .env"
fi

#
# Локальное «CI»: κάνем релиз без GitLab CI/CD, всё – у вас на машине.
# Требования:
#   - tauri (CLI) в PATH
#   - bun или npm/yarn
#   - jq, curl
#   - GITLAB_TOKEN экспортирован в окружении
#   - проект уже имеет релиз по тегу v<old>, мы создадим новый
#

# --- Настройки проекта: подправьте под себя ---
NAMESPACE="kaidstor"
PROJECT="tcp_client_tauri"
PROJECT_ID=56949495                # ваш GitLab Project ID
API="https://gitlab.com/api/v4"
RELEASE_BRANCH="main"              # куда пушим теги
# -------------------------------------------

if [ $# -ne 1 ]; then
  echo "Usage: $0 <new-version>  (например: 0.1.1)"
  exit 1
fi

NEW_VER=$1
TAG="v${NEW_VER}"
EXPORTS=()  # массив файлов для аплоада

echo "🎯  Релиз версии ${NEW_VER}"

# 1) Bump version в package.json и tauri.conf.json
echo "> Обновляем версии…"
npm pkg set version="$NEW_VER"

# macOS-совместимое обновление tauri.conf.json
tmp=$(mktemp)
jq --arg v "$NEW_VER" '.package.version = $v' src-tauri/tauri.conf.json > "$tmp" \
  && mv "$tmp" src-tauri/tauri.conf.json

git add package.json src-tauri/tauri.conf.json
git commit -m "release: ${TAG}"

# 2) Тэг и пуш
echo "> Создаём тег и пушим в ${RELEASE_BRANCH}…"
git tag "$TAG"
git push origin "$RELEASE_BRANCH" --follow-tags

# 3) Сборка
echo "> Устанавливаем deps и собираем…"
bun install               # или npm install/yarn
bunx tauri build   # --ci можно опустить
echo "✔️  Сборка готова"

# 4) Подписание (если нужно явно вызвать)
bunx tauri signer sign --no-dedupe \
  --key "$HOME/.tauri/app.pem" \
  --password "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" \
  --release-dir src-tauri/target/release/bundle

# 5) Генерация latest.json
echo "> Генерируем latest.json…"
bunx tauri updater json \
  --target src-tauri/target/release/bundle \
  --output dist/latest.json \
  --version "$NEW_VER"

# 6) Собираем список файлов для аплоада
mapfile -t BUNDLE_FILES < <(find src-tauri/target/release/bundle -type f \
  \( -name '*.dmg' -o -name '*.AppImage' -o -name '*.deb' -o -name '*.msi' \) )

# добавим и latest.json
BUNDLE_FILES+=(dist/latest.json)

echo "> Файлов для загрузки: ${#BUNDLE_FILES[@]}"

# 7) Заливаем каждый файл через Uploads API
for file in "${BUNDLE_FILES[@]}"; do
  echo "→ Upload: $file"
  RESP=$(curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
    --form "file=@$file" \
    "$API/projects/$PROJECT_ID/uploads")
  URL=$(echo "$RESP" | jq -r .url)
  NAME=$(basename "$file")
  FULL_URL="https://gitlab.com/$NAMESPACE/$PROJECT/uploads/${URL#*/}"

  # 8) Привязываем к релизу asset-link
  echo "  → Link to release ${TAG}: $NAME"
  curl -s --request POST \
    --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
    --header "Content-Type: application/json" \
    --data  "{\"name\":\"$NAME\",\"url\":\"$FULL_URL\"}" \
    "$API/projects/$PROJECT_ID/releases/$TAG/assets/links" >/dev/null

  echo "    ✓ $NAME"
done

echo "✅ Релиз $TAG загружен и assets привязаны."
echo "Теперь любой клиент, у которого в endpoints стоит:"
echo "  https://gitlab.com/$NAMESPACE/$PROJECT/-/releases/permalink/latest/downloads/latest.json"
echo "при запуске получит обновление до $NEW_VER."