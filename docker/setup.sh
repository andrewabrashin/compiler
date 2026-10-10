#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== 1. Собираем базовый образ ==="
docker build -f Dockerfile-core -t compiler.ru:core .

echo "=== 2. Устанавливаем npm-зависимости ==="
cd ../src
npm ci --omit=dev
cd "$SCRIPT_DIR"

echo "=== 3. Собираем и запускаем сервис ==="
docker compose up -d --build

echo "=== Готово. Сервис запущен на порту 3999 ==="
