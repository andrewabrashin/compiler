# Compiler API

## Авторизация

Все запросы (кроме `/healthz`) требуют токен.

**Формат токена:** `md5(SECRET.expired_ms).expired_ms`

```js
function createToken(secret) {
  const t = Date.now() + 60_000; // действителен 60 секунд
  return `${md5(`${secret}.${t}`)}.${t}`;
}
```

- HTTP: заголовок `Authorization: Bearer <token>`
- WebSocket: query-параметр `?token=<token>`

---

## POST /execute

Запускает код и опционально прогоняет unit-тест.

### Тело запроса

| Поле | Тип | Описание |
|---|---|---|
| `compiler` | `string` | `python` / `js` / `ts` / `go` / `cpp` |
| `files` | `{ name, content }[]` | Исходные файлы. Вместо `content` можно передать `url` |
| `target_file` | `string` | Имя файла для запуска — автоматически строит команду |
| `command` | `string` | Альтернатива `target_file` — произвольная shell-команда |
| `stdin` | `(string\|number)[]` | Строки подаются на stdin через `\n` |
| `libraries` | `string[]` | Пакеты для установки перед запуском |
| `project` | `bool` | Установить зависимости из `requirements.txt` / `package.json` |
| `unit_test` | `string` | JS-код unit-теста, выполняется после запуска |
| `code_reference` | `string` | Эталонный код для `unit_test` (по умолчанию = код студента) |
| `raw_errors` | `bool` | Не обрабатывать stderr через локализатор |
| `use_llm_fallback` | `bool` | Использовать LLM для локализации ошибок |

`target_file` и `command` взаимозаменяемы. При наличии `target_file` команда строится автоматически:

| compiler | команда |
|---|---|
| `python` | `python "main.py"` |
| `js` | `node "main.js"` |
| `ts` | `tsc && node "main.js"` |
| `go` | `go run "main.go"` |
| `cpp` | `g++ -pipe -O2 -static -o main "main.cpp" && ./main` |

### Пример запроса

```js
fetch('https://compiler.1t.ru/execute', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${createToken(SECRET)}`,
  },
  body: JSON.stringify({
    compiler: 'python',
    target_file: 'main.py',
    files: [{ name: 'main.py', content: 'x = int(input())\nprint(x * 2)' }],
    stdin: [21],
  }),
});
```

### Ответ без `unit_test`

```json
{
  "run": {
    "exit_code": 0,
    "stdout": "42",
    "stderr": "",
    "stdin": 1,
    "duration": 312
  }
}
```

### Ответ с `unit_test`

```json
{
  "run": { "exit_code": 0, "stdout": "42", "stderr": "", "duration": 312 },
  "test": {
    "passed": true,
    "checkList": [
      { "message": "Результат верный", "value": true, "score": 1 }
    ]
  }
}
```

### Коды ответа

| Код | Причина |
|---|---|
| `200` | OK |
| `400` | Недопустимое имя библиотеки |
| `401` | Невалидный или просроченный токен |
| `403` | Запрещённая конструкция в коде (security filter) |
| `429` | Превышен лимит одновременных сессий |
| `500` | `COMPILER_SECRET` не задан на сервере |

---

## WebSocket /console

Интерактивная консоль — двусторонний обмен данными в реальном времени.

**Подключение:** `wss://compiler.1t.ru/console?token=<token>`

### Протокол клиент → сервер

| Сообщение | Описание |
|---|---|
| `{ type: "start", compiler, files, target_file?, command?, interactive?, libraries?, project? }` | Первое сообщение — запускает процесс |
| `{ type: "stdin", data: "42\n" }` | Отправить данные на stdin |
| `{ type: "eof" }` | Закрыть stdin (аналог Ctrl+D) |
| `{ type: "kill" }` | Принудительно завершить процесс |

### Протокол сервер → клиент

| Сообщение | Описание |
|---|---|
| `{ type: "stdout", data: "..." }` | Вывод программы |
| `{ type: "stderr", data: "..." }` | Ошибки / диагностика |
| `{ type: "exit", code: 0, duration: 312 }` | Процесс завершён |
| `{ type: "error", message: "..." }` | Ошибка до запуска (валидация) |

### Пример

```js
const t = Date.now() + 60_000;
const token = `${md5(`${SECRET}.${t}`)}.${t}`;

const ws = new WebSocket(`wss://compiler.1t.ru/console?token=${token}`);

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'start',
    compiler: 'python',
    files: [{ name: 'main.py', content: 'print(int(input()) * 2)' }],
    target_file: 'main.py',
  }));
};

ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.type === 'stdout') console.log(msg.data);
  if (msg.type === 'exit') ws.close();
};

// отправить stdin после старта
ws.send(JSON.stringify({ type: 'stdin', data: '21\n' }));
```

---

## GET /healthz

Проверка доступности. Авторизация не требуется.

```json
{ "ok": true }
```
