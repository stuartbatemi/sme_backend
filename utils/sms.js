// utils/sms.js — outbound SMS via Beem Africa, used for phone-OTP password resets
//
// Docs: https://docs.beem.africa/ (POST https://apisms.beem.africa/v1/send,
// Basic Auth of "<api_key>:<secret_key>" base64-encoded, JSON body).
//
// Same non-fatal philosophy as utils/mailer.js: if BEEM_API_KEY /
// BEEM_SECRET_KEY aren't set, we don't crash — we log to console so
// the OTP is still visible for local testing.

const axios = require('axios');

const BEEM_URL = 'https://apisms.beem.africa/v1/send';

// Tanzanian mobile numbers are 9 digits after the country code (255).
// Accepts "+255700000001", "255700000001", "0700000001", or with
// spaces/dashes — normalizes all of them to "255700000001".
function normalizeTzPhone(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    const last9 = digits.slice(-9);
    return `255${last9}`;
}

function isConfigured() {
    return !!(process.env.BEEM_API_KEY && process.env.BEEM_SECRET_KEY);
}

async function sendSms(phone, message) {
    const destAddr = normalizeTzPhone(phone);

    if (!isConfigured()) {
        console.warn('⚠️  Beem Africa not configured — printing SMS instead of sending:');
        console.warn(`To: ${destAddr}\nMessage: ${message}`);
        return { delivered: false };
    }

    try {
        const auth = Buffer.from(`${process.env.BEEM_API_KEY}:${process.env.BEEM_SECRET_KEY}`).toString('base64');
        const { data } = await axios.post(BEEM_URL, {
            source_addr: process.env.BEEM_SENDER_ID || 'INFO',
            encoding: 0,
            schedule_time: '',
            message,
            recipients: [{ recipient_id: 1, dest_addr: destAddr }],
        }, {
            headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/json',
            },
            timeout: 10000,
        });

        if (data && data.successful) {
            return { delivered: true };
        }
        console.error('Beem SMS not accepted:', data);
        return { delivered: false };
    } catch (err) {
        console.error('sendSms failed (non-fatal):', err.response?.data || err.message);
        return { delivered: false };
    }
}

function otpSms(otp) {
    return `Your Fursa password reset code is ${otp}. It expires in 15 minutes. Don't share this code with anyone.`;
}

module.exports = { sendSms, otpSms, normalizeTzPhone };
