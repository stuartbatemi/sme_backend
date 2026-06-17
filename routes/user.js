// routes/user.js
// Handles: GET /api/user/me, PATCH /api/user/me, POST /api/user/upgrade

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { generateAccessToken } = require('../utils/jwt');

const router = express.Router();

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
// Upgrades a Regular user to Premium after payment confirmation.
// In production: verify the payment reference with M-Pesa/Stripe
// before upgrading. For now: manual/demo upgrade.
router.post('/upgrade', requireAuth, async (req, res) => {
    const { amount_tzs, payment_method, reference_no } = req.body;

    try {
        // Record payment
        await db.query(
            `INSERT INTO payments (user_id, amount_tzs, payment_method, reference_no, status, paid_at)
             VALUES (?, ?, ?, ?, 'completed', NOW())`,
            [req.user.userId, amount_tzs || 0, payment_method || 'manual', reference_no || null]
        );

        // Upgrade user tier
        await db.query(
            "UPDATE users SET tier = 'premium' WHERE id = ?",
            [req.user.userId]
        );

        // Issue new access token reflecting premium tier
        const newAccessToken = generateAccessToken(req.user.userId, 'premium');

        return res.status(200).json({
            message: 'Upgraded to Premium successfully!',
            access_token: newAccessToken,
            tier: 'premium',
        });

    } catch (err) {
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
