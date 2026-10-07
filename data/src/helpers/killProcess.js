"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.killProcess = killProcess;
function killProcess(child) {
    try {
        if (child.pid)
            process.kill(-child.pid, 'SIGKILL');
    }
    catch {
        try {
            child.kill('SIGKILL');
        }
        catch { /* already dead */ }
    }
}
