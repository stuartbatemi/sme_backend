-- ============================================================
-- SME ADVISORY APP — MySQL Database Schema
-- Run this entire file in MySQL Workbench once.
-- Database: sme_project (you already have this)
-- ============================================================

USE sme_project;

-- ----------------------------------------------------------------
-- TABLE 1: users
-- Stores Premium user accounts only.
-- Regular users are never saved to the database.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    full_name     VARCHAR(120)        NOT NULL,
    email         VARCHAR(255)        NOT NULL UNIQUE,
    password_hash VARCHAR(255)        NOT NULL,          -- bcrypt hash, NEVER plain text
    phone         VARCHAR(30)         DEFAULT NULL,
    gender        ENUM('male','female','other') DEFAULT NULL,
    age           TINYINT UNSIGNED    DEFAULT NULL,
    district      VARCHAR(100)        DEFAULT NULL,
    ward          VARCHAR(100)        DEFAULT NULL,
    village       VARCHAR(100)        DEFAULT NULL,
    tier          ENUM('regular','premium') NOT NULL DEFAULT 'regular',
    is_active     BOOLEAN             NOT NULL DEFAULT TRUE,
    created_at    DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Indexes for fast lookups at scale
    INDEX idx_email      (email),
    INDEX idx_tier       (tier),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ----------------------------------------------------------------
-- TABLE 2: refresh_tokens
-- Stores JWT refresh tokens so users can stay logged in.
-- Separate table = we can invalidate one device without logging
-- out all devices (important for 1000+ users on multiple devices).
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id     INT UNSIGNED    NOT NULL,
    token_hash  VARCHAR(255)    NOT NULL UNIQUE,   -- hashed token, not raw
    device_info VARCHAR(255)    DEFAULT NULL,       -- optional: "Chrome on Windows"
    expires_at  DATETIME        NOT NULL,
    created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id   (user_id),
    INDEX idx_expires   (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ----------------------------------------------------------------
-- TABLE 3: advisory_sessions
-- Every time a Premium user runs a prediction, we save one row
-- here. This is their "history" — they can look back at past
-- reports and track how their thinking has evolved over time.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS advisory_sessions (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id         INT UNSIGNED    NOT NULL,
    path_type       ENUM('A','B')   NOT NULL,          -- A = has idea, B = no idea
    
    -- Inputs the user provided
    business_idea   VARCHAR(255)    DEFAULT NULL,       -- free-text description they typed
    district        VARCHAR(100)    NOT NULL,
    ward            VARCHAR(100)    DEFAULT NULL,
    village         VARCHAR(100)    DEFAULT NULL,
    capital_tzs     DECIMAL(15,2)   DEFAULT NULL,
    age_at_query    TINYINT UNSIGNED DEFAULT NULL,
    gender          ENUM('male','female','other') DEFAULT NULL,
    isic_code       SMALLINT UNSIGNED DEFAULT NULL,     -- Path A only

    -- What the model returned (stored as JSON — flexible, future-proof)
    -- JSON type is supported in MySQL 5.7.8+
    result_json     JSON            NOT NULL,

    -- Quick-access columns (pulled from result_json) for dashboard queries
    -- without having to parse JSON every time
    success_chance  ENUM('Low','Medium','High') DEFAULT NULL,  -- Path A
    monthly_profit  DECIMAL(15,2)   DEFAULT NULL,
    roi_percent     DECIMAL(8,2)    DEFAULT NULL,
    breakeven_months DECIMAL(6,1)   DEFAULT NULL,

    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id    (user_id),
    INDEX idx_path_type  (path_type),
    INDEX idx_created_at (created_at),
    INDEX idx_success    (success_chance)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ----------------------------------------------------------------
-- TABLE 4: payments
-- Tracks when users upgrade to Premium (and any future billing).
-- Even if you use a payment gateway (M-Pesa, Stripe), store a
-- local record so you can verify Premium status without an
-- external API call on every login.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id         INT UNSIGNED    NOT NULL,
    amount_tzs      DECIMAL(12,2)   NOT NULL,
    currency        VARCHAR(10)     NOT NULL DEFAULT 'TZS',
    payment_method  VARCHAR(50)     DEFAULT NULL,       -- e.g. 'mpesa', 'card', 'manual'
    reference_no    VARCHAR(150)    DEFAULT NULL UNIQUE, -- gateway transaction ID
    status          ENUM('pending','completed','failed','refunded') NOT NULL DEFAULT 'pending',
    paid_at         DATETIME        DEFAULT NULL,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id  (user_id),
    INDEX idx_status   (status),
    INDEX idx_paid_at  (paid_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ----------------------------------------------------------------
-- TABLE 5: login_events
-- A log of every login attempt (successful AND failed), every
-- registration, and every logout — so you can see real activity on
-- the app as it happens, just by querying this table, e.g.:
--
--   -- who's logged in in the last 15 minutes
--   SELECT * FROM login_events
--   WHERE event_type = 'login_success' AND created_at > NOW() - INTERVAL 15 MINUTE
--   ORDER BY created_at DESC;
--
--   -- failed login attempts in the last hour (security check)
--   SELECT email_attempted, COUNT(*) as attempts, MAX(created_at) as last_attempt
--   FROM login_events
--   WHERE event_type = 'login_failed' AND created_at > NOW() - INTERVAL 1 HOUR
--   GROUP BY email_attempted ORDER BY attempts DESC;
--
-- user_id is NULLABLE on purpose: a failed login for an email that
-- isn't even a registered user (typo, or someone probing emails)
-- still gets logged, but there's no real user_id to attach it to.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_events (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id         INT UNSIGNED    DEFAULT NULL,       -- NULL if email didn't match any account
    email_attempted VARCHAR(255)    DEFAULT NULL,       -- what was typed, even if it failed
    event_type      ENUM('login_success','login_failed','register','logout') NOT NULL,
    fail_reason     VARCHAR(100)    DEFAULT NULL,       -- e.g. 'invalid_password', 'unknown_email', 'account_deactivated'
    tier_at_event   ENUM('regular','premium') DEFAULT NULL,  -- snapshot of tier at the moment of this event
    ip_address      VARCHAR(45)     DEFAULT NULL,       -- IPv4 or IPv6
    user_agent      VARCHAR(255)    DEFAULT NULL,       -- browser/device string from the request
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user_id    (user_id),
    INDEX idx_event_type (event_type),
    INDEX idx_created_at (created_at),
    INDEX idx_email      (email_attempted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ----------------------------------------------------------------
-- VERIFY: show all created tables
-- ----------------------------------------------------------------
SHOW TABLES;
