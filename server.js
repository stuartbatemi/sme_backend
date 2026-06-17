// server.js — Main Express server
// Start with: npm run dev (development) or npm start (production)

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');

// Routes
const authRoutes     = require('./routes/auth');
const advisoryRoutes = require('./routes/advisory');
const userRoutes     = require('./routes/user');

// Initialize DB connection pool (runs on import)
require('./db');

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ────────────────────────────────────────────────────

// CORS — allow React (port 3000 or 5173) to call this server
app.use(cors({
    origin: [
        'http://localhost:3000',   // Create React App default
        'http://localhost:5173',   // Vite default
        'http://127.0.0.1:3000',
        'http://127.0.0.1:5173',
    ],
    credentials: true,
}));

app.use(express.json({ limit: '10kb' }));       // parse JSON, max 10kb per request
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting ─────────────────────────────────────────────────
// Prevents abuse: max 100 requests per 15 minutes per IP
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,   // 15 minutes
    max: 100,
    message: { error: 'Too many requests. Please wait a few minutes and try again.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Stricter limit for auth routes (prevent brute-force attacks)
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
    max: 20,               // 20 predictions per minute per IP
    message: { error: 'Too many requests. Please slow down.' },
});

app.use('/api/auth',           authLimiter);
app.use('/api/advisory',       predictLimiter);
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
