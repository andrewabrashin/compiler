#!/bin/bash
set -e

echo "=== 1. Собираем базовый образ ==="
docker build -f Dockerfile-core -t compiler.ru:core .

echo "=== 2. Устанавливаем npm-зависимости ==="
cd data/src
npm ci --omit=dev
cd ../..

echo "=== 3. Собираем и запускаем сервис ==="
docker compose up -d --build

echo "=== Готово. Сервис запущен на порту 3999 ==="
