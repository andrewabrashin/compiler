"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vm_1 = __importDefault(require("vm"));
const codeTester_1 = require("./codeTester");
function safeJson(obj) {
    return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) =>
        '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}
async function main() {
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    const { lang, code, codeReference, unitTest } = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    const tester = new codeTester_1.CodeTesterClass();
    tester.setLang(lang);
    tester.setCode(code);
    tester.setCodeReference(codeReference);
    const sandbox = vm_1.default.createContext({ tester, Promise, setTimeout, clearTimeout });
    const safeUnitTest = unitTest.replace(/[^\x00-\x7F]/g, (c) =>
        '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    try {
        await vm_1.default.runInNewContext(`(async () => { ${safeUnitTest} })()`, sandbox);
    }
    catch (e) {
        process.stdout.write(safeJson({
            passed: false,
            check_list: [],
            log: tester.log,
            error: String(e),
        }));
        return;
    }
    const passed = tester.checkList.length > 0 && tester.checkList.every((i) => i.value);
    process.stdout.write(safeJson({
        passed,
        check_list: tester.checkList,
        log: tester.log.trim(),
    }));
}
main().catch((e) => {
    process.stdout.write(safeJson({ passed: false, check_list: [], log: '', error: String(e) }));
    process.exit(1);
});
