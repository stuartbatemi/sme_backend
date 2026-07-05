// routes/user.js
// Handles: GET /api/user/me, PATCH /api/user/me, POST /api/user/upgrade

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { generateAccessToken } = require('../utils/jwt');
const { body, validationResult } = require('express-validator');

const router = express.Router();

const ALLOWED_PAYMENT_METHODS = ['mpesa', 'card', 'manual', 'demo'];

// ── GET /api/user/me ──────────────────────────────────────────────
// Returns the logged-in user's profile.
router.get('/me', requireAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT id, full_name, email, phone, gender, age,
                    district, ward, village, tier, created_at
             FROM users WHERE id = ?`,
            [req.user.userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        return res.status(200).json(rows[0]);

    } catch (err) {
        return res.status(500).json({ error: 'Failed to fetch profile.' });
    }
});


// ── PATCH /api/user/me ────────────────────────────────────────────
// Update profile details (not email or password - those need separate flow).
router.patch('/me', requireAuth, async (req, res) => {
    const allowed = ['full_name', 'phone', 'gender', 'age', 'district', 'ward', 'village'];
    const updates = {};

    for (const key of allowed) {
        if (req.body[key] !== undefined) {
            updates[key] = req.body[key];
        }
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update.' });
    }

    try {
        const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        const values = [...Object.values(updates), req.user.userId];

        await db.query(`UPDATE users SET ${fields} WHERE id = ?`, values);

        return res.status(200).json({ message: 'Profile updated successfully.' });

    } catch (err) {
        return res.status(500).json({ error: 'Failed to update profile.' });
    }
});


// ── POST /api/user/upgrade ────────────────────────────────────────
// Upgrades a Regular user to Premium.
//
// SECURITY NOTE — read this before wiring real money:
// This endpoint used to trust whatever the client sent as "proof of
// payment" and upgrade unconditionally. That meant ANY logged-in user
// could get Premium for free with a single API call, with no payment
// at all — nothing here actually checked that money changed hands.
//
// Until Stripe/M-Pesa webhooks are wired in (on the roadmap), this is
// gated behind ALLOW_DEMO_PAYMENTS so it only works while you're
// explicitly in demo/coursework mode. Set ALLOW_DEMO_PAYMENTS=false
// (or remove it) the moment you accept real payments, and replace the
// body of this handler with logic that verifies a Stripe webhook
// signature / M-Pesa callback server-side BEFORE ever touching the
// users table — never trust a client-supplied reference_no by itself.
router.post('/upgrade', requireAuth, [
    body('amount_tzs').optional().isFloat({ min: 0 }),
    body('payment_method').optional().isIn(ALLOWED_PAYMENT_METHODS),
    body('reference_no').optional().isString().isLength({ max: 150 }).trim(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    if (process.env.ALLOW_DEMO_PAYMENTS !== 'true') {
        return res.status(501).json({
            error: 'Real payment verification is not yet configured. Upgrade unavailable.'
        });
    }

    const { amount_tzs, payment_method, reference_no } = req.body;

    try {
        // Idempotent: if they're already premium, don't log a second
        // payment row or hit the DB write path again — just confirm.
        const [[user]] = await db.query('SELECT tier FROM users WHERE id = ?', [req.user.userId]);
        if (user?.tier === 'premium') {
            const accessToken = generateAccessToken(req.user.userId, 'premium');
            return res.status(200).json({
                message: 'Already Premium.',
                access_token: accessToken,
                tier: 'premium',
            });
        }

        // Flagged clearly in logs as a demo/manual upgrade, not a
        // verified payment, so this is easy to spot/filter later.
        console.warn(`[DEMO PAYMENT] user_id=${req.user.userId} amount=${amount_tzs || 0} method=${payment_method || 'demo'} ref=${reference_no || 'none'}`);

        await db.query(
            `INSERT INTO payments (user_id, amount_tzs, payment_method, reference_no, status, paid_at)
             VALUES (?, ?, ?, ?, 'completed', NOW())`,
            [req.user.userId, amount_tzs || 0, payment_method || 'demo', reference_no || `demo-${req.user.userId}-${Date.now()}`]
        );

        await db.query(
            "UPDATE users SET tier = 'premium' WHERE id = ?",
            [req.user.userId]
        );

        const newAccessToken = generateAccessToken(req.user.userId, 'premium');

        return res.status(200).json({
            message: 'Upgraded to Premium successfully! (demo mode — no real payment was processed)',
            access_token: newAccessToken,
            tier: 'premium',
        });

    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'This payment reference has already been used.' });
        }
        console.error('Upgrade error:', err);
        return res.status(500).json({ error: 'Upgrade failed. Please try again.' });
    }
});


// ── GET /api/user/stats ───────────────────────────────────────────
// Premium dashboard stats: total sessions, average ROI, etc.
router.get('/stats', requireAuth, async (req, res) => {
    if (req.user.tier !== 'premium') {
        return res.status(403).json({ error: 'Premium required.' });
    }

    try {
        const [[stats]] = await db.query(
            `SELECT
                COUNT(*)                          AS total_sessions,
                SUM(path_type = 'A')              AS path_a_count,
                SUM(path_type = 'B')              AS path_b_count,
                AVG(monthly_profit)               AS avg_monthly_profit,
                AVG(roi_percent)                  AS avg_roi,
                SUM(success_chance = 'High')      AS high_count,
                SUM(success_chance = 'Medium')    AS medium_count,
                SUM(success_chance = 'Low')       AS low_count,
                MIN(created_at)                   AS first_session,
                MAX(created_at)                   AS last_session
             FROM advisory_sessions
             WHERE user_id = ?`,
            [req.user.userId]
        );

        return res.status(200).json(stats);

    } catch (err) {
        return res.status(500).json({ error: 'Failed to fetch stats.' });
    }
});

module.exports = router;
