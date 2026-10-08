"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_rate_limit_1 = require("express-rate-limit");
const http_1 = __importDefault(require("http"));
const path_1 = __importDefault(require("path"));
const ws_1 = require("ws");
const execute_1 = require("./execute");
const console_1 = require("./console");

const app = (0, express_1.default)();
const PORT = parseInt(process.env.PORT ?? '3999', 10);
const RESTART_TOKEN = process.env.RESTART_TOKEN ?? '';
const API_KEY = process.env.API_KEY ?? '';
const ADMIN_KEY = process.env.ADMIN_KEY ?? '';

app.set('trust proxy', 1);
app.use(express_1.default.json({ limit: '10mb' }));

function realIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    return (fwd ? String(fwd).split(',')[0].trim() : req.socket.remoteAddress) ?? '';
}

function isLocalIp(ip) {
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function requireApiKey(req, res, next) {
    if (isLocalIp(realIp(req))) { next(); return; }
    const key = req.headers['x-api-key'] ?? '';
    if (key !== API_KEY) {
        res.status(403).json({ error: 'Forbidden' });
        return;
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

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/console-test', (_req, res) => res.sendFile(path_1.default.join(__dirname, 'console-test.html')));
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

const MAX_SESSIONS        = parseInt(process.env.MAX_SESSIONS         ?? '20', 10);
const MAX_SESSIONS_PER_IP = parseInt(process.env.MAX_SESSIONS_PER_IP  ?? '3',  10);
const WS_RATE_MAX         = parseInt(process.env.WS_RATE_MAX          ?? '10', 10); // new conns/IP/min

let activeSessions = 0;
const sessionsByIp = new Map(); // ip → active count
const wsRateMap    = new Map(); // ip → { count, resetAt }

function wsRateOk(ip) {
    const now = Date.now();
    let e = wsRateMap.get(ip);
    if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + 60_000 }; wsRateMap.set(ip, e); }
    return ++e.count <= WS_RATE_MAX;
}

function trackSession(ip, delta) {
    activeSessions += delta;
    const n = (sessionsByIp.get(ip) ?? 0) + delta;
    if (n <= 0) sessionsByIp.delete(ip); else sessionsByIp.set(ip, n);
}

const server = http_1.default.createServer(app);
const wss = new ws_1.WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (url.pathname !== '/console') {
        socket.destroy();
        return;
    }
    const ip = realIp(req);
    const isLocal = isLocalIp(ip);

    if (!isLocal) {
        if (!wsRateOk(ip)) {
            socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
            socket.destroy();
            return;
        }
        if ((sessionsByIp.get(ip) ?? 0) >= MAX_SESSIONS_PER_IP) {
            socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
            socket.destroy();
            return;
        }
    }

    if (activeSessions >= MAX_SESSIONS) {
        socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        socket.destroy();
        return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
    });
});

const WS_PING_INTERVAL_MS = 30_000;

wss.on('connection', (ws, req) => {
    const ip = realIp(req);
    trackSession(ip, +1);
    ws.once('close', () => trackSession(ip, -1));

    // Keep-alive: Render.com drops idle connections after ~55s
    const pingTimer = setInterval(() => {
        if (ws.readyState === ws_1.WebSocket.OPEN) ws.ping();
    }, WS_PING_INTERVAL_MS);
    ws.once('close', () => clearInterval(pingTimer));

    ws.once('message', async (raw) => {
        let body;
        try {
            body = JSON.parse(raw.toString());
        } catch {
            ws.close(1008, 'Invalid JSON');
            return;
        }
        if (body.type !== 'start') {
            ws.close(1008, 'Expected {type:"start",...}');
            return;
        }
        if (!isLocalIp(ip)) {
            const key = body.api_key ?? '';
            if (key !== API_KEY) {
                ws.close(4003, 'Forbidden');
                return;
            }
        }
        try {
            await (0, console_1.handleConsoleSession)(ws, body);
        } catch (err) {
            console.error('[console] unhandled error:', err);
            if (ws.readyState === ws_1.WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'error', message: 'Internal server error' }));
            }
        }
        if (ws.readyState === ws_1.WebSocket.OPEN) ws.close();
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});
