"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processRun = processRun;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const checkForbiddenCode_1 = require("./helpers/checkForbiddenCode");
const errorLocalizer_1 = require("./helpers/errorLocalizer");
const fetchFileContent_1 = require("./helpers/fetchFileContent");
const writeToLog_1 = require("./helpers/writeToLog");
const killProcess_1 = require("./helpers/killProcess");
const TIMEOUT_SEC = parseInt(process.env.TIMEOUT ?? '60', 10);
const TESTS_PATH = '/home/student/tests/';
function shellSingleQuote(s) {
    return "'" + s.replace(/'/g, "'\\''") + "'";
}
const SAFE_LIB_RE = /^[a-zA-Z0-9@/._\-\[\]<>=!~^*,+]+$/;
async function processRun(body, ip = '') {
    const startTime = Date.now();
    let command = (body.command ?? '').trim();
    let compiler = (body.compiler ?? '').trim();
    let targetFile = (body.target_file ?? '').trim();
    const project = Boolean(body.project);
    const rawLibraries = (body.libraries ?? []).map(String);
    const stdin = body.stdin ?? [];
    const rawErrors = Boolean(body.raw_errors);
    const useLlmFallback = Boolean(body.use_llm_fallback);
    (0, writeToLog_1.writeToLog)(`# START\ntime: ${new Date().toISOString()}\nip: ${ip}\nbody: ${JSON.stringify(body)}\n`);
    const badLib = rawLibraries.find((lib) => !SAFE_LIB_RE.test(lib.trim()));
    if (badLib !== undefined) {
        (0, writeToLog_1.writeToLog)(`stderr: invalid library name\n# END\n\n`);
        return { ok: false, status: 400, payload: { exit_code: 1, stdout: '', stderr: `Invalid library name: '${badLib}'`, duration: 0 } };
    }
    const libraries = rawLibraries.map((lib) => lib.trim()).join(' ').trim();
    // Auto-detect compiler from command string
    if (!compiler && command) {
        if (command.startsWith('python'))
            compiler = 'python';
        else if (command.includes('tsc'))
            compiler = 'ts';
        else if (command.startsWith('node'))
            compiler = 'js';
        else if (command.startsWith('go'))
            compiler = 'go';
        else if (command.includes('g++'))
            compiler = 'cpp';
    }
    // target_file overrides command
    if (targetFile) {
        if (compiler === 'python') {
            command = `python "${targetFile}"`;
        }
        else if (compiler === 'js') {
            command = `node "${targetFile}"`;
        }
        else if (compiler === 'ts') {
            if (targetFile.endsWith('.ts'))
                targetFile = targetFile.slice(0, -3) + '.js';
            command = `tsc && node "${targetFile}"`;
        }
        else if (compiler === 'go') {
            command = `go run "${targetFile}"`;
        }
        else if (compiler === 'cpp') {
            command = `g++ -pipe -O2 -static -o main "${targetFile}" && ./main`;
        }
    }
    // project mode: auto-install dependencies
    if (project) {
        if (compiler === 'python')
            command = `pip install --no-cache-dir -r requirements.txt && ${command}`;
        else if (compiler === 'js' || compiler === 'ts')
            command = `npm install --force --no-optional && ${command}`;
    }
    // libraries: install before running
    if (libraries) {
        if (compiler === 'python')
            command = `pip install ${libraries} --quiet && ${command}`;
        else if (compiler === 'js' || compiler === 'ts')
            command = `npm i ${libraries} --silent --no-save && ${command}`;
    }
    if (!command) {
        (0, writeToLog_1.writeToLog)(`stderr: command not set\n# END\n\n`);
        return { ok: true, payload: { exit_code: 0, stdin: stdin.length, stdout: '', stderr: 'command not set', duration: 0 } };
    }
    // Resolve file contents (inline or from URL)
    const files = [];
    for (const f of body.files ?? []) {
        let content = f.url ? await (0, fetchFileContent_1.fetchFileContent)(f.url) : (f.content ?? '');
        const before = (f.before ?? '').trim();
        const after = (f.after ?? '').trim();
        content = [before, content.trim(), after].filter(Boolean).join('\n');
        files.push({ name: f.name, content });
    }
    // Auto-inject tsconfig.json for TypeScript projects
    if (compiler === 'ts' && !files.some((f) => f.name === 'tsconfig.json')) {
        files.push({
            name: 'tsconfig.json',
            content: JSON.stringify({
                compilerOptions: { module: 'nodenext', target: 'es2022', strict: true, esModuleInterop: true, moduleResolution: 'nodenext' },
            }),
        });
    }
    // Security: check for forbidden constructs
    const { forbidden, phrase } = (0, checkForbiddenCode_1.checkForbiddenCode)(files, compiler);
    if (forbidden) {
        return { ok: false, status: 403, payload: {
                exit_code: 1,
                stdout: '',
                stderr: `Security Error: Forbidden phrase found: '${phrase}'`,
                duration: 0,
            } };
    }
    if (!fs_1.default.existsSync(TESTS_PATH))
        fs_1.default.mkdirSync(TESTS_PATH, { recursive: true });
    const tempDir = fs_1.default.mkdtempSync(path_1.default.join(TESTS_PATH, 'temp-'));
    let stdOut = '';
    let stdErr = '';
    let exitCode = 0;
    let timedOut = false;
    let processError = null;
    try {
        for (const file of files) {
            fs_1.default.writeFileSync(path_1.default.join(tempDir, file.name), file.content, 'utf-8');
        }
        const localTmp = path_1.default.join(tempDir, 'tmp');
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
        const vmLimit = (compiler === 'js' || compiler === 'ts') ? 2097152 : 262144;
        const innerCmd = `ulimit -f 10240 && ulimit -u 64 && ulimit -v ${vmLimit} && ${envVars} && cd ${tempDir} && ${command}`;
        const fullCommand = [
            `mkdir -p ${localTmp}`,
            `&& chown -R student ${tempDir}`,
            `&& su - student -c ${shellSingleQuote(innerCmd)}`,
        ].join(' ');
        await new Promise((resolve) => {
            const child = (0, child_process_1.spawn)('bash', ['-c', fullCommand], {
                stdio: ['pipe', 'pipe', 'pipe'],
                detached: true,
            });
            const timeoutId = setTimeout(() => {
                timedOut = true;
                (0, killProcess_1.killProcess)(child);
                resolve();
            }, TIMEOUT_SEC * 1000);
            child.stdout.on('data', (d) => { stdOut += d.toString(); });
            child.stderr.on('data', (d) => { stdErr += d.toString(); });
            child.on('close', (code) => {
                if (timedOut)
                    return;
                clearTimeout(timeoutId);
                exitCode = code ?? 1;
                resolve();
            });
            child.on('error', (err) => {
                clearTimeout(timeoutId);
                processError = err.message;
                exitCode = 1;
                resolve();
            });
            const inputData = stdin.map(String).join('\n') + (stdin.length ? '\n' : '');
            if (inputData)
                child.stdin.write(inputData);
            child.stdin.end();
        });
    }
    finally {
        try {
            fs_1.default.rmSync(tempDir, { recursive: true, force: true });
        }
        catch { /* best effort */ }
    }
    if (timedOut) {
        stdErr = `[Timeout] ${TIMEOUT_SEC} sec`;
        exitCode = 1;
    }
    else if (processError) {
        stdErr = `[Exception] ${processError}`;
        exitCode = 1;
    }
    stdErr = (0, errorLocalizer_1.sanitizeStderr)(stdErr);
    const result = {
        exit_code: exitCode,
        stdin: stdin.length,
        stdout: stdOut.trim(),
        stderr: stdErr,
        duration: Date.now() - startTime,
    };
    if (!rawErrors && exitCode !== 0 && stdErr && compiler) {
        const sourceCode = files.map((f) => f.content).join('\n');
        const localized = await (0, errorLocalizer_1.localizeError)(stdErr, compiler, useLlmFallback, sourceCode);
        if (localized)
            result.stderr = localized;
    }
    (0, writeToLog_1.writeToLog)(`duration: ${result.duration}\nstdout: ${result.stdout}\nstderr: ${result.stderr}\nexit_code: ${result.exit_code}\n# END\n\n`);
    return { ok: true, payload: result };
}
