# CI/CD

## 1. Залогиньтесь (лучше через stdin, чтобы пароль не попал в history)

echo 'glpat-XXXXXXXXXXXX' | docker login registry.gitlab.com -u kaidstor --password-stdin

## 2. Задайте имя образа вручную

IMAGE=registry.gitlab.com/kaidstor/tcp_client_tauri/tauri-bun:latest

## 3. Соберите и пометьте образ этим тегом

docker build -t "$IMAGE" .

## 4. Запушьте

docker push "$IMAGE"
