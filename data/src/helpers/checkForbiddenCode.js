"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkForbiddenCode = checkForbiddenCode;
const FORBIDDEN_PHRASES = {
    python: [
        /import\s+(subprocess|pty)/i,
        /from\s+(subprocess|pty)\s+import/i,
        /eval\s*\(/i,
        /exec\s*\(/i,
    ],
    js: [
        /require\s*\(/i,
        /import\s+.*\s+from\s+['"`](child_process|fs|net|http)['"`]/i,
        /import\s*\(\s*['"`](child_process|fs|net|http)['"`]/i,
        /eval\s*\(/i,
        /process\.(exit|kill|env)/i,
        /process\[\s*['"`](exit|kill|env)['"`]/i,
    ],
    ts: [
        /require\s*\(/i,
        /import\s+.*\s+from\s+['"`](child_process|fs|net|http)['"`]/i,
        /import\s*\(\s*['"`](child_process|fs|net|http)['"`]/i,
        /eval\s*\(/i,
        /process\.(exit|kill|env)/i,
        /process\[\s*['"`](exit|kill|env)['"`]/i,
    ],
    go: [/os\/exec/, /net\/http/],
    cpp: [/system\s*\(/, /popen\s*\(/, /execl\s*\(/, /execv\s*\(/, /fork\s*\(/, /socket\s*\(/, /pcap_/],
};
function checkForbiddenCode(files, compiler) {
    const patterns = FORBIDDEN_PHRASES[compiler] ?? [];
    for (const file of files) {
        for (const pattern of patterns) {
            if (pattern.test(file.content)) {
                return { forbidden: true, phrase: pattern.source };
            }
        }
    }
    return { forbidden: false, phrase: null };
}
