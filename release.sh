#!/usr/bin/env bash

set -euo pipefail

# Включить отладочный вывод: DEBUG=1 ./release.sh …
DEBUG=${DEBUG:-0}
if [[ "$DEBUG" == "1" ]]; then
  set -x
fi

# Локальное «CI»: κάνем релиз без GitLab CI/CD, всё – у вас на машине.
# Требования:
#   - tauri (CLI) в PATH
#   - bun или npm/yarn
#   - jq, curl
#   - GITLAB_TOKEN экспортирован в окружении
#   - проект уже имеет релиз по тегу v<old>, мы создадим новый


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

echo "> Обновляем версии…"
npm pkg set version="$NEW_VER"

# macOS-совместимое обновление tauri.conf.json
tmp=$(mktemp)
jq --arg v "$NEW_VER" '.version = $v' src-tauri/tauri.conf.json > "$tmp" \
  && mv "$tmp" src-tauri/tauri.conf.json

git add package.json src-tauri/tauri.conf.json
git commit -m "release: ${TAG}"

echo "> Создаём Git-тег $TAG"
git tag "$TAG"
git push origin "$TAG"

echo "> Создаём релиз $TAG"
RELEASE_CREATION_RESP=$(curl -s --request POST \
  --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  --header "Content-Type: application/json" \
  --data "{\"name\":\"Release $TAG\",\"tag_name\":\"$TAG\",\"description\":\"Release $TAG\"}" \
  "$API/projects/$PROJECT_ID/releases")
echo "Release API response: $RELEASE_CREATION_RESP"


if [[ -z "${SKIP_BUILD:-}" ]]; then
  echo "> Устанавливаем deps и собираем…"
  bun install               # или npm install/yarn
  bunx tauri build  # --ci можно опустить
  echo "✔️  Сборка готова"
else
  echo "> SKIP_BUILD задан — пропускаем стадию сборки."
fi

# директория с bundle-артефактами
BUNDLE_DIR=src-tauri/target/release/bundle

echo "> Генерируем latest.json..."
# найдём первый tar.gz архив для подписи
TAR_ARCHIVE=$(find "$BUNDLE_DIR" -type f -name "*.tar.gz" | head -n1)
SIG_FILE="$TAR_ARCHIVE.sig"
# читаем подпись, удаляя переводы строк
SIG=$(tr -d '\n' < "$SIG_FILE")
# формируем URL загрузки артефакта
URL="https://gitlab.com/$NAMESPACE/$PROJECT/-/releases/permalink/$TAG/downloads/$(basename "$TAR_ARCHIVE")"
# создаём манифест
cat > "$BUNDLE_DIR/latest.json" <<EOF
{
  "version": "$NEW_VER",
  "notes": "",
  "pub_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "platforms": {
    "darwin-aarch64": {
      "url": "$URL",
      "signature": "$SIG"
    }
  }
}
EOF

# добавим в список для upload’а все нужные файлы:
BUNDLE_DIR=src-tauri/target/release/bundle
echo "> Собираем список артефактов текущей версии…"

BUNDLE_FILES=()
# Ищем все пригодные файлы, но берём только те,
# что содержат номер текущей версии $NEW_VER или latest.json
while IFS= read -r -d '' file; do
  name="$(basename "$file")"
  if [[ "$name" == *"$NEW_VER"* ]] || [[ "$name" == "latest.json" ]]; then
    BUNDLE_FILES+=("$file")
  fi
done < <(find "$BUNDLE_DIR" -type f \( \
        -name "*.dmg"        -o -name "*.tar.gz"       -o -name "*.tar.gz.sig" \
        -o -name "*.AppImage" -o -name "*.AppImage.sig" \
        -o -name "*.deb"     -o -name "*.deb.sig" \
        -o -name "*.msi"     -o -name "*.msi.sig" \
        -o -name "*.zip"     -o -name "*.zip.sig" \
        -o -name "latest.json" \) -print0)

echo "Найдено ${#BUNDLE_FILES[@]} файлов:"
printf '  %s\n' "${BUNDLE_FILES[@]}"

# 7) Заливаем каждый файл через Uploads API
for file in "${BUNDLE_FILES[@]}"; do
  echo "→ Upload: $file"
  RESP=$(curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
    --form "file=@$file" \
    "$API/projects/$PROJECT_ID/uploads")
  echo "Upload API response for $file: $RESP"
  # GitLab ≥17.1 возвращает .full_path, а более старые версии – .url
  URL=$(echo "$RESP" | jq -r '.full_path // .url')
  # Формируем абсолютный URL, который корректен для всех версий GitLab
  FULL_URL="https://gitlab.com${URL}"
  NAME=$(basename "$file")

  # 8) Привязываем к релизу asset-link
  echo "  → Link to release ${TAG}: $NAME"
  LINK_RESP=$(curl -s --request POST \
    --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
    --header "Content-Type: application/json" \
    --data "{\"name\":\"$NAME\",\"url\":\"$FULL_URL\",\"direct_asset_path\":\"/$NAME\"}" \
    "$API/projects/$PROJECT_ID/releases/$TAG/assets/links")
  echo "Link API response for $NAME: $LINK_RESP"

  echo "    ✓ $NAME"
  if [[ "$DEBUG" == "1" ]]; then
    echo "    ↪ Проверяем доступность:"
    echo "      HEAD $FULL_URL"
    curl -I -s "$FULL_URL" | head -n 1
    LINK_DL="https://gitlab.com/$NAMESPACE/$PROJECT/-/releases/${TAG}/downloads/$NAME"
    echo "      HEAD $LINK_DL"
    curl -I -s "$LINK_DL" | head -n 1
  fi
done

echo "✅ Релиз $TAG загружен и assets привязаны."
echo "Теперь любой клиент, у которого в endpoints стоит:"
echo "  https://gitlab.com/$NAMESPACE/$PROJECT/-/releases/permalink/latest/downloads/latest.json"
echo "при запуске получит обновление до $NEW_VER."