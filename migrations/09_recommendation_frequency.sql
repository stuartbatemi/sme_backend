-- 09_recommendation_frequency.sql
-- Tracks how often each activity gets recommended in Path B results,
-- system-wide (not per-user), so the same handful of "obviously good"
-- businesses don't dominate everyone's results forever. The backend
-- queries recent counts before calling the model, passes them in as a
-- soft ranking penalty (frequency_penalty_isic), then logs the
-- activities actually shown after the response comes back.
--
-- Deliberately a simple event log, not a running counter: querying
-- "count in the last N days" from raw events is easy to reason about
-- and easy to change the window on later without a migration.

CREATE TABLE IF NOT EXISTS recommendation_events (
    id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    isic_detailed  INT UNSIGNED NOT NULL,
    district       VARCHAR(100) DEFAULT NULL,
    recommended_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_isic_time (isic_detailed, recommended_at),
    INDEX idx_time (recommended_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Housekeeping note (not automated here — run periodically, e.g. via a
-- cron job or manual maintenance): old rows beyond the scoring window
-- are safe to delete since only recent counts matter for the penalty.
--   DELETE FROM recommendation_events WHERE recommended_at < NOW() - INTERVAL 30 DAY;
