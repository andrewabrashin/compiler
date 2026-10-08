"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleConsoleSession = handleConsoleSession;

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { checkForbiddenCode } = require("./helpers/checkForbiddenCode");
const { killProcess } = require("./helpers/killProcess");
const { sanitizeStderr } = require("./helpers/errorLocalizer");

const TIMEOUT_SEC = parseInt(process.env.TIMEOUT ?? '60', 10);
const INTERACTIVE_TIMEOUT_SEC = parseInt(process.env.INTERACTIVE_TIMEOUT ?? '600', 10);
const TESTS_PATH = '/home/student/tests/';
const SAFE_LIB_RE = /^[a-zA-Z0-9@/._\-\[\]<>=!~^*,+]+$/;

function shellSingleQuote(s) {
    return "'" + s.replace(/'/g, "'\\''") + "'";
}

function send(ws, obj) {
    if (ws.readyState === 1 /* OPEN */) {
        ws.send(JSON.stringify(obj));
    }
}

/**
 * Runs an interactive console session over a WebSocket connection.
 *
 * Protocol (client → server):
 *   First message: { type: "start", files, compiler, command, target_file, libraries, project }
 *   Subsequent:    { type: "stdin", data: "42\n" }
 *                { type: "kill" }
 *
 * Protocol (server → client):
 *   { type: "stdout", data: "..." }
 *   { type: "stderr", data: "..." }
 *   { type: "exit",   code: 0, duration: 312 }
 *   { type: "error",  message: "..." }   — pre-launch validation failure
 */
async function handleConsoleSession(ws, body) {
    let compiler = (body.compiler ?? '').trim();
    let command = (body.command ?? '').trim();
    let targetFile = (body.target_file ?? '').trim();
    const rawLibraries = (body.libraries ?? []).map(String);
    const project = Boolean(body.project);
    const interactive = Boolean(body.interactive);
    const timeoutMs = (interactive ? INTERACTIVE_TIMEOUT_SEC : TIMEOUT_SEC) * 1000;

    const badLib = rawLibraries.find(lib => !SAFE_LIB_RE.test(lib.trim()));
    if (badLib !== undefined) {
        send(ws, { type: 'error', message: `Invalid library name: '${badLib}'` });
        return;
    }
    const libraries = rawLibraries.map(lib => lib.trim()).join(' ').trim();

    if (!compiler && command) {
        if (command.startsWith('python'))      compiler = 'python';
        else if (command.includes('tsc'))      compiler = 'ts';
        else if (command.startsWith('node'))   compiler = 'js';
        else if (command.startsWith('go'))     compiler = 'go';
        else if (command.includes('g++'))      compiler = 'cpp';
    }

    if (targetFile) {
        if (compiler === 'python')       command = `python "${targetFile}"`;
        else if (compiler === 'js')      command = `node "${targetFile}"`;
        else if (compiler === 'ts') {
            if (targetFile.endsWith('.ts')) targetFile = targetFile.slice(0, -3) + '.js';
            command = `tsc && node "${targetFile}"`;
        }
        else if (compiler === 'go')      command = `go run "${targetFile}"`;
        else if (compiler === 'cpp')     command = `g++ -pipe -O2 -static -o main "${targetFile}" && ./main`;
    }

    if (project) {
        if (compiler === 'python')                command = `pip install --no-cache-dir -r requirements.txt && ${command}`;
        else if (compiler === 'js' || compiler === 'ts') command = `npm install --force --no-optional && ${command}`;
    }
    if (libraries) {
        if (compiler === 'python')                       command = `pip install ${libraries} --quiet && ${command}`;
        else if (compiler === 'js' || compiler === 'ts') command = `npm i ${libraries} --silent --no-save && ${command}`;
    }

    if (!command) {
        send(ws, { type: 'error', message: 'command not set' });
        return;
    }

    const files = [];
    for (const f of body.files ?? []) {
        let content = f.content ?? '';
        const before = (f.before ?? '').trim();
        const after  = (f.after  ?? '').trim();
        content = [before, content.trim(), after].filter(Boolean).join('\n');
        files.push({ name: f.name, content });
    }

    if (compiler === 'ts' && !files.some(f => f.name === 'tsconfig.json')) {
        files.push({
            name: 'tsconfig.json',
            content: JSON.stringify({ compilerOptions: { module: 'nodenext', target: 'es2022', strict: true, esModuleInterop: true, moduleResolution: 'nodenext' } }),
        });
    }

    const { forbidden, phrase } = checkForbiddenCode(files, compiler);
    if (forbidden) {
        send(ws, { type: 'error', message: `Security Error: Forbidden phrase found: '${phrase}'` });
        return;
    }

    if (!fs.existsSync(TESTS_PATH)) fs.mkdirSync(TESTS_PATH, { recursive: true });
    const tempDir = fs.mkdtempSync(path.join(TESTS_PATH, 'temp-'));
    const startTime = Date.now();

    try {
        for (const file of files) {
            fs.writeFileSync(path.join(tempDir, file.name), file.content, 'utf-8');
        }

        const localTmp = path.join(tempDir, 'tmp');
        const envVars = [
            `export LANG=C.UTF-8`,
            `export PYTHONUTF8=1`,
            `export TMPDIR=${localTmp}`,
            `export TEMP=${localTmp}`,
            `export TMP=${localTmp}`,
            `export OPENBLAS_NUM_THREADS=1`,
            `export MKL_NUM_THREADS=1`,
            `export OMP_NUM_THREADS=1`,
            `export NUMEXPR_NUM_THREADS=1`,
            `export TF_NUM_INTEROP_THREADS=1`,
            `export TF_NUM_INTRAOP_THREADS=1`,
            `export MPLCONFIGDIR=${localTmp}`,
        ].join(' && ');

        const vmLimit = (compiler === 'js' || compiler === 'ts') ? 2097152 : 524288;
        const innerCmd = `ulimit -f 10240 && ulimit -u 64 && ulimit -v ${vmLimit} && ${envVars} && cd ${tempDir} && ${command}`;
        const fullCommand = [
            `mkdir -p ${localTmp}`,
            `&& chown -R student ${tempDir}`,
            `&& su - student -c ${shellSingleQuote(innerCmd)}`,
        ].join(' ');

        await new Promise((resolve) => {
            const child = spawn('bash', ['-c', fullCommand], {
                stdio: ['pipe', 'pipe', 'pipe'],
                detached: true,
            });

            let done = false;
            const finish = () => { if (!done) { done = true; resolve(); } };

            const limitSec = interactive ? INTERACTIVE_TIMEOUT_SEC : TIMEOUT_SEC;
            let timeoutId;
            const resetTimeout = () => {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => {
                    killProcess(child);
                    send(ws, { type: 'stderr', data: `[Timeout] ${limitSec} sec` });
                    send(ws, { type: 'exit', code: 1, duration: Date.now() - startTime });
                    finish();
                }, timeoutMs);
            };
            resetTimeout();

            child.stdout.on('data', d => send(ws, { type: 'stdout', data: d.toString() }));
            child.stderr.on('data', d => send(ws, { type: 'stderr', data: sanitizeStderr(d.toString()) }));

            child.on('close', code => {
                clearTimeout(timeoutId);
                send(ws, { type: 'exit', code: code ?? 1, duration: Date.now() - startTime });
                finish();
            });

            child.on('error', err => {
                clearTimeout(timeoutId);
                send(ws, { type: 'stderr', data: `[Exception] ${err.message}` });
                send(ws, { type: 'exit', code: 1, duration: Date.now() - startTime });
                finish();
            });

            ws.on('message', raw => {
                try {
                    const msg = JSON.parse(raw.toString());
                    if (msg.type === 'stdin') {
                        resetTimeout();
                        child.stdin.write(msg.data);
                    } else if (msg.type === 'eof') {
                        child.stdin.end();
                    } else if (msg.type === 'kill') {
                        killProcess(child);
                    }
                } catch { /* ignore malformed frames */ }
            });

            ws.on('close', () => {
                clearTimeout(timeoutId);
                killProcess(child);
                finish();
            });
        });
    } finally {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
}
