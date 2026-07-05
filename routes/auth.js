// routes/auth.js
// Handles: /api/auth/register, /api/auth/login,
//          /api/auth/refresh, /api/auth/logout

const express  = require('express');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const db       = require('../db');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { body, validationResult } = require('express-validator');

const router = express.Router();

// ── Helper ────────────────────────────────────────────────────────
function hashToken(token) {
    // We store a hash of the refresh token, not the raw token
    return crypto.createHash('sha256').update(token).digest('hex');
}

// Records one row in login_events. Never throws — a logging failure
// should never block someone from actually logging in/registering, so
// every call site wraps this in its own try/catch and just logs to
// the console if it fails (the request itself still succeeds).
async function logLoginEvent(req, { userId = null, emailAttempted = null, eventType, failReason = null, tier = null }) {
    try {
        await db.query(
            `INSERT INTO login_events
             (user_id, email_attempted, event_type, fail_reason, tier_at_event, ip_address, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                emailAttempted,
                eventType,
                failReason,
                tier,
                req.ip || null,
                (req.headers['user-agent'] || '').slice(0, 255) || null,
            ]
        );
    } catch (err) {
        console.error('logLoginEvent failed (non-fatal):', err.message);
    }
}

// ── POST /api/auth/register ───────────────────────────────────────
router.post('/register', [
    body('full_name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
], async (req, res) => {
    // Validate inputs
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { full_name, email, password, phone, gender, age, district, ward, village } = req.body;

    try {
        // Check if email already exists
        const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(409).json({ error: 'An account with this email already exists.' });
        }

        // Hash the password (never store plain text!)
        const password_hash = await bcrypt.hash(password, 12);

        // Insert new user (starts as 'regular' tier — upgrades via payment)
        const [result] = await db.query(
            `INSERT INTO users 
             (full_name, email, password_hash, phone, gender, age, district, ward, village, tier)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'regular')`,
            [full_name, email, password_hash,
             phone || null, gender || null, age || null,
             district || null, ward || null, village || null]
        );

        const userId = result.insertId;

        // Generate tokens
        const accessToken  = generateAccessToken(userId, 'regular');
        const refreshToken = generateRefreshToken(userId);

        // Save hashed refresh token
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        await db.query(
            'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
            [userId, hashToken(refreshToken), expiresAt]
        );

        await logLoginEvent(req, { userId, emailAttempted: email, eventType: 'register', tier: 'regular' });

        return res.status(201).json({
            message: 'Account created successfully.',
            user: { id: userId, full_name, email, tier: 'regular' },
            access_token: accessToken,
            refresh_token: refreshToken,
        });

    } catch (err) {
        console.error('Register error:', err);
        return res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
});


// ── POST /api/auth/login ──────────────────────────────────────────
router.post('/login', [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
        // Account-level lockout: this catches brute-force attempts that
        // spread requests across many IPs to dodge the IP-based rate
        // limiter above. 8 failed attempts on THIS email in 15 minutes
        // blocks further tries regardless of which IP they come from.
        const [[{ recentFailures }]] = await db.query(
            `SELECT COUNT(*) AS recentFailures FROM login_events
             WHERE email_attempted = ? AND event_type = 'login_failed'
               AND created_at > (NOW() - INTERVAL 15 MINUTE)`,
            [email]
        );
        if (recentFailures >= 8) {
            return res.status(429).json({
                error: 'Too many failed login attempts on this account. Please wait 15 minutes and try again.'
            });
        }

        const [rows] = await db.query(
            'SELECT id, full_name, email, password_hash, tier, is_active FROM users WHERE email = ?',
            [email]
        );

        if (rows.length === 0) {
            await logLoginEvent(req, { emailAttempted: email, eventType: 'login_failed', failReason: 'unknown_email' });
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const user = rows[0];

        if (!user.is_active) {
            await logLoginEvent(req, { userId: user.id, emailAttempted: email, eventType: 'login_failed', failReason: 'account_deactivated', tier: user.tier });
            return res.status(403).json({ error: 'Account is deactivated. Contact support.' });
        }

        // Check password
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            await logLoginEvent(req, { userId: user.id, emailAttempted: email, eventType: 'login_failed', failReason: 'invalid_password', tier: user.tier });
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        // Generate tokens
        const accessToken  = generateAccessToken(user.id, user.tier);
        const refreshToken = generateRefreshToken(user.id);

        // Save refresh token
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await db.query(
            'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
            [user.id, hashToken(refreshToken), expiresAt]
        );

        await logLoginEvent(req, { userId: user.id, emailAttempted: email, eventType: 'login_success', tier: user.tier });

        return res.status(200).json({
            message: 'Login successful.',
            user: { id: user.id, full_name: user.full_name, email: user.email, tier: user.tier },
            access_token: accessToken,
            refresh_token: refreshToken,
        });

    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ error: 'Login failed. Please try again.' });
    }
});


// ── POST /api/auth/refresh ────────────────────────────────────────
// React calls this automatically when the access token expires.
router.post('/refresh', async (req, res) => {
    const { refresh_token } = req.body;
    if (!refresh_token) {
        return res.status(401).json({ error: 'Refresh token required.' });
    }

    try {
        const payload = verifyRefreshToken(refresh_token);
        const tokenHash = hashToken(refresh_token);

        // Check token exists and is not expired in DB
        const [rows] = await db.query(
            'SELECT id, user_id FROM refresh_tokens WHERE token_hash = ? AND expires_at > NOW()',
            [tokenHash]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Refresh token invalid or expired. Please log in again.' });
        }

        // Get user tier
        const [users] = await db.query('SELECT tier FROM users WHERE id = ?', [payload.userId]);
        const tier = users[0]?.tier || 'regular';

        // Issue new access token
        const newAccessToken = generateAccessToken(payload.userId, tier);

        return res.status(200).json({ access_token: newAccessToken });

    } catch (err) {
        return res.status(401).json({ error: 'Invalid refresh token.' });
    }
});


// ── POST /api/auth/logout ─────────────────────────────────────────
router.post('/logout', async (req, res) => {
    const { refresh_token } = req.body;
    if (refresh_token) {
        const tokenHash = hashToken(refresh_token);

        // Look up which user this token belonged to BEFORE deleting it,
        // so the logout event can be attributed to a real user_id.
        try {
            const [rows] = await db.query(
                'SELECT user_id FROM refresh_tokens WHERE token_hash = ?',
                [tokenHash]
            );
            if (rows.length > 0) {
                const [userRows] = await db.query('SELECT tier FROM users WHERE id = ?', [rows[0].user_id]);
                await logLoginEvent(req, {
                    userId: rows[0].user_id,
                    eventType: 'logout',
                    tier: userRows[0]?.tier || null,
                });
            }
        } catch (err) {
            console.error('Logout event lookup failed (non-fatal):', err.message);
        }

        // Delete this device's refresh token
        await db.query(
            'DELETE FROM refresh_tokens WHERE token_hash = ?',
            [tokenHash]
        );
    }
    return res.status(200).json({ message: 'Logged out successfully.' });
});

module.exports = router;
