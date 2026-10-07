# Сервис запуска кода

Принимает код студента, выполняет его в изолированной среде и возвращает результат. Используется для автоматической проверки заданий на платформе 1t.ru.

---

## Инфраструктура

```
[Клиент] ──HTTP──▶ [Node.js :3999] ──fork──▶ [bash → su student] ──▶ [python/node/go/g++]
```

### Docker-образы

Сборка двухэтапная: базовый образ собирается отдельно, основной — поверх него.

**`Dockerfile-core`** → образ `compiler.1t.ru:core`
- Базовый образ: `python:3.12` (Debian Bookworm)
- Доустанавливает: `golang`, `gcc/g++`, Node.js 22 LTS (через NodeSource)
- Глобально: `yarn`, `typescript`, `ts-node`, `@types/node`

**`Dockerfile`** → образ `compiler.1t.ru:latest`
- Поверх `:core` устанавливает Python-библиотеки: `numpy`, `pandas`, `torch`, `tensorflow`, `opencv`, `scikit-learn`, `matplotlib`, `aiohttp` и др.
- Создаёт пользователя `student` (UID 1001) — от его имени запускается код

### `docker-compose.yml`

| Параметр | Значение |
|---|---|
| Порт | `3999` |
| CPU limit | 6 ядер |
| Memory limit | 8 GB |
| Таймаут | `TIMEOUT=60` сек |
| Логи | `./data/log:/log` |
| Код сервера | `./data/src:/app:ro` (read-only) |
| Домашняя папка студента | `./data/student:/home/student` |

---

## Структура кода (`data/src/`)

```
launch.ts           — точка входа, Express-сервер
execute.ts          — обработчик /execute (запуск + unit-тест)
run.ts              — логика компиляции и запуска кода
testRun.ts          — логика запуска unit-тестов
helpers/
  checkForbiddenCode.ts  — фильтр запрещённых конструкций
  codeTester.ts          — класс CodeTesterClass для unit-тестов
  unitTestRunner.ts      — изолированный процесс запуска unit-тестов
  errorLocalizer.ts      — локализация ошибок на русский язык
  errorDataset/          — база данных описаний ошибок
  fetchFileContent.ts    — загрузка файла по URL
  writeToLog.ts          — запись логов
  killProcess.ts         — принудительное завершение процесса
```

---

## Эндпоинты

### `POST /execute`

Единственный рабочий эндпоинт. Выполняет код и опционально запускает unit-тест.

**Тело запроса:**
```json
{
  "files": [
    { "name": "main.py", "content": "print('hello')" },
    { "name": "data.txt", "url": "https://..." }
  ],
  "compiler": "python",
  "command": "python main.py",
  "target_file": "main.py",
  "libraries": ["numpy", "requests>=2.28"],
  "stdin": ["42", "hello"],
  "project": false,
  "raw_errors": false,
  "use_llm_fallback": false,
  "unit_test": "await tester.run(); tester.print('Сумма', tester.isEqual('3'));",
  "code_reference": "def add(a, b): return a + b"
}
```

Параметры:

- `files` — список файлов. Содержимое задаётся через `content` или загружается по `url`. Поля `before`/`after` позволяют дописать код вокруг пользовательского (для скрытых обёрток заданий).
- `compiler` — `python` / `js` / `ts` / `go` / `cpp`. Если не задан — определяется автоматически из `command`.
- `command` — shell-команда для запуска. Если задан `target_file`, команда генерируется автоматически.
- `target_file` — альтернатива `command`. Генерирует команду по типу компилятора:
  - `python` → `python "main.py"`
  - `js` → `node "index.js"`
  - `ts` → `tsc && node "index.js"`
  - `go` → `go run "main.go"`
  - `cpp` → `g++ -pipe -O2 -static -o main "main.cpp" && ./main`
- `libraries` — пакеты для установки перед запуском (`pip install` / `npm i`). Каждое имя валидируется по паттерну до попадания в shell.
- `stdin` — массив строк/чисел, подаётся в stdin процесса через `\n`.
- `project` — если `true`, перед запуском выполняет `pip install -r requirements.txt` или `npm install`.
- `raw_errors` — вернуть stderr как есть, без локализации.
- `use_llm_fallback` — использовать LLM для объяснения ошибок, если база данных не нашла совпадения.
- `unit_test` — JavaScript-код теста (async, имеет доступ к объекту `tester`). Если не задан — возвращается только `run`.
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
  "run": {
    "exit_code": 0,
    "stdout": "3",
    "stderr": "",
    "stdin": 0,
    "duration": 312
  },
  "test": {
    "passed": true,
    "check_list": [
      { "message": "Сумма", "value": true, "icon": "✅", "score": 0, "errorMessage": "" }
    ],
    "log": "3"
  }
}
```

---

### `POST /restart`

Перезапускает Node.js процесс (`process.exit(1)`, контейнер поднимает его заново благодаря `restart: always`).

Требует заголовок (если `RESTART_TOKEN` задан):
```
x-restart-token: <RESTART_TOKEN>
```

---

## Защита и rate limiting

### API-ключ (`API_KEY`)

Если `API_KEY` задан в env — все запросы к `/execute` должны передавать заголовок:
```
x-api-key: <API_KEY>
```

Запросы с `127.0.0.1` (внутренние вызовы `codeTester`) пропускаются без проверки.

Если `API_KEY` пустой — эндпоинт открыт (режим разработки).

### Rate limiting

По умолчанию: **30 запросов в минуту на IP**.

Для обхода лимита (массовая проверка заданий) передайте заголовок:
```
x-admin-key: <ADMIN_KEY>
```

Если `ADMIN_KEY` пустой — обход недоступен.

---

## Как выполняется код (`run.ts`)

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

Команда студента выполняется через цепочку:

```
Node.js (root)
  └─ bash -c "mkdir ... && chown ... && su - student -c '...'"
       └─ su - student
            └─ bash -c "ulimit && cd /tmp/temp-xxx && <команда>"
                 └─ python main.py  (или node / go / g++)
```

Ограничения через `ulimit`:

| ulimit | Python/C++/Go | JS/TS | Что ограничивает |
|--------|--------------|-------|-----------------|
| `-f 10240` | 10 MB | 10 MB | Максимальный размер создаваемых файлов |
| `-u 64` | 64 | 64 | Максимальное количество процессов |
| `-v` | 512 MB | 2 GB | Виртуальная память (Node.js/V8 требует ~1 GB для CodeRange) |

Аргумент `su -c` оборачивается в одинарные кавычки через `shellSingleQuote()` — исключает shell-инъекцию из поля `command`.

### Завершение процесса по таймауту

```typescript
// killProcess.ts
process.kill(-child.pid, 'SIGKILL')  // убивает всю группу процессов
```

Процесс порождается с `detached: true`, что создаёт новую группу. `kill(-pid)` посылает SIGKILL всем процессам группы.

---

## Как работает unit-тест и `CodeTesterClass`

### Архитектура

```
POST /execute  (с unit_test)
  │
  ├─ processRun()  — запускает код напрямую, возвращает run
  │
  └─ processTestRun()
       │
       ▼
  su - student -c "ulimit && node /app/helpers/unitTestRunner.js"
       │  (данные передаются через stdin как JSON)
       ▼
  unitTestRunner.js
  ├─ создаёт CodeTesterClass
  └─ vm.runInNewContext(unit_test, { tester })
       │
       ▼
       unit_test вызывает tester.run() → HTTP POST /execute (localhost)
                          tester.print('...', tester.isEqual('42'))
       │
       ▼
  собирает checkList → JSON в stdout → processTestRun → ответ клиенту
```

`unitTestRunner` запускается от имени `student` с теми же `ulimit`, что и обычный код. Даже если JavaScript-код теста вырвется из `vm`-контекста, он получит права `student`, а не root.

**Кодировка:** `su -` сбрасывает локаль до POSIX/C. Чтобы кириллица в строках unit-теста корректно прошла через V8 и вернулась в ответе:
- не-ASCII символы в исходном коде теста экранируются как `\uXXXX` перед `vm.runInNewContext`
- вывод сериализуется через `safeJson()`, который также экранирует не-ASCII в `\uXXXX`

### API класса `CodeTesterClass`

Объект `tester` доступен в `unit_test` как глобальная переменная.

**Управление кодом:**
```javascript
tester.setCode(code)          // установить код студента
tester.addCode('...')         // дописать в конец
tester.resetCode()            // вернуть к исходному
tester.setInput('1\n2\n3')    // установить stdin
tester.setLibraries('numpy')  // pip/npm пакеты
```

**Запуск:**
```javascript
await tester.run()            // запустить код студента
await tester.run(1, 2, 3)     // с stdin
await tester.runReference()   // запустить эталонный код
```

**Проверки результата:**
```javascript
tester.isEqual('42')          // stdout === '42' (без учёта регистра и пробелов)
tester.isContains('hello')    // stdout содержит строку
tester.isMatch(/\d+/)         // stdout совпадает с regex
tester.isMatchCode(/for/)     // код студента содержит конструкцию
tester.isKeywords('for if')   // код содержит все перечисленные ключевые слова
tester.isStructure()          // структура кода совпадает с эталоном
```

**Запись результата:**
```javascript
tester.print('Сообщение', tester.isEqual('42'), score=10)
// → добавляет в checkList { message, value, icon ✅/❌, score, errorMessage }
```

**Генерация тестовых данных:**
```javascript
tester.random(1, 100)               // случайное число
tester.randomString(5, 10)          // случайная строка
tester.randomArray(5, i => i * 2)   // массив [0,2,4,6,8]
tester.shuffleArray([1,2,3])        // перемешать массив
tester.randomOption('a', 'b', 'c')  // случайный элемент
```

### Пример unit_test

```javascript
for (const [a, b, expected] of [[1,2,3],[0,0,0],[-1,5,4]]) {
    tester.resetCode();
    tester.addCode(`\nprint(add(${a}, ${b}))`);
    await tester.run();
    tester.print(`add(${a}, ${b}) = ${expected}`, tester.isEqual(String(expected)));
}
```

---

## Локализация ошибок (`errorLocalizer.ts`)

Когда код завершается с ненулевым exit_code, stderr обрабатывается:

1. **`sanitizeStderr`** — убирает из сообщений внутренние пути (`/home/student/tests/temp-xxx/`).

2. **`localizeError`** — три уровня объяснения ошибки:

   ```
   stderr
     │
     ├─ parsePythonStderr()     — извлекает файл, строку, тип ошибки, текст
     ├─ translateMessage()      — переводит типовое сообщение на русский (~80 паттернов)
     ├─ extractErrorType()      — определяет тип ошибки (NameError, IndexError и т.д.)
     ├─ getErrorInfo()          — ищет в базе данных errorDataset/
     │    → title_ru, description, recommendations, correct_example
     │
     └─ queryLlm()              — если use_llm_fallback=true и LLM_API_URL задан
          → OpenAI-совместимый API, промпт для объяснения ошибки студенту
   ```

   Финальный ответ: `<исходный stderr>\n\n---\n\n<локализованное объяснение>`

---

## Безопасность

### Слои защиты

| Слой | Механизм |
|------|----------|
| Сетевой | `x-api-key` заголовок для внешних запросов |
| Частотный | Rate limit 30 req/min/IP, обход через `x-admin-key` |
| Shell | `shellSingleQuote()` — внешний bash не интерпретирует команду |
| Системный | `su - student` — код запускается не от root |
| Ресурсный | `ulimit` — ограничения файлов, процессов, памяти |
| Кодовый | `checkForbiddenCode` — блокировка опасных конструкций |
| Входной | Валидация `libraries` по паттерну `SAFE_LIB_RE` |

### Запрещённые конструкции

| Язык | Заблокировано |
|------|--------------|
| Python | `import subprocess`, `import pty`, `eval()`, `exec()` |
| JS/TS | `require()`, `import ... from 'fs/net/http/child_process'`, динамический `import('...')`, `eval()`, `process.exit/kill/env`, `process['exit'/'env']` |
| Go | `os/exec`, `net/http` |
| C++ | `system()`, `popen()`, `execl/execv()`, `fork()`, `socket()` |

### Переменные окружения

| Переменная | Назначение |
|------------|-----------|
| `API_KEY` | Ключ для `/execute`. Пустой = открытый доступ |
| `ADMIN_KEY` | Ключ обхода rate limit через `x-admin-key`. Пустой = обход недоступен |
| `RESTART_TOKEN` | Ключ для `/restart`. Пустой = без авторизации |
| `TIMEOUT` | Таймаут выполнения в секундах (default: 60) |
| `LLM_API_URL` | URL OpenAI-совместимого API для объяснения ошибок |
| `LLM_API_KEY` | Bearer-токен для LLM API |
| `LLM_MODEL` | Модель (например, `gpt-4o-mini`) |

---

## Логирование

Каждый запрос к `/execute` логируется в `/log/YYYY-MM-DD/report.log`:

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

Директория `/log` монтируется с хоста (`./data/log:/log`), логи сохраняются между перезапусками контейнера.
