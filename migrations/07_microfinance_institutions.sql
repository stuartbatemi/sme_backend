-- 07_microfinance_institutions.sql
-- Reference table of microfinance institutions / SME-lending banks
-- operating in Dar es Salaam. Seeded once; update via admin as terms
-- change (rates/eligibility shift over time — don't treat as static
-- forever). This is REFERENCE DATA shown to users considering a loan,
-- not a live rates feed.

CREATE TABLE IF NOT EXISTS microfinance_institutions (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name                VARCHAR(150)  NOT NULL,
    type                ENUM('bank', 'microfinance', 'sacco', 'digital_lender') NOT NULL,
    min_loan_tzs        DECIMAL(15,2) DEFAULT NULL,
    max_loan_tzs        DECIMAL(15,2) DEFAULT NULL,
    typical_interest_note VARCHAR(255) DEFAULT NULL,
    eligibility_summary TEXT          NOT NULL,
    website             VARCHAR(255)  DEFAULT NULL,
    suited_risk_tiers   SET('Low','Medium','High') DEFAULT 'Low,Medium,High',
    active              BOOLEAN       DEFAULT TRUE,
    last_verified       DATE          DEFAULT NULL,
    created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_type (type),
    INDEX idx_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
