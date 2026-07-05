// server.js — Main Express server
// Start with: npm run dev (development) or npm start (production)

require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');
const helmet      = require('helmet');
const compression = require('compression');
const jwt         = require('jsonwebtoken');

// Routes
const authRoutes     = require('./routes/auth');
const advisoryRoutes = require('./routes/advisory');
const userRoutes     = require('./routes/user');

// Initialize DB connection pool (runs on import)
require('./db');

const app  = express();
const PORT = process.env.PORT || 5000;

// Railway (and most hosts) sit behind a reverse proxy, so without this,
// req.ip would return the proxy's internal IP for every request instead
// of the real visitor's IP — which would make the IP column in
// login_events useless. "1" trusts exactly one hop of proxy, which
// matches Railway's setup.
app.set('trust proxy', 1);

// ── Middleware ────────────────────────────────────────────────────

// Security headers (HSTS, X-Frame-Options, X-Content-Type-Options,
// hides X-Powered-By, sets a Content-Security-Policy, etc.)
// This is an API, not a page-rendering server, so we disable CSP's
// default directives that only make sense for HTML responses and
// keep the header-hardening parts.
app.use(helmet({
    contentSecurityPolicy: false,   // this server only returns JSON, not HTML
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // frontend on a different origin needs to fetch this API
}));
app.disable('x-powered-by');

// Gzip/deflate compress responses — smaller payloads, less bandwidth,
// cheaper on Railway's metered egress.
app.use(compression());

// CORS — allow React (port 3000 or 5173) to call this server.
// We use Bearer tokens in the Authorization header, not cookies, so
// `credentials: true` isn't needed here — leaving it off closes off
// a class of cross-site request issues entirely.
// The old wildcard /\.vercel\.app$/ matched EVERY Vercel-hosted app on
// the internet, not just yours — anyone's random Vercel project could
// call this API from a browser. Scoped it to just your project's
// preview deployments instead (sme-frontend-<hash>.vercel.app).
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
    'https://sme-frontend-ecru.vercel.app',
    /^https:\/\/sme-frontend-[a-z0-9-]+\.vercel\.app$/,  // your project's preview URLs only
  ],
  credentials: false,
}));
app.use(express.json({ limit: '10kb' }));       // parse JSON, max 10kb per request
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting ─────────────────────────────────────────────────
// Many users here are on mobile data in Dar es Salaam, where carriers
// often put thousands of phones behind the same few public IPs
// (CGNAT). A pure per-IP limit would let one carrier's users
// collectively exhaust another's quota. So for logged-in requests we
// key the limiter by user ID (from the JWT) instead of IP — falls
// back to IP only when there's no token (e.g. anonymous Path A/B use).
function rateLimitKey(req) {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const decoded = jwt.decode(authHeader.split(' ')[1]); // decode only — just for bucketing, not trust
            if (decoded?.userId) return `user:${decoded.userId}`;
        } catch (_) { /* fall through to IP */ }
    }
    return req.ip;
}

// Prevents abuse: max 100 requests per 15 minutes per user/IP
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,   // 15 minutes
    max: 100,
    keyGenerator: rateLimitKey,
    message: { error: 'Too many requests. Please wait a few minutes and try again.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Stricter limit for auth routes (prevent brute-force attacks).
// Deliberately kept IP-based (not user-based) — an attacker guessing
// passwords doesn't have a valid token to hide behind, so IP is the
// right signal here. Account-level lockout (see routes/auth.js)
// covers the case where they spread attempts across many IPs.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,   // only 10 login attempts per 15 minutes per IP
    message: { error: 'Too many login attempts. Please wait 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Prediction limiter — allow more since regular users need this
const predictLimiter = rateLimit({
    windowMs: 60 * 1000,   // 1 minute window
    max: 20,               // 20 predictions per minute per user/IP
    keyGenerator: rateLimitKey,
    message: { error: 'Too many requests. Please slow down.' },
});

// Upgrade limiter — this endpoint changes account state (tier), so it
// gets its own tight limit per user on top of the idempotency check
// inside routes/user.js. Stops someone from hammering it to spam the
// payments table or probe for a race condition.
const upgradeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,  // 1 hour
    max: 5,
    keyGenerator: rateLimitKey,
    message: { error: 'Too many upgrade attempts. Please wait and try again.' },
});

app.use('/api/auth',            authLimiter);
app.use('/api/advisory/predict', predictLimiter);
app.use('/api/user/upgrade',    upgradeLimiter);
app.use(generalLimiter);

// ── Routes ────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/advisory', advisoryRoutes);
app.use('/api/user',     userRoutes);

// Health check — quick test that Node is running
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'SME Advisory Node Gateway', port: PORT });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
});

// ── Start server ──────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`✅ Node server running on http://localhost:${PORT}`);
    console.log(`   Auth:     http://localhost:${PORT}/api/auth`);
    console.log(`   Advisory: http://localhost:${PORT}/api/advisory`);
    console.log(`   User:     http://localhost:${PORT}/api/user`);
    console.log(`   Health:   http://localhost:${PORT}/health`);
});

module.exports = app;
