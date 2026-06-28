CREATE TABLE IF NOT EXISTS users (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    full_name     VARCHAR(120)        NOT NULL,
    email         VARCHAR(255)        NOT NULL UNIQUE,
    password_hash VARCHAR(255)        NOT NULL,
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
    INDEX idx_email      (email),
    INDEX idx_tier       (tier),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
