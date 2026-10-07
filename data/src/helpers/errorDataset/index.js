"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getErrorInfo = getErrorInfo;
exports.getSortedKeys = getSortedKeys;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const cache = {};
function loadDataset(compiler) {
    if (cache[compiler])
        return cache[compiler];
    const datasetPath = path_1.default.join(__dirname, `${compiler}_errors.json`);
    if (!fs_1.default.existsSync(datasetPath)) {
        cache[compiler] = {};
        return cache[compiler];
    }
    cache[compiler] = JSON.parse(fs_1.default.readFileSync(datasetPath, 'utf-8'));
    return cache[compiler];
}
function getErrorInfo(compiler, errorType) {
    return loadDataset(compiler)[errorType] ?? null;
}
function getSortedKeys(compiler) {
    return Object.keys(loadDataset(compiler)).sort((a, b) => b.length - a.length);
}
