"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const path_1 = __importDefault(require("path"));
const ws_1 = require("ws");
const execute_1 = require("./execute");
const console_1 = require("./console");

const app = (0, express_1.default)();
const PORT = parseInt(process.env.PORT ?? '3999', 10);
const COMPILER_SECRET = process.env.COMPILER_SECRET ?? '';

app.set('trust proxy', 1);
app.use(express_1.default.json({ limit: '10mb' }));

// Token format: <md5(SECRET + "." + expired_ms)>.<expired_ms>
function validateToken(token) {
    if (!COMPILER_SECRET) return { ok: false, status: 500, error: 'Server configuration error' };
    if (!token) return { ok: false, status: 401, error: 'Authorization token not provided' };

    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1])
        return { ok: false, status: 401, error: 'Invalid token format' };

    const [tokenHash, expiredRaw] = parts;
    const expired = parseInt(expiredRaw, 10);
    if (isNaN(expired)) return { ok: false, status: 401, error: 'Invalid expiration time format' };
    if (Date.now() > expired) return { ok: false, status: 401, error: 'Token has expired' };

    const expectedHash = crypto_1.default.createHash('md5').update(`${COMPILER_SECRET}.${expired}`).digest('hex');
    const a = Buffer.from(tokenHash);
    const b = Buffer.from(expectedHash);
    if (a.length !== b.length || !crypto_1.default.timingSafeEqual(a, b))
        return { ok: false, status: 401, error: 'Invalid token signature' };

    return { ok: true };
}

function requireToken(req, res, next) {
    const auth = req.headers['authorization'] ?? '';
    const token = auth.replace(/^\w+\s+/, '').trim();
    const result = validateToken(token);
    if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
    }
    next();
}

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/console-test', (_req, res) => res.sendFile(path_1.default.join(__dirname, 'console-test.html')));
app.post('/execute', requireToken, execute_1.executeHandler);
app.post('/restart', requireToken, (_req, res) => {
    res.json({ ok: true });
    process.exit(1);
});

const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS ?? '20', 10);
let activeSessions = 0;

const server = http_1.default.createServer(app);
const wss = new ws_1.WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (url.pathname !== '/console') {
        socket.destroy();
        return;
    }

    const ip = req.socket.remoteAddress ?? '';

    const token = url.searchParams.get('token') ?? '';
    const result = validateToken(token);
    if (!result.ok) {
        socket.write(`HTTP/1.1 ${result.status} Unauthorized\r\n\r\n`);
        socket.destroy();
        return;
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
    const ip = req.socket.remoteAddress ?? '';
    activeSessions++;
    ws.once('close', () => activeSessions--);

    console.log(`[WS] connect ip=${ip} active=${activeSessions}`);
    const pingTimer = setInterval(() => {
        if (ws.readyState === ws_1.WebSocket.OPEN) ws.ping();
    }, WS_PING_INTERVAL_MS);
    ws.once('close', () => { clearInterval(pingTimer); console.log(`[WS] disconnect ip=${ip}`); });

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
        body._ip = ip;
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
