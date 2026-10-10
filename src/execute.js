"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeHandler = executeHandler;
const run_1 = require("./run");
const testRun_1 = require("./testRun");
const COMPILER_TO_LANG = {
    python: 'python',
    js: 'javascript',
    ts: 'javascript',
    cpp: 'cpp',
};
function getMainCode(body) {
    const files = body.files ?? [];
    if (!files.length) return '';
    const target = (body.target_file ?? '').trim();
    if (target) {
        const f = files.find((f) => f.name === target);
        if (f?.content != null) return f.content;
    }
    return files[0]?.content ?? '';
}
async function executeHandler(req, res) {
    const body = req.body;
    const { unit_test, code_reference, ...runBody } = body;
    const runOutcome = await (0, run_1.processRun)(runBody, req.ip ?? '');
    if (!runOutcome.ok) {
        res.status(runOutcome.status).json(runOutcome.payload);
        return;
    }
    if (!unit_test) {
        res.json({ run: runOutcome.payload });
        return;
    }
    const compiler = (body.compiler ?? '').trim();
    const lang = COMPILER_TO_LANG[compiler] ?? compiler;
    const code = getMainCode(body);
    const testOutcome = await (0, testRun_1.processTestRun)({
        lang,
        code,
        unit_test,
        code_reference: code_reference ?? code,
    });
    res.json({
        run: runOutcome.payload,
        test: testOutcome.payload,
    });
}
