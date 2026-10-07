"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeTesterClass = void 0;
const http_1 = __importDefault(require("http"));
const LOCAL_PORT = parseInt(process.env.PORT ?? '3999', 10);
async function httpPost(data) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const req = http_1.default.request({ hostname: 'localhost', port: LOCAL_PORT, path: '/execute', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
            let d = '';
            res.on('data', (c) => { d += c; });
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(d);
                }
                catch { /* not JSON */ }
                resolve({ statusCode: res.statusCode ?? 0, body: parsed });
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}
async function compile(data) {
    const inputJson = (data.input || '').split(/[\r\n]+/).filter(Boolean).map((i) => {
        const trimmed = i.trim();
        const n = Number(trimmed);
        return Number.isNaN(n) ? trimmed : n;
    });
    const files = [{ name: data.name, content: data.code }];
    if (data.file?.name)
        files.push(data.file);
    if (data.files?.length)
        files.push(...data.files);
    try {
        const { statusCode, body } = await httpPost({ command: data.command, stdin: inputJson, files });
        if (statusCode < 200 || statusCode >= 300 || !body) {
            return { error: true, message: `API error: HTTP ${statusCode}`, result: '' };
        }
        const run = body['run'];
        const stderr = run?.['stderr'];
        const stdout = run?.['stdout'];
        if (stderr)
            return { error: true, message: stderr, result: stdout || '' };
        return { error: false, result: stdout || 'Return code: 0' };
    }
    catch (e) {
        return { error: true, message: String(e), result: '' };
    }
}
async function testPython(data) {
    let command = 'python main.py';
    if (data.libraries?.trim()) {
        command = `pip install ${data.libraries.replace(/[\s\n,]+/iug, ' ')} > /dev/null 2>&1 && ${command}`;
    }
    return compile({ ...data, command, name: 'main.py' });
}
async function testJs(data) {
    let command = 'node ./index.js';
    if (data.libraries?.trim()) {
        command = `npm i ${data.libraries.replace(/[\s\n,]+/iug, ' ')} > /dev/null 2>&1 && ${command}`;
    }
    return compile({ ...data, command, name: 'index.js' });
}
async function testCpp(data) {
    return compile({ ...data, command: 'g++ -pipe -O2 -static -o main main.cpp && ./main', name: 'main.cpp' });
}
function clearCode(code, lang) {
    let result = `${code}`;
    if (lang === 'python') {
        result = result.replace(/#.+?$/gimu, '');
    }
    if (lang !== 'python') {
        result = result.replace(/^\s+/gimu, '').replace(/\s+$/gimu, '')
            .replace(/\/\/.+?$/gimu, '').replace(/\/\*[\w\W]*?\*\//giu, '');
    }
    return result.replace(/\n+/giu, '\n');
}
function equalCode(customCode, originalCode) {
    const norm = (c) => ` ${c}`
        .replaceAll(/[\n\r,;:{}]+/gi, ' ')
        .replaceAll('"', "'")
        .replaceAll(/\s[a-zA-Z0-9]+\s*=/gi, ' =')
        .replaceAll(/=\s*[a-zA-Z0-9]+\s/gi, '= ')
        .replaceAll(/\(\s*[a-zA-Z0-9]+\s*\)+/gi, '()')
        .replaceAll(/\[.*?\]/gi, '[]')
        .replaceAll(/'.*?'/gi, '')
        .replaceAll(/'\s+'/gi, ' ');
    return norm(customCode) === norm(originalCode);
}
class CodeTesterClass {
    constructor() {
        this.checkList = [];
        this.log = '';
        this.result = '';
        this.error = false;
        this.lang = 'python';
        this.code = '';
        this.codeBackup = '';
        this.codeReference = '';
        this.input = '';
        this.file = null;
        this.files = [];
        this.libraries = '';
        this.clearTag = '-----/clear/-----';
    }
    clear() { this.checkList = []; }
    clearLog() { this.log = ''; }
    setLang(lang) { this.lang = lang; }
    setCode(code) { this.code = code; this.codeBackup = code; }
    setCodeReference(code) { this.codeReference = code; }
    setFile(name, content) { this.file = name ? { name, content: content ?? '' } : null; }
    setFiles(files) { this.files = files || []; }
    addCode(code) { this.code += `\n${code}`; }
    resetCode() { this.code = this.codeBackup; }
    eraseCode() { this.code = ''; }
    clearComments() { this.code = clearCode(this.code, this.lang); }
    setInput(input) {
        if (typeof input === 'object') {
            input = input.join('\n');
        }
        this.input = input;
    }
    addInput(input) { this.input += `${input}\n`; }
    clearInput() { this.input = ''; }
    setLog(log) { this.log = log; }
    addLog(log) { this.log += `${log}\n`; }
    setLibraries(libraries) { this.libraries = libraries; }
    addLibraries(libraries) { this.libraries += ` ${libraries}`; }
    clearLibraries() { this.libraries = ''; }
    async run(...args) {
        if (args?.length) {
            if (typeof args[0] === 'object') {
                this.setInput(args[0]);
            }
            else {
                this.setInput(args);
            }
        }
        return this._compile(this.code);
    }
    async runReference(...args) {
        if (args?.length) {
            if (typeof args[0] === 'object') {
                this.setInput(args[0]);
            }
            else {
                this.setInput(args);
            }
        }
        return this._compile(this.codeReference);
    }
    async compile(code) { return this._compile(code); }
    async _compile(code) {
        const data = { code, input: this.input, libraries: this.libraries, file: this.file, files: this.files };
        let result;
        if (this.lang === 'python')
            result = await testPython(data);
        else if (this.lang === 'javascript')
            result = await testJs(data);
        else if (this.lang === 'cpp')
            result = await testCpp(data);
        else
            result = { error: true, message: `unsupported lang: ${this.lang}`, result: '' };
        this.error = result.error;
        this.message = result.message;
        this.result = result.result || '';
        if (result.error)
            this.addLog(result.message ?? '');
        if (result.result)
            this.addLog(result.result);
        return result;
    }
    clearConsole() {
        const regexp = new RegExp(`[\\w\\W\\r\\n]*?${this.clearTag}[\\r\\n]*`, 'iug');
        this.result = this.result.replace(regexp, '');
    }
    print(message, value = undefined, score = 0, errorMessage = '') {
        if (value === undefined) {
            value = !this.error && !!this.result;
        }
        this.checkList.push({ score: parseInt(String(score), 10) || 0, message, icon: value ? '✅' : '❌', value, errorMessage });
    }
    isEqual(string) {
        return !this.error &&
            String(this.result).trim().toLowerCase().replace(/\s+/igu, ' ') ===
                String(string).trim().toLowerCase().replace(/\s+/igu, ' ');
    }
    isContains(string) {
        return String(this.result).trim().replace(/\s+/igu, ' ')
            .indexOf(String(string).trim().replace(/\s+/igu, ' ')) >= 0;
    }
    isMatch(regexp, params = 'igmu') {
        const r = regexp instanceof RegExp ? regexp : new RegExp(regexp, params);
        return !!(String(this.result).trim().match(r)?.length);
    }
    isMatchCode(regexp, params = 'igmu') {
        const code = clearCode(this.code, this.lang);
        const r = regexp instanceof RegExp ? regexp : new RegExp(regexp, params);
        return !!(String(code).trim().match(r)?.length);
    }
    isEqualCode(string) {
        const code = clearCode(this.code, this.lang);
        return String(code).trim().toLowerCase().replace(/\s+/igu, ' ') ===
            String(string).trim().toLowerCase().replace(/\s+/igu, ' ');
    }
    isKeywords(keywords) {
        const code = clearCode(this.code, this.lang);
        const list = keywords?.replaceAll('"', "'").replaceAll(/[\s,]+/gi, ' ').split(' ');
        return list?.every((k) => code.indexOf(k) >= 0) ?? false;
    }
    isStructure() {
        return equalCode(clearCode(this.code, this.lang), clearCode(this.codeReference, this.lang));
    }
    findMethods(type = 'class') {
        const r = new RegExp(`^\\s*${type}\\s+(.+)?\\(`, 'igmu');
        return this.code?.match(r)?.map((i) => i?.replace(r, '$1').replace(/\s*=\s*.*/gu, ''));
    }
    clearMethods(...args) {
        if (!args?.length)
            return;
        const find = typeof args[0] === 'object' ? args[0] : args;
        find?.forEach((i) => {
            const r = new RegExp(`^\\s*((const|let|var)\\s*.+?=\\s*)?(new\\s*)?${i}\\s*\\(.*?\\)`, 'gmu');
            this.code = this.code.replace(r, '');
        });
    }
    random(min, max, step = 1) {
        const koeff = 1 / step;
        const scaled = max * koeff;
        const rand = min + Math.random() * (scaled + 1 - min);
        let result = Math.floor(rand) / koeff;
        if (result > max)
            result -= step;
        if (result < min)
            result += step;
        return result;
    }
    randomString(min, max, string) {
        if (!max) {
            max = min;
        }
        else if (min !== max) {
            max = this.random(min, max);
        }
        let result = '';
        if (!string)
            string = ['ru', 'RU', 'en', 'EN', 'num', 'sym'];
        if (typeof string === 'object') {
            const strings = {
                ru: 'абвгдеёжзийклмнопрстуфхцчшщъыьюя', RU: 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЮЯ',
                en: 'abcdefghijklmnopqrstuvwxyz', EN: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
                num: '0123456789', sym: '!@#$%^&*()_+-=/{}:;",.?<> ',
            };
            string = string.map((i) => strings[i] ?? '').join('');
        }
        const len = string.length;
        for (let i = 0; i < max; i++)
            result += string.charAt(Math.floor(Math.random() * len));
        return result;
    }
    randomNum(min, max) { return this.randomString(min, max, ['num']); }
    randomOption(...args) {
        if (!args?.length)
            return '';
        const options = typeof args[0] === 'object' ? args[0] : args;
        return options[this.random(1, options.length) - 1];
    }
    randomEmail(min = 9, max = 30) {
        const string = '0123456789abcdefghijklmnopqrstuvwxyz._-';
        const result = this.randomString(min, max, string);
        const middle = Math.floor(result.length / 2);
        const last = this.randomString(2, 4, ['en']);
        return `${result.substring(0, middle)}@${result.substring(middle)}.${last}`
            .replace(/\W*@\W*/u, '@').replace(/\.{2,}/u, '.');
    }
    randomArray(n, callback = (i) => i) { return [...Array(n)].map((_, i) => callback(i)); }
    shuffleArray([...array]) { return array.sort(() => Math.random() - 0.5); }
}
exports.CodeTesterClass = CodeTesterClass;
