-- 08_microfinance_eligibility_sw.sql
-- Adds a Swahili translation column for eligibility_summary, so the
-- microfinance/bank recommendation list can render in Swahili when
-- the site is in Swahili mode. Nullable — if a row has no Swahili
-- translation yet, the route falls back to the English summary
-- rather than showing blank text.

ALTER TABLE microfinance_institutions
  ADD COLUMN eligibility_summary_sw TEXT DEFAULT NULL AFTER eligibility_summary;
