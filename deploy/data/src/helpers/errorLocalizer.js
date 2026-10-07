"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.localizeError = localizeError;
exports.sanitizeStderr = sanitizeStderr;
const path_1 = __importDefault(require("path"));
const index_1 = require("./errorDataset/index");
const LLM_API_URL = process.env.LLM_API_URL ?? '';
const LLM_API_KEY = process.env.LLM_API_KEY ?? '';
const LLM_MODEL = process.env.LLM_MODEL ?? '';
const DEFAULT_MESSAGE = [
    'Произошла ошибка выполнения.',
    '',
    'Причина: не удалось определить точный тип ошибки.',
    '',
    'Решение:',
    '— Проверьте синтаксис кода.',
    '— Убедитесь, что все переменные объявлены.',
    '— Проверьте правильность вызовов функций.',
].join('\n');
const TRAINER_PATTERNS = [
    [/\[Timeout\]/, '[Timeout]'],
    [/\[Memory\]/, '[Memory]'],
    [/\[Exception\]/, '[Exception]'],
];
const COMPILER_PATTERNS = {
    python: [
        ['(\\w*(?:Error|Warning|Exit))\\s*:', 'gm'],
        ['^(\\w*(?:Error|Warning|Exit))$', 'gm'],
    ],
    js: [['(\\w*Error)\\s*:', 'gm']],
    ts: [
        ['error\\s+TS(\\d+)', 'gm'],
        ['(\\w*Error)\\s*:', 'gm'],
    ],
    go: [
        ['syntax error', 'gm'],
        ['undefined:\\s+(\\w+)', 'gm'],
        ['(\\w+):\\s+cannot', 'gm'],
    ],
    cpp: [
        ['error:\\s+(.+?)(?:\\n|$)', 'gm'],
        ['undefined reference to', 'gm'],
    ],
};
const PYTHON_MSG_TRANSLATIONS = [
    [/name '(.+?)' is not defined\.?\s*(?:Did you mean.*)?/i, "имя '$1' не определено"],
    [/invalid syntax$/im, 'недопустимый синтаксис'],
    [/expected ':'/i, "ожидается ':'"],
    [/expected an indented block/i, 'ожидается блок с отступом'],
    [/unexpected indent/i, 'неожиданный отступ'],
    [/unindent does not match any outer indentation level/i, 'отступ не совпадает с внешним уровнем'],
    [/inconsistent use of tabs and spaces in indentation/i, 'смешивание табов и пробелов в отступах'],
    [/unterminated string literal/i, 'незакрытая строка'],
    [/EOL while scanning string literal/i, 'конец строки при сканировании строкового литерала'],
    [/closing parenthesis '(.+?)' does not match opening parenthesis '(.+?)'/i, "закрывающая скобка '$1' не совпадает с открывающей '$2'"],
    [/can only concatenate str \(not '(.+?)'\) to str/i, "можно сложить только str с str, а не str с '$1'"],
    [/unsupported operand type\(s\) for (.+?): '(.+?)' and '(.+?)'/i, "операция $1 не поддерживается для типов '$2' и '$3'"],
    [/'(.+?)' object is not callable/i, "объект типа '$1' нельзя вызвать как функцию"],
    [/'(.+?)' object is not iterable/i, "объект типа '$1' нельзя перебрать в цикле"],
    [/'(.+?)' object does not support item assignment/i, "объект типа '$1' не поддерживает изменение элементов"],
    [/'(.+?)' object has no attribute '(.+?)'/i, "у объекта типа '$1' нет атрибута '$2'"],
    [/list index out of range/i, 'индекс списка вне диапазона'],
    [/string index out of range/i, 'индекс строки вне диапазона'],
    [/tuple index out of range/i, 'индекс кортежа вне диапазона'],
    [/division by zero/i, 'деление на ноль'],
    [/integer division or modulo by zero/i, 'целочисленное деление или остаток от деления на ноль'],
    [/maximum recursion depth exceeded/i, 'превышена максимальная глубина рекурсии'],
    [/No module named '(.+?)'/i, "модуль '$1' не найден"],
    [/cannot import name '(.+?)' from '(.+?)'/i, "не удалось импортировать '$1' из '$2'"],
    [/invalid literal for int\(\) with base 10: '(.+?)'/i, "невозможно преобразовать '$1' в целое число"],
    [/invalid literal for float\(\): '(.+?)'/i, "невозможно преобразовать '$1' в число с плавающей точкой"],
    [/not enough values to unpack \(expected (\d+), got (\d+)\)/i, 'недостаточно значений для распаковки (ожидалось $1, получено $2)'],
    [/too many values to unpack \(expected (\d+)\)/i, 'слишком много значений для распаковки (ожидалось $1)'],
    [/missing (\d+) required positional arguments?: '(.+?)'/i, "не хватает $1 обязательных аргументов: '$2'"],
    [/takes (\d+) positional arguments? but (\d+) (?:was|were) given/i, 'функция принимает $1 позиционных аргументов, а передано $2'],
    [/(\w+) missing (\d+) required positional arguments?: '(.+?)'/i, "функция $1: не хватает $2 обязательных аргументов: '$3'"],
    [/(\w+) takes (\d+) positional arguments? but (\d+) (?:was|were) given/i, 'функция $1: принимает $2 позиционных аргументов, а передано $3'],
    [/keyword argument repeated/i, 'именованный аргумент передан повторно'],
    [/positional argument follows keyword argument/i, 'позиционный аргумент идёт после именованного'],
    [/local variable '(.+?)' referenced before assignment/i, "локальная переменная '$1' используется до присваивания"],
    [/cannot access local variable '(.+?)' where it is not associated with a value/i, "нет доступа к локальной переменной '$1' — ей не присвоено значение"],
    [/pop from an empty (set|list|dict)/i, 'pop из пустого $1'],
    [/No such file or directory: '(.+?)'/i, "файл или директория не найдены: '$1'"],
    [/Permission denied: '(.+?)'/i, "нет прав доступа: '$1'"],
    [/math domain error/i, 'аргумент вне допустимого диапазона'],
    [/math range error/i, 'результат слишком велик'],
    [/I\/O operation on closed file/i, 'операция ввода-вывода на закрытом файле'],
    [/pop index out of range/i, 'индекс pop вне диапазона'],
    [/empty separator/i, 'пустой разделитель'],
    [/unhashable type: '(.+?)'/i, "нехешируемый тип: '$1'"],
    [/cannot unpack non-iterable (.+?) object/i, 'нельзя распаковать неитерируемый объект типа $1'],
    [/a bytes-like object is required, not '(.+?)'/i, "требуется байтовый объект, а не '$1'"],
    [/argument of type '(.+?)' is not iterable/i, "аргумент типа '$1' не является итерируемым"],
    [/multiple values for argument '(.+?)'/i, "несколько значений для аргумента '$1'"],
    [/argument after \* must be an iterable/i, 'аргумент после * должен быть итерируемым'],
    [/argument after \*\* must be a mapping/i, 'аргумент после ** должен быть словарём'],
    [/invalid character in identifier/i, 'недопустимый символ в идентификаторе'],
    [/invalid escape sequence '(.+?)'/i, "недопустимая escape-последовательность '$1'"],
    [/invalid decimal literal/i, 'недопустимый десятичный литерал'],
    [/leading zeros in decimal integer literals are not permitted/i, 'ведущие нули в десятичных числах не допускаются'],
    [/cannot assign to (.+?) here/i, 'нельзя присвоить значение $1 здесь'],
    [/expected expression/i, 'ожидается выражение'],
    [/source code string cannot contain null bytes/i, 'исходный код не может содержать нулевые байты'],
    [/bad operand type for unary (.+?): '(.+?)'/i, "неверный тип операнда для унарного $1: '$2'"],
    [/bad operand type for abs\(\): '(.+?)'/i, "неверный тип операнда для abs(): '$1'"],
    [/argument must be a string.+?, not '(.+?)'/i, "аргумент должен быть строкой, а не '$1'"],
    [/descriptor '(.+?)' requires a '(.+?)' object but received a '(.+?)'/i, "метод '$1' требует объект '$2', а получен '$3'"],
    [/object is not subscriptable/i, 'объект не поддерживает обращение по индексу'],
    [/not all arguments converted during string formatting/i, 'не все аргументы использованы при форматировании строки'],
    [/unsupported format character/i, 'неподдерживаемый символ форматирования'],
    [/expected format character/i, 'ожидается символ форматирования'],
    [/replacement index (\d+) out of range/i, 'индекс подстановки $1 вне диапазона'],
    [/cannot mix positional and named arguments in f-string/i, 'нельзя смешивать позиционные и именованные аргументы в f-строке'],
    [/f-string: invalid syntax/i, 'f-строка: недопустимый синтаксис'],
    [/f-string: expressions in f-strings cannot contain newlines/i, 'f-строка: выражения не могут содержать переносы строк'],
    [/Did you mean: '(.+?)'/i, "Возможно, вы имели в виду: '$1'"],
];
function matchAll(source, flags, str) {
    const re = new RegExp(source, flags.includes('g') ? flags : flags + 'g');
    return [...str.matchAll(re)];
}
function extractErrorType(stderr, compiler) {
    for (const [pattern, key] of TRAINER_PATTERNS) {
        if (pattern.test(stderr))
            return key;
    }
    const patterns = COMPILER_PATTERNS[compiler] ?? [];
    const sortedKeys = (0, index_1.getSortedKeys)(compiler);
    for (const [source, flags] of patterns) {
        const matches = matchAll(source, flags, stderr);
        if (matches.length > 0) {
            const last = matches[matches.length - 1];
            const captured = last[1] ?? last[0];
            for (const key of sortedKeys) {
                if (key.includes(captured) || captured.includes(key))
                    return key;
            }
            return captured;
        }
    }
    for (const key of sortedKeys) {
        if (stderr.includes(key))
            return key;
    }
    return null;
}
function parsePythonStderr(stderr) {
    const result = {};
    const fileMatches = [...stderr.matchAll(/File "([^"]+)", line (\d+)/gm)];
    if (fileMatches.length > 0) {
        const last = fileMatches[fileMatches.length - 1];
        result.file = path_1.default.basename(last[1]);
        result.lineNumber = last[2];
    }
    const lines = stderr.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trimStart().startsWith('File "') && i + 1 < lines.length) {
            const next = lines[i + 1];
            if (next && !next.trimStart().startsWith('^') && !next.trimStart().startsWith('File')) {
                result.errorLine = next.trimEnd();
                if (i + 2 < lines.length && /^\s*[\^~]+\s*$/.test(lines[i + 2])) {
                    result.caret = lines[i + 2].trimEnd();
                }
            }
            break;
        }
    }
    const errorMatch = stderr.match(/(\w*(?:Error|Warning|Exit))\s*:\s*(.+?)(?:\n|$)/m);
    if (errorMatch) {
        result.errorType = errorMatch[1];
        result.errorMessage = errorMatch[2].trim();
    }
    const suggestionMatch = stderr.match(/Did you mean:\s*['"](.+?)['"]\??/);
    if (suggestionMatch)
        result.suggestion = suggestionMatch[1];
    return result;
}
function translateMessage(message, compiler) {
    if (compiler !== 'python')
        return null;
    for (const [pattern, replacement] of PYTHON_MSG_TRANSLATIONS) {
        const translated = message.replace(pattern, replacement);
        if (translated !== message)
            return translated;
    }
    return null;
}
function formatContext(parsed, translatedMsg, translatedSuggestion) {
    const parts = [];
    if (parsed.file && parsed.lineNumber)
        parts.push(`Файл: ${parsed.file}, строка ${parsed.lineNumber}`);
    if (parsed.errorLine) {
        parts.push(parsed.errorLine);
        if (parsed.caret)
            parts.push(parsed.caret);
    }
    const msg = translatedMsg ?? parsed.errorMessage;
    if (msg)
        parts.push(msg);
    if (translatedSuggestion)
        parts.push(translatedSuggestion);
    return parts.length > 0 ? parts.join('\n') : null;
}
function formatLocalizedMessage(errorInfo, context) {
    const parts = [errorInfo.title_ru, ''];
    if (context) {
        parts.push(context);
        parts.push('');
    }
    parts.push(`Причина: ${errorInfo.description}`, '');
    parts.push(`Решение:\n${errorInfo.recommendations}`);
    if (errorInfo.correct_example) {
        parts.push('', `Пример:\n${errorInfo.correct_example}`);
    }
    return parts.join('\n');
}
async function queryLlm(stderr, compiler, sourceCode) {
    if (!LLM_API_URL)
        return null;
    let prompt = ('Ты — помощник для студентов, изучающих программирование. ' +
        'Объясни ошибку на русском языке в следующем формате:\n\n' +
        'Название ошибки\n\nПричина: <описание типичных причин>\n\n' +
        'Решение:\n<рекомендации по устранению>\n\nПример:\n<пример корректного кода>\n\n' +
        `Язык: ${compiler}\nОшибка:\n${stderr}\n`);
    if (sourceCode)
        prompt += `\nКод студента:\n${sourceCode}\n`;
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (LLM_API_KEY)
            headers['Authorization'] = `Bearer ${LLM_API_KEY}`;
        const response = await fetch(LLM_API_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: LLM_MODEL,
                messages: [
                    { role: 'system', content: 'Ты — преподаватель программирования. Отвечай кратко и по делу на русском языке.' },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.3,
                max_tokens: 1000,
            }),
            signal: AbortSignal.timeout(15000),
        });
        if (response.ok) {
            const data = await response.json();
            return data.choices[0].message.content;
        }
    }
    catch { /* LLM is optional */ }
    return null;
}
async function localizeError(stderr, compiler, useLlm = false, sourceCode) {
    if (!stderr?.trim())
        return null;
    const parts = [];
    const parsed = compiler === 'python' ? parsePythonStderr(stderr) : {};
    const translatedMsg = parsed.errorMessage
        ? translateMessage(parsed.errorMessage, compiler)
        : null;
    const translatedSuggestion = parsed.suggestion
        ? `Возможно, вы имели в виду: '${parsed.suggestion}'`
        : null;
    const context = formatContext(parsed, translatedMsg, translatedSuggestion);
    const errorType = extractErrorType(stderr, compiler);
    const errorInfo = errorType ? (0, index_1.getErrorInfo)(compiler, errorType) : null;
    if (errorInfo) {
        parts.push(formatLocalizedMessage(errorInfo, context));
    }
    else if (context) {
        parts.push(context);
    }
    if (useLlm) {
        const llmResult = await queryLlm(stderr, compiler, sourceCode);
        if (llmResult)
            parts.push(llmResult);
    }
    if (parts.length === 0)
        parts.push(DEFAULT_MESSAGE);
    return `${stderr}\n\n---\n\n${parts.join('\n\n---\n\n')}`;
}
function sanitizeStderr(stderr) {
    if (!stderr)
        return stderr;
    let result = stderr.replace(/File "([^"]*\/)?([^"]+)"/g, 'File "$2"');
    result = result.replace(/\/home\/student\/tests\/\w+\//g, '');
    result = result.replace(/\/home\/student\//g, '');
    return result;
}
