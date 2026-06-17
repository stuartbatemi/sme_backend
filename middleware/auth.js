// middleware/auth.js
// Protects routes that require a logged-in Premium user.
// React sends: Authorization: Bearer <access_token>

const { verifyAccessToken } = require('../utils/jwt');

function requireAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided. Please log in.' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const payload = verifyAccessToken(token);
        req.user = payload;   // { userId, tier }
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired. Please refresh.' });
        }
        return res.status(401).json({ error: 'Invalid token. Please log in again.' });
    }
}

// Extra check: only Premium users can access certain routes
function requirePremium(req, res, next) {
    if (req.user?.tier !== 'premium') {
        return res.status(403).json({
            error: 'Premium subscription required.',
            upgrade_message: 'Upgrade to Premium to access your history and advanced reports.'
        });
    }
    next();
}

module.exports = { requireAuth, requirePremium };
