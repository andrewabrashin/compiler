"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchFileContent = fetchFileContent;
async function fetchFileContent(url) {
    const response = await fetch(url);
    if (!response.ok)
        throw new Error(`[File] HTTP ${response.status} fetching ${url}`);
    return response.text();
}
