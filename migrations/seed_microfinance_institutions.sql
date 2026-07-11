-- seed_microfinance_institutions.sql
-- Run AFTER 07_microfinance_institutions.sql
-- Sourced from each institution's own site (checked July 2026). Loan
-- ranges/eligibility notes are the institutions' OWN stated terms,
-- paraphrased — not invented. Re-verify before your presentation and
-- again periodically after launch (add last_verified date).
-- Sources: nmbbank.co.tz, crdbbank.co.tz, accessmfb.co.tz (Access/Selcom
-- Microfinance Bank), self.go.tz (SELF Microfinance Fund, government-
-- owned), BOT Tier 2 MFI register (bot.go.tz), tanzania.asa-international.com,
-- zoomtanzania.net microfinance directory.

INSERT INTO microfinance_institutions
(name, type, min_loan_tzs, max_loan_tzs, typical_interest_note, eligibility_summary, website, suited_risk_tiers, last_verified)
VALUES

('CRDB Bank — SME/MSE Loans', 'bank', NULL, NULL,
 'Varies by product (working capital, asset finance, invoice/LPO discounting); ask branch for current rate.',
 'Requires opening a CRDB Business (BIDII/HODARI) account. Different products for different needs: working capital, asset financing, invoice/purchase-order discounting. Good track record and account conduct history strengthens the application; some products need prior successfully completed contracts.',
 'https://crdbbank.co.tz/en/for-business/business-loans/sme-loan', 'Medium,High', '2026-07-10'),

('NMB Bank — SME Loans', 'bank', NULL, NULL,
 'Varies by product; flexible installment terms for irregular cash flow businesses.',
 'Applicant must show a proper record-keeping system and demonstrate the business operates profitably. Business must be located within an area served by an NMB branch. SMEs can graduate to corporate loans over time.',
 'https://www.nmbbank.co.tz/business-banking/business-banking/sme-loans', 'Medium,High', '2026-07-10'),

('NMB Bank — MSE Loans', 'bank', NULL, NULL,
 'Repayment period up to 24 months, structured around micro/small business cash flow.',
 'Same core requirements as SME loans but sized for micro and small enterprises. Loan can be used for any officially licensed business purpose. Large existing branch/agent network makes this broadly accessible in Dar es Salaam.',
 'https://www.nmbbank.co.tz/business-banking/business-banking/mse-loans', 'Low,Medium', '2026-07-10'),

('Selcom Microfinance Bank (formerly Access Microfinance Bank Tanzania) — SME Loans', 'microfinance', 35000001, NULL,
 'Interest paid only; institution states no hidden fees or commissions.',
 'No audited financial statements required. No prior relationship with the bank required. Flexible collateral (household goods, business equipment, stock, vehicles, real estate). Demonstrating any prior borrowing/banking history helps but is not mandatory.',
 'https://www.accessmfb.co.tz/sme-loans/', 'Medium,High', '2026-07-10'),

('Selcom Microfinance Bank — Micro Loans (Jisoti/Selcom Pesa)', 'digital_lender', 500000, 35000000,
 'Higher amounts available to repeat borrowers with strong repayment history.',
 'Applied for via Selcom Pesa mobile money account using 3 months of mobile-money statements (M-Pesa, Airtel Money, Mix by Yas, Halotel, AzamPesa). Any outstanding loan must be repaid before a new one is issued.',
 'https://www.smfb.co.tz/', 'Low,Medium', '2026-07-10'),

('SELF Microfinance Fund (government-owned)', 'microfinance', NULL, NULL,
 'Positioned as an affordable-financing option; specific rates vary by loan product.',
 'A Ministry of Finance-owned institution supporting MSMEs, agribusiness, and individual entrepreneurs, often through partner SACCOS, community banks, and microfinance institutions rather than direct lending alone. Offers sector-specific products (agriculture, clean energy, MSME working capital, youth enterprise).',
 'https://www.self.go.tz/', 'Low,Medium', '2026-07-10'),

('ASA Microfinance Tanzania', 'microfinance', NULL, NULL,
 'Group-lending model; rates vary by branch/product.',
 'Focused on low-income, primarily female business owners. Uses individual lending via client groups, without joint liability — good fit for very early-stage or informal traders needing small amounts to start or grow.',
 'https://tanzania.asa-international.com/', 'Low', '2026-07-10'),

('FINCA Tanzania', 'microfinance', NULL, NULL, NULL,
 'Long-established (since 1998) microfinance institution focused on financial inclusion; serves individual and group borrowers, including youth-focused programs run with development partners.',
 NULL, 'Low,Medium', '2026-07-10'),

('BRAC Tanzania Microfinance', 'microfinance', NULL, NULL, NULL,
 'International microfinance NGO/network with a Tanzania presence; typically serves group-based borrowers and very small enterprises.',
 NULL, 'Low', '2026-07-10'),

('PRIDE Tanzania', 'microfinance', NULL, NULL, NULL,
 'One of Tanzania''s longest-running domestic microfinance institutions, historically serving small and micro entrepreneurs through group-based lending.',
 NULL, 'Low,Medium', '2026-07-10'),

('Platinum Credit Limited', 'digital_lender', NULL, NULL, NULL,
 'Specializes in fast, accessible loans primarily for salaried/civil-service individuals rather than unregistered businesses — best fit for an applicant with formal employment income alongside a side business.',
 NULL, 'Low,Medium', '2026-07-10'),

('Watu Africa (asset financing)', 'digital_lender', NULL, NULL, NULL,
 'Asset-financing focus (e.g. motorcycles/vehicles) rather than general working capital — a strong fit specifically for boda-boda/transport business ideas.',
 NULL, 'Low,Medium', '2026-07-10'),

('AML Finance Limited', 'microfinance', NULL, NULL, NULL,
 'Non-deposit-taking lender focused on SME loans; a Tier 2 provider under BOT''s microfinance register.',
 NULL, 'Medium', '2026-07-10'),

('Hope Microcredit Ltd', 'microfinance', NULL, NULL, NULL,
 'Small-business-focused microcredit provider based in Tanzania.',
 NULL, 'Low,Medium', '2026-07-10'),

('Booster Microfinance Co. Limited', 'microfinance', NULL, NULL, NULL,
 'BOT-licensed Tier 2 microfinance provider with a branch presence in Dar es Salaam (Mikocheni ward, Kinondoni district).',
 NULL, 'Low,Medium', '2026-07-10'),

('Dream Big Microfinance (T) Limited', 'microfinance', NULL, NULL, NULL,
 'Provides loans aimed at small entrepreneurs to grow existing business capital (working-capital focus, not typically first-time startup capital).',
 NULL, 'Medium', '2026-07-10');

