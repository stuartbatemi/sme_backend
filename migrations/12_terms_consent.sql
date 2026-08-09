-- 12_terms_consent.sql
-- Records consent at sign-up, per Tanzania's Personal Data Protection
-- Act, 2022 (PDPA), which requires consent to be specific, informed,
-- and freely given, and requires being able to show that consent was
-- actually obtained (not just assumed).
--
--   terms_accepted_at  — when the person accepted the Terms of Service
--                         and Privacy Policy. NULL means never recorded
--                         (only possible for accounts created before
--                         this migration ran — new registrations always
--                         set this, since the backend now rejects
--                         registration without terms_accepted=true).
--   marketing_opt_in    — separate, optional consent for non-essential
--                         communications (tips/updates emails). Kept
--                         apart from terms_accepted_at on purpose: PDPA
--                         consent should be specific to its purpose,
--                         and bundling "use the service" consent with
--                         "send me marketing" consent is exactly the
--                         kind of non-freely-given consent the Act
--                         disfavours.

ALTER TABLE users
    ADD COLUMN terms_accepted_at DATETIME     DEFAULT NULL AFTER tier,
    ADD COLUMN marketing_opt_in  BOOLEAN      NOT NULL DEFAULT FALSE AFTER terms_accepted_at;
