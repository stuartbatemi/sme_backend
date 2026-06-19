// utils/jwt.js — JWT token helpers
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Generate a short-lived access token (15 minutes)
// This is what React sends with every request to prove identity.
function generateAccessToken(userId, tier) {
    return jwt.sign(
        { userId, tier },
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: process.env.JWT_ACCESS_EXPIRES || '10m' }
    );
}

// Generate a long-lived refresh token (7 days)
// Used to get a new access token without logging in again.
function generateRefreshToken(userId) {
    return jwt.sign(
        { userId },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d' }
    );
}

// Verify an access token — returns the payload or throws
function verifyAccessToken(token) {
    return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

// Verify a refresh token — returns the payload or throws
function verifyRefreshToken(token) {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
};
