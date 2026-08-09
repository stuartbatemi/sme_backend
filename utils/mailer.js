// utils/mailer.js — outbound email for password resets
//
// Uses nodemailer with plain SMTP creds from .env. If SMTP env vars
// aren't set (e.g. local dev without a mail account configured), we
// don't throw — we log the message to the console instead, the same
// "never block the main flow" pattern used by logLoginEvent in
// routes/auth.js. This means forgot-password always "succeeds" from
// the user's point of view even if email isn't configured yet; you'll
// just see the OTP/link printed in the server console during dev.

const nodemailer = require('nodemailer');

let transporter = null;
function getTransporter() {
    if (transporter) return transporter;
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
        return null; // not configured
    }
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true', // true for port 465, false for others
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
        },
    });
    return transporter;
}

async function sendMail({ to, subject, html, text }) {
    const t = getTransporter();
    const from = process.env.SMTP_FROM || 'Fursa <no-reply@fursa.app>';

    if (!t) {
        // Dev fallback — never blocks the request, just makes the
        // message visible so you can still test the flow locally.
        console.warn('⚠️  SMTP not configured — printing email instead of sending:');
        console.warn(`To: ${to}\nSubject: ${subject}\n${text || html}`);
        return { delivered: false };
    }

    try {
        await t.sendMail({ from, to, subject, html, text });
        return { delivered: true };
    } catch (err) {
        console.error('sendMail failed (non-fatal):', err.message);
        return { delivered: false };
    }
}

function otpEmail(otp) {
    return {
        subject: 'Your Fursa password reset code',
        text: `Your password reset code is ${otp}. It expires in 15 minutes. If you didn't request this, you can ignore this email.`,
        html: `<p>Your Fursa password reset code is:</p>
               <p style="font-size:28px;font-weight:700;letter-spacing:4px;">${otp}</p>
               <p>This code expires in 15 minutes. If you didn't request this, you can safely ignore this email.</p>`,
    };
}

function linkEmail(resetUrl) {
    return {
        subject: 'Reset your Fursa password',
        text: `Reset your password using this link (expires in 30 minutes): ${resetUrl}\nIf you didn't request this, you can ignore this email.`,
        html: `<p>Click the button below to reset your Fursa password. This link expires in 30 minutes.</p>
               <p><a href="${resetUrl}" style="background:#E8A838;color:#111;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700;">Reset password</a></p>
               <p>Or paste this URL into your browser:<br>${resetUrl}</p>
               <p>If you didn't request this, you can safely ignore this email.</p>`,
    };
}

module.exports = { sendMail, otpEmail, linkEmail };
