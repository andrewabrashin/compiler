"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processTestRun = processTestRun;
const child_process_1 = require("child_process");
const killProcess_1 = require("./helpers/killProcess");
const TIMEOUT_SEC = parseInt(process.env.TIMEOUT ?? '60', 10);
const RUNNER_PATH = '/app/helpers/unitTestRunner.js';
async function processTestRun(body) {
    const { lang, code, unit_test, code_reference } = body;
    if (!lang || code == null || !unit_test) {
        return { ok: false, status: 400, payload: { error: 'Missing required fields: lang, code, unit_test' } };
    }
    // Pass all data via stdin as JSON — no user input touches the shell command string
    const input = JSON.stringify({
        lang,
        code,
        codeReference: code_reference ?? code,
        unitTest: unit_test,
    });
    const port = process.env.PORT ?? '3999';
    const sandboxCmd = `ulimit -f 10240 && ulimit -u 256 && ulimit -v 2097152 && PORT=${port} node ${RUNNER_PATH}`;
    let stdOut = '';
    let stdErr = '';
    let timedOut = false;
    await new Promise((resolve) => {
        const child = (0, child_process_1.spawn)('su', ['-', 'student', '-c', sandboxCmd], {
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
        child.on('close', () => {
            if (timedOut) return;
            clearTimeout(timeoutId);
            resolve();
        });
        child.on('error', (err) => {
            clearTimeout(timeoutId);
            stdErr = err.message;
            resolve();
        });
        child.stdin.write(Buffer.from(input, 'utf8'));
        child.stdin.end();
    });
    if (timedOut) {
        return { ok: true, payload: { passed: false, check_list: [], log: '', error: `[Timeout] ${TIMEOUT_SEC} sec` } };
    }
    try {
        const result = JSON.parse(stdOut);
        return { ok: true, payload: result };
    }
    catch {
        return { ok: true, payload: { passed: false, check_list: [], log: '', error: stdErr || 'Internal runner error' } };
    }
}
