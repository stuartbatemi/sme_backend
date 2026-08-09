// routes/auth.js
// Handles: /api/auth/register, /api/auth/login,
//          /api/auth/refresh, /api/auth/logout

const express  = require('express');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const axios    = require('axios');
const db       = require('../db');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { body, validationResult } = require('express-validator');

const { sendMail, otpEmail, linkEmail } = require('../utils/mailer');
const { sendSms, otpSms, normalizeTzPhone } = require('../utils/sms');

const router = express.Router();

const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY;
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// ── Helper ────────────────────────────────────────────────────────
function hashToken(token) {
    // We store a hash of the refresh token, not the raw token
    return crypto.createHash('sha256').update(token).digest('hex');
}

// Verifies a Cloudflare Turnstile token server-side — the frontend
// widget only proves a token *exists*; it can't be trusted on its own,
// since anyone can forge a request without ever loading the widget.
// The real check has to happen here, against Cloudflare's API, using
// our secret key.
//
// If TURNSTILE_SECRET_KEY isn't configured (e.g. local dev without a
// Cloudflare account set up yet), this fails OPEN — registration is
// allowed to proceed without a bot check — rather than locking
// everyone out of local development. In any real deployment, set
// TURNSTILE_SECRET_KEY so this actually enforces the check.
async function verifyTurnstile(token, remoteIp) {
    if (!TURNSTILE_SECRET_KEY) {
        return { ok: true, skipped: true };
    }
    if (!token) {
        return { ok: false, skipped: false };
    }
    try {
        const params = new URLSearchParams();
        params.append('secret', TURNSTILE_SECRET_KEY);
        params.append('response', token);
        if (remoteIp) params.append('remoteip', remoteIp);

        const { data } = await axios.post(TURNSTILE_VERIFY_URL, params, { timeout: 10000 });
        return { ok: data?.success === true, skipped: false };
    } catch (err) {
        console.error('Turnstile verification request failed:', err.message);
        // Cloudflare being unreachable shouldn't be indistinguishable
        // from a failed human check, but it also shouldn't silently
        // let bots through — treat a verification-service outage as a
        // failed check and let the person retry.
        return { ok: false, skipped: false };
    }
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
    body('terms_accepted').custom((value) => value === true || value === 'true')
        .withMessage('You must accept the Terms of Service and Privacy Policy.'),
], async (req, res) => {
    // Validate inputs
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const {
        full_name, email, password, phone, gender, age, district, ward, village,
        marketing_opt_in, turnstile_token,
    } = req.body;

    try {
        const captcha = await verifyTurnstile(turnstile_token, req.ip);
        if (!captcha.ok) {
            return res.status(400).json({ error: 'Bot verification failed. Please try again.' });
        }

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
             (full_name, email, password_hash, phone, gender, age, district, ward, village, tier, terms_accepted_at, marketing_opt_in)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'regular', NOW(), ?)`,
            [full_name, email, password_hash,
             phone || null, gender || null, age || null,
             district || null, ward || null, village || null,
             marketing_opt_in === true || marketing_opt_in === 'true']
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
               AND created_at > (UTC_TIMESTAMP() - INTERVAL 15 MINUTE)`,
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
            'SELECT id, user_id FROM refresh_tokens WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP()',
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

// ── POST /api/auth/forgot-password ────────────────────────────────
// Body: { method: 'email_link' | 'email_otp' | 'sms_otp', email?, phone? }
// email is required for email_link/email_otp; phone (+255...) for sms_otp.
// Always responds with the same generic message whether or not the
// account exists — this prevents attackers from using this endpoint
// to discover which emails/phones are registered (user enumeration).
router.post('/forgot-password', [
    body('method').isIn(['email_link', 'email_otp', 'sms_otp']),
    body('email').if(body('method').isIn(['email_link', 'email_otp'])).isEmail().normalizeEmail(),
    body('phone').if(body('method').equals('sms_otp')).trim().isLength({ min: 9 }).withMessage('Enter a valid phone number'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { method, email, phone } = req.body;
    const GENERIC_RESPONSE = { message: 'If an account exists, we\u2019ve sent instructions.' };

    try {
        let user;
        if (method === 'sms_otp') {
            const target9 = normalizeTzPhone(phone).slice(-9);
            const [rows] = await db.query(
                `SELECT id, phone FROM users
                 WHERE RIGHT(REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', ''), 9) = ?`,
                [target9]
            );
            user = rows[0];
        } else {
            const [rows] = await db.query('SELECT id, email FROM users WHERE email = ?', [email]);
            user = rows[0];
        }

        if (!user) {
            // Don't reveal whether the account exists — respond the same either way.
            return res.status(200).json(GENERIC_RESPONSE);
        }

        if (method === 'sms_otp') {
            const otp = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
            const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

            await db.query(
                `INSERT INTO password_resets (user_id, method, channel, code_hash, expires_at, ip_address)
                 VALUES (?, 'otp', 'sms', ?, ?, ?)`,
                [user.id, hashToken(otp), expiresAt, req.ip || null]
            );

            await sendSms(user.phone, otpSms(otp));
        } else if (method === 'email_otp') {
            const otp = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
            const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

            await db.query(
                `INSERT INTO password_resets (user_id, method, channel, code_hash, expires_at, ip_address)
                 VALUES (?, 'otp', 'email', ?, ?, ?)`,
                [user.id, hashToken(otp), expiresAt, req.ip || null]
            );

            const { subject, html, text } = otpEmail(otp);
            await sendMail({ to: user.email, subject, html, text });
        } else {
            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

            await db.query(
                `INSERT INTO password_resets (user_id, method, channel, code_hash, expires_at, ip_address)
                 VALUES (?, 'link', 'email', ?, ?, ?)`,
                [user.id, hashToken(token), expiresAt, req.ip || null]
            );

            const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${token}`;
            const { subject, html, text } = linkEmail(resetUrl);
            await sendMail({ to: user.email, subject, html, text });
        }

        return res.status(200).json(GENERIC_RESPONSE);
    } catch (err) {
        console.error('Forgot-password error:', err);
        // Still respond generically — don't leak whether something broke
        // for this specific account vs. it simply not existing.
        return res.status(200).json(GENERIC_RESPONSE);
    }
});


// ── POST /api/auth/reset-password/otp ─────────────────────────────
// Body: { channel: 'email' | 'sms', email?, phone?, otp, new_password }
router.post('/reset-password/otp', [
    body('channel').isIn(['email', 'sms']),
    body('email').if(body('channel').equals('email')).isEmail().normalizeEmail(),
    body('phone').if(body('channel').equals('sms')).trim().isLength({ min: 9 }).withMessage('Enter a valid phone number'),
    body('otp').trim().isLength({ min: 6, max: 6 }).withMessage('Enter the 6-digit code'),
    body('new_password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { channel, email, phone, otp, new_password } = req.body;
    const INVALID = { error: 'That code is invalid or has expired.' };

    try {
        let userId;
        if (channel === 'sms') {
            const target9 = normalizeTzPhone(phone).slice(-9);
            const [userRows] = await db.query(
                `SELECT id FROM users
                 WHERE RIGHT(REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', ''), 9) = ?`,
                [target9]
            );
            if (userRows.length === 0) return res.status(400).json(INVALID);
            userId = userRows[0].id;
        } else {
            const [userRows] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
            if (userRows.length === 0) return res.status(400).json(INVALID);
            userId = userRows[0].id;
        }

        const [resetRows] = await db.query(
            `SELECT id FROM password_resets
             WHERE user_id = ? AND method = 'otp' AND channel = ? AND code_hash = ?
               AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()
             ORDER BY id DESC LIMIT 1`,
            [userId, channel, hashToken(otp)]
        );
        if (resetRows.length === 0) {
            return res.status(400).json(INVALID);
        }

        const password_hash = await bcrypt.hash(new_password, 12);
        await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash, userId]);
        await db.query('UPDATE password_resets SET used_at = UTC_TIMESTAMP() WHERE id = ?', [resetRows[0].id]);
        // Invalidate existing sessions so a stolen refresh token can't survive a reset.
        await db.query('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);

        return res.status(200).json({ message: 'Your password has been reset. You can now log in.' });
    } catch (err) {
        console.error('Reset-password (otp) error:', err);
        return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
});


// ── POST /api/auth/reset-password/link ────────────────────────────
// Body: { token, new_password }
router.post('/reset-password/link', [
    body('token').trim().notEmpty(),
    body('new_password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { token, new_password } = req.body;

    try {
        const [resetRows] = await db.query(
            `SELECT id, user_id FROM password_resets
             WHERE method = 'link' AND code_hash = ?
               AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()
             ORDER BY id DESC LIMIT 1`,
            [hashToken(token)]
        );
        if (resetRows.length === 0) {
            return res.status(400).json({ error: 'That link is invalid or has expired.' });
        }
        const userId = resetRows[0].user_id;

        const password_hash = await bcrypt.hash(new_password, 12);
        await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash, userId]);
        await db.query('UPDATE password_resets SET used_at = UTC_TIMESTAMP() WHERE id = ?', [resetRows[0].id]);
        await db.query('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);

        return res.status(200).json({ message: 'Your password has been reset. You can now log in.' });
    } catch (err) {
        console.error('Reset-password (link) error:', err);
        return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
});


module.exports = router;
