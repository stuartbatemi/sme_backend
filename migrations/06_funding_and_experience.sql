-- 06_funding_and_experience.sql
-- Adds funding-type context and prior-business-experience capture to
-- advisory_sessions, so recommendations can be weighted by real
-- entrepreneurial history and loan-seeking users get a risk tier.

ALTER TABLE advisory_sessions
    ADD COLUMN funding_type ENUM('personal', 'loan', 'expansion') DEFAULT NULL
        AFTER capital_tzs,
    ADD COLUMN prior_experience JSON DEFAULT NULL
        AFTER funding_type,
    -- prior_experience shape: [{"isic_detailed": 4711, "years": 3, "still_active": true}, ...]
    ADD COLUMN risk_tier ENUM('Low', 'Medium', 'High') DEFAULT NULL
        AFTER success_chance,
    ADD INDEX idx_funding_type (funding_type);
