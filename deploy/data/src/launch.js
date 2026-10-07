"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_rate_limit_1 = require("express-rate-limit");
const execute_1 = require("./execute");
const app = (0, express_1.default)();
const PORT = parseInt(process.env.PORT ?? '3999', 10);
const RESTART_TOKEN = process.env.RESTART_TOKEN ?? '';
const API_KEY = process.env.API_KEY ?? '';
const ADMIN_KEY = process.env.ADMIN_KEY ?? '';
app.use(express_1.default.json({ limit: '10mb' }));
function requireApiKey(req, res, next) {
    const ip = req.ip ?? '';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (isLocal) { next(); return; }
    if (API_KEY) {
        const key = req.headers['x-api-key'] ?? '';
        if (key !== API_KEY) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }
    }
    next();
}
const limiter = (0, express_rate_limit_1.rateLimit)({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => ADMIN_KEY !== '' && req.headers['x-admin-key'] === ADMIN_KEY,
    handler: (_req, res) => res.status(429).json({ error: 'Too Many Requests' }),
});
app.post('/execute', requireApiKey, limiter, execute_1.executeHandler);
app.post('/restart', (req, res) => {
    if (RESTART_TOKEN) {
        const token = req.headers['x-restart-token'] ?? '';
        if (token !== RESTART_TOKEN) {
            res.status(403).json({ ok: false });
            return;
        }
    }
    res.json({ ok: true });
    process.exit(1);
});
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});
