-- 10_password_resets.sql
-- Supports both password-reset methods offered on the login screen:
--   method = 'link'  -> code_hash stores a hashed reset TOKEN (used in a URL)
--   method = 'otp'   -> code_hash stores a hashed 6-digit OTP
-- Only one active (unused, unexpired) row is meaningful per user at a time;
-- requesting a new reset does not delete old rows, it just makes them
-- irrelevant once a newer one is created (older ones simply expire/are unused).

CREATE TABLE IF NOT EXISTS password_resets (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id     INT UNSIGNED            NOT NULL,
    method      ENUM('link','otp')      NOT NULL,
    code_hash   VARCHAR(255)            NOT NULL,
    expires_at  DATETIME                NOT NULL,
    used_at     DATETIME                DEFAULT NULL,
    ip_address  VARCHAR(45)             DEFAULT NULL,
    created_at  DATETIME                NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id    (user_id),
    INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
