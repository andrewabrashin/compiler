#!/bin/bash
set -e

echo "=== Обновляем сервис ==="
docker compose up -d --build --force-recreate

echo "=== Готово ==="