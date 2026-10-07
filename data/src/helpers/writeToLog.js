"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeToLog = writeToLog;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function writeToLog(message) {
    try {
        const dateStr = new Date().toISOString().slice(0, 10);
        const logDir = path_1.default.join('/log', dateStr);
        fs_1.default.mkdirSync(logDir, { recursive: true });
        fs_1.default.appendFileSync(path_1.default.join(logDir, 'report.log'), message, 'utf-8');
    }
    catch { /* log errors are non-fatal */ }
}
