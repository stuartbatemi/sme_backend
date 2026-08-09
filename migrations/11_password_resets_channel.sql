-- 11_password_resets_channel.sql
-- Adds a `channel` column so a password_resets row can represent:
--   method='link', channel='email'          -> emailed reset link
--   method='otp',  channel='email'          -> 6-digit code emailed
--   method='otp',  channel='sms'            -> 6-digit code texted to +255 number
-- Existing rows (all email, pre-dating this migration) default to 'email'.

ALTER TABLE password_resets
    ADD COLUMN channel ENUM('email','sms') NOT NULL DEFAULT 'email' AFTER method;

ALTER TABLE password_resets
    ADD INDEX idx_channel (channel);
