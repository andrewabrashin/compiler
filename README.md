# Сервис запуска кода

Принимает код студента, выполняет его в изолированной среде и возвращает результат. Используется для автоматической проверки заданий на платформе 1t.ru.

---

## Инфраструктура

```
[Клиент] ──HTTP──▶ [Node.js :3999] ──fork──▶ [bash → su student] ──▶ [python/node/go/g++]
[Клиент] ──WS───▶ [Node.js :3999] ──fork──▶ [bash → su student] ──▶ [python -i / node -i]
```

### Структура проекта

```
compiler/
├── render.yaml          — конфигурация деплоя Render.com
├── API.md               — краткая справка по эндпоинтам
├── render/
│   ├── Dockerfile       — Render.com (полный: torch + tensorflow)
│   └── Dockerfile.slim  — Render.com (слим: без ML-библиотек)
├── docker/
│   ├── Dockerfile-core  — базовый образ: Python + Go + C++ + Node.js
│   ├── Dockerfile       — образ сервиса (поверх core)
│   ├── docker-compose.yml
│   ├── setup.sh         — первый запуск (сборка core + npm + compose up)
│   └── redeploy.sh      — обновление сервиса
└── src/                 — исходный код Node.js сервера
    ├── launch.js
    ├── execute.js
    ├── run.js
    ├── testRun.js
    ├── console.js
    ├── console-test.html
    └── helpers/
        ├── checkForbiddenCode.js
        ├── codeTester.js
        ├── unitTestRunner.js
        ├── errorLocalizer.js
        ├── errorDataset/
        ├── fetchFileContent.js
        ├── writeToLog.js
        └── killProcess.js
```

### Деплой на Render.com

Используется `render/Dockerfile.slim` (без torch/tensorflow, ~2 GB). Для полного образа с ML-библиотеками поменять в `render.yaml`:
```yaml
dockerfilePath: ./render/Dockerfile
```

### Локальный деплой

```bash
cd docker
./setup.sh      # первый запуск
./redeploy.sh   # обновление
```

Исходники монтируются как volume (`../src:/app:ro`), данные хранятся в `data/log/` и `data/student/`.

---

## Эндпоинты

### `POST /execute`

Выполняет код и опционально запускает unit-тест.

**Тело запроса:**
```json
{
  "files": [
    { "name": "main.py", "content": "print('hello')" },
    { "name": "data.txt", "url": "https://..." }
  ],
  "compiler": "python",
  "target_file": "main.py",
  "stdin": [42, "hello"],
  "libraries": ["numpy", "requests>=2.28"],
  "project": false,
  "raw_errors": false,
  "use_llm_fallback": false,
  "unit_test": "await tester.run(); tester.print('Сумма', tester.isEqual('3'));",
  "code_reference": "def add(a, b): return a + b"
}
```

Параметры:

- `files` — список файлов. `content` или `url`. Поля `before`/`after` дописывают код вокруг пользовательского (для скрытых обёрток заданий).
- `compiler` — `python` / `js` / `ts` / `go` / `cpp`. Определяется автоматически из `command` если не задан.
- `target_file` — альтернатива `command`. Генерирует команду по типу компилятора:
  - `python` → `python "main.py"`
  - `js` → `node "index.js"`
  - `ts` → `tsc && node "index.js"`
  - `go` → `go run "main.go"`
  - `cpp` → `g++ -pipe -O2 -static -o main "main.cpp" && ./main`
- `command` — произвольная shell-команда (если `target_file` не задан).
- `libraries` — пакеты для установки перед запуском (`pip install` / `npm i`). Валидируются по паттерну.
- `stdin` — массив строк/чисел, подаётся в stdin через `\n`.
- `project` — установить зависимости из `requirements.txt` / `package.json` перед запуском.
- `raw_errors` — вернуть stderr как есть, без локализации.
- `use_llm_fallback` — использовать LLM для объяснения ошибок если база данных не нашла совпадения.
- `unit_test` — JavaScript-код теста (async, доступен объект `tester`). Если не задан — возвращается только `run`.
- `code_reference` — эталонный код для `tester.isStructure()` и `tester.runReference()`.

**Ответ без unit_test:**
```json
{
  "run": {
    "exit_code": 0,
    "stdout": "hello",
    "stderr": "",
    "stdin": 0,
    "duration": 312
  }
}
```

**Ответ с unit_test:**
```json
{
  "run": { "exit_code": 0, "stdout": "3", "stderr": "", "duration": 312 },
  "test": {
    "passed": true,
    "check_list": [
      { "message": "Сумма", "value": true, "icon": "✅", "score": 10, "errorMessage": "" }
    ],
    "log": "3"
  }
}
```

---

### `WebSocket /console`

Интерактивная консоль — двусторонний обмен в реальном времени.

**Подключение:** `wss://host/console?token=<token>`

**Протокол клиент → сервер:**

| Сообщение | Описание |
|---|---|
| `{ type:"start", compiler, files, target_file?, command?, interactive?, libraries?, project? }` | Первое сообщение — запуск процесса |
| `{ type:"stdin", data:"42\n" }` | Отправить данные на stdin |
| `{ type:"eof" }` | Закрыть stdin (Ctrl+D) |
| `{ type:"kill" }` | Завершить процесс принудительно |

**Протокол сервер → клиент:**

| Сообщение | Описание |
|---|---|
| `{ type:"stdout", data:"..." }` | Вывод программы |
| `{ type:"stderr", data:"..." }` | Ошибки / диагностика |
| `{ type:"exit", code:0, duration:312 }` | Процесс завершён |
| `{ type:"error", message:"..." }` | Ошибка до запуска |

Таймаут: 60 сек для скриптов, 600 сек для интерактивного режима (`interactive: true`). Таймаут сбрасывается при каждом `stdin`.

---

### `POST /restart`

Перезапускает Node.js процесс. Контейнер поднимает его заново благодаря `restart: always`.

---

### `GET /healthz`

Проверка доступности. Авторизация не требуется.

```json
{ "ok": true }
```

---

### `GET /console-test`

Браузерный интерфейс для тестирования. Авторизация не требуется (страница открыта, запросы требуют токен).

---

## Авторизация

Все запросы (кроме `/healthz`, `/console-test`) требуют токен.

**Формат токена:** `md5(SECRET.expired_ms).expired_ms`

```js
function createToken(secret) {
  const t = Date.now() + 60_000; // истекает через 60 секунд
  return `${md5(`${secret}.${t}`)}.${t}`;
}
```

- HTTP: заголовок `Authorization: Bearer <token>`
- WebSocket: query-параметр `?token=<token>`

Токен действителен в течение 60 секунд после `expired_ms`. Запросы с `127.0.0.1` (внутренние вызовы `codeTester`) пропускаются без проверки по HTTP.

---

## Переменные окружения

| Переменная | Назначение |
|---|---|
| `COMPILER_SECRET` | Секрет для генерации и проверки токенов |
| `PORT` | Порт сервера (default: 3999) |
| `TIMEOUT` | Таймаут выполнения кода в секундах (default: 60) |
| `INTERACTIVE_TIMEOUT` | Таймаут интерактивной сессии в секундах (default: 600) |
| `MAX_SESSIONS` | Максимум одновременных WebSocket-сессий (default: 20) |
| `LLM_API_URL` | URL OpenAI-совместимого API для объяснения ошибок |
| `LLM_API_KEY` | Bearer-токен для LLM API |
| `LLM_MODEL` | Модель (например, `gpt-4o-mini`) |

---

## Как выполняется код

### Полный путь запроса

```
1. Валидация libraries (SAFE_LIB_RE)
2. Определение compiler (авто или из запроса)
3. Построение command (target_file / project / libraries)
4. Загрузка файлов (content или URL)
5. checkForbiddenCode → 403 если найдено
6. Создание temp-директории в /home/student/tests/temp-XXXXXX/
7. Запись файлов в temp-директорию
8. Запуск через bash → su - student
9. Ожидание с таймаутом, сбор stdout/stderr
10. Удаление temp-директории
11. sanitizeStderr (убирает внутренние пути из ошибок)
12. localizeError (если exit_code != 0)
13. Возврат JSON
```

### Изоляция процесса

```
Node.js (root)
  └─ bash -c "mkdir ... && chown ... && su - student -c '...'"
       └─ su - student
            └─ bash -c "ulimit && cd /tmp/temp-xxx && <команда>"
                 └─ python main.py  (или node / go / g++)
```

Ограничения через `ulimit`:

| ulimit | Python/C++/Go | JS/TS | Что ограничивает |
|---|---|---|---|
| `-f 10240` | 10 MB | 10 MB | Максимальный размер файлов |
| `-u 64` | 64 | 64 | Максимальное количество процессов |
| `-v` | 256 MB | 2 GB | Виртуальная память |

JS/TS получает 2 GB — Node.js/V8 резервирует ~1 GB под CodeRange при старте.

---

## Unit-тесты и `CodeTesterClass`

### Архитектура

```
POST /execute (с unit_test)
  ├─ processRun()      — запускает код студента, возвращает run
  └─ processTestRun()
       └─ su - student -c "node /app/helpers/unitTestRunner.js"
            ├─ читает { lang, code, unitTest } из stdin
            ├─ создаёт CodeTesterClass
            └─ vm.runInNewContext(unit_test, { tester })
                 └─ tester.run() → HTTP POST /execute (localhost, без авторизации)
```

`unitTestRunner` запускается от имени `student`. Даже если код теста вырвется из `vm`-контекста, он получит права `student`, а не root.

### API класса `CodeTesterClass`

**Управление кодом:**
```javascript
tester.setCode(code)           // установить код студента
tester.addCode('...')          // дописать в конец
tester.resetCode()             // вернуть к исходному
tester.setInput('1\n2\n3')    // stdin для следующего run()
tester.setLibraries('numpy')   // pip/npm пакеты
```

**Запуск:**
```javascript
await tester.run()             // запустить код студента
await tester.run(1, 2, 3)     // с аргументами stdin
await tester.runReference()    // запустить эталонный код
```

**Проверки:**
```javascript
tester.isEqual('42')           // stdout === '42' (без учёта регистра и пробелов)
tester.isContains('hello')     // stdout содержит строку
tester.isMatch(/\d+/)          // stdout совпадает с regex
tester.isMatchCode(/for/)      // код студента содержит конструкцию
tester.isKeywords('for if')    // код содержит все перечисленные слова
tester.isStructure()           // структура кода совпадает с эталоном
```

**Запись результата:**
```javascript
tester.print('Сообщение', tester.isEqual('42'), score=10)
// → { message, value, icon ✅/❌, score, errorMessage }
```

**Генерация тестовых данных:**
```javascript
tester.random(1, 100)
tester.randomString(5, 10)
tester.randomArray(5, i => i * 2)
tester.shuffleArray([1, 2, 3])
tester.randomOption('a', 'b', 'c')
```

### Пример unit_test

```javascript
for (const [a, b, expected] of [[1,2,3],[0,0,0],[-1,5,4]]) {
  tester.resetCode();
  tester.addCode(`\nprint(add(${a}, ${b}))`);
  await tester.run();
  tester.print(`add(${a}, ${b}) = ${expected}`, tester.isEqual(String(expected)), 10);
}
```

---

## Безопасность

### Слои защиты

| Слой | Механизм |
|---|---|
| Сетевой | HMAC-токен (`COMPILER_SECRET`) для внешних запросов |
| Файловый | `chmod -R o-rwx /app` — student не может читать исходники сервера |
| Shell | `shellSingleQuote()` — исключает shell-инъекцию из поля `command` |
| Системный | `su - student` — код запускается не от root |
| Ресурсный | `ulimit` — ограничения файлов, процессов, памяти |
| Кодовый | `checkForbiddenCode` — блокировка опасных конструкций |
| Входной | Валидация `libraries` по паттерну `SAFE_LIB_RE` |
| Сессионный | `MAX_SESSIONS` — глобальный лимит WebSocket-сессий |

### Запрещённые конструкции

| Язык | Заблокировано |
|---|---|
| Python | `import subprocess/pty`, `eval()`, `exec()`, `os.popen/system/exec/spawn`, `__import__()`, `importlib`, `ctypes` |
| JS/TS | `require()`, `import ... from 'fs/net/http/child_process'`, динамический `import()`, `eval()`, `process.exit/kill/env` |
| Go | `os/exec`, `net/http` |
| C++ | `system()`, `popen()`, `execl/execv()`, `fork()`, `socket()`, `pcap_` |

---

## Локализация ошибок

Когда код завершается с ненулевым exit_code:

1. **`sanitizeStderr`** — убирает внутренние пути (`/home/student/tests/temp-xxx/`).
2. **`localizeError`** — три уровня:
   - `translateMessage()` — переводит типовое сообщение (~80 паттернов)
   - `getErrorInfo()` — ищет в базе `errorDataset/` (title_ru, description, recommendations, correct_example)
   - `queryLlm()` — если `use_llm_fallback=true` и `LLM_API_URL` задан

---

## Логирование

Каждый запрос логируется в `/log/YYYY-MM-DD/report.log`:

```
# START
time: 2026-10-06T10:00:00.000Z
ip: 192.168.1.1
body: {"compiler":"python","files":[...]}
duration: 312
stdout: hello
stderr:
exit_code: 0
# END
```

На Render.com логи эфемерны (нет persistent disk). Локально монтируются в `data/log/`.
