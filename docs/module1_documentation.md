# LEADX Module 1 — Ingestion & Scoring Engine Educational Guide

Welcome, Intern / Junior Software Engineer! This guide is designed to help you understand, build, and troubleshoot the core lead ingestion and scoring engine of the LEADX Platform. You will learn both the business purpose behind these features and the low-level technical logic that makes them work.

---

## 1. The Business Purpose (Why we built this)

In the real world, companies spend thousands of dollars on marketing (Google Ads, Facebook campaigns, etc.) to capture "leads" (potential customers). 
However, **not all leads are created equal**:
*   Some leads enter fake phone numbers (e.g., `+910000000000` or invalid formats) to get free resources.
*   Some leads are "cold" (e.g., a student looking at home loan products with zero income).
*   Some leads are "hot" (e.g., a salaried employee looking for a mortgage loan with high credit scores).

If sales agents call every single lead in the order they arrive, they waste **70% of their time** calling cold or fake prospects. 
**LEADX solves this problem** by:
1.  Normalizing and validating contact numbers to guarantee that dialers can reach them.
2.  Dynamically scoring every lead based on custom rules (BFSI, Real Estate, etc.) so that the sales team only dials the most promising leads first.
3.  Preventing duplicate records to ensure multiple agents do not call the same customer.

---

## 2. Technical Design & Logic (How it works)

### 💡 Concept 1: E.164 Phone Normalization
When a user fills out a web form, they might write their phone number in various formats:
*   `09876543210`
*   `+91 98765-43210`
*   `9876543210`

If we pass these raw strings to telecommunication carriers or automated dialer APIs, they will fail to connect. We normalize every incoming number into the global standard **E.164 format** (`+` followed by country code and digits, with no spaces, hyphens, or symbols).
*   **Logic:** The helper function `cleanPhone()` in [validation.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/utils/validation.js) strips all non-numeric characters (except the leading `+`) and automatically appends `+91` (India's country code) if it detects a 10-digit number.

### 💡 Concept 2: Safe Floating-Point Calculations
Lead scores are computed by multiplying factor scores by specific weights (e.g., `Score = IncomeScore * 0.25 + AgeScore * 0.25 + ...`). The sum of all weights must equal exactly `1.0`.
However, computers calculate numbers using binary floating-points (IEEE-754 standard). In JavaScript:
```javascript
0.1 + 0.2 // Results in 0.30000000000000004, not 0.3!
```
If we do a strict check like `sum === 1.0`, valid configuration inputs might get rejected due to tiny rounding offsets.
*   **Logic:** We implement a **delta tolerance check** in our validation engine:
    ```javascript
    Math.abs(sum - 1.0) <= 0.001
    ```
    This ensures mathematical safety while keeping the config checks strict.

### 💡 Concept 3: Concurrency & Race Conditions (Defense-in-Depth)
What happens if a lead submits a contact form twice in the exact same millisecond?
1.  **Application level:** Request A checks the database: *"Does this phone number exist?"* Database says: *"No"*.
2.  Request B checks the database at the same instant: *"Does this phone number exist?"* Database says: *"No"*.
3.  Both Request A and Request B insert the lead, creating a duplicate record. This is a **race condition**.
*   **Logic:** We use a double-defense system. At the application layer, we check for existence. At the database layer, we enforce a unique index constraint `UNIQUE(tenant_id, phone)` inside [schema.sql](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/database/schema.sql). If both insert requests run concurrently, PostgreSQL rejects the second insertion, throwing error code `23505`. Our backend catches this and returns a `409 Conflict` status.

---

## 3. Step-by-Step Junior Developer Implementation Guide

To explore the code behind this module, check out these files:

1.  **Database Interface:** [db.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/config/db.js)
    *   Implements the dual-mode client. If live Supabase credentials are missing, it stores and queries records in a mock in-memory array (`mockDb.leads`).
2.  **Scoring Calculations:** [scoringEngine.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/services/scoringEngine.js)
    *   Implements the scoring math. Take a look at `computeLeadScore` and how it maps raw data (like income and credit scores) to a score between 0 and 100.
3.  **API Routes:** [leads.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/routes/leads.js)
    *   Defines the `POST /leads/ingest` and `POST /leads/batch` endpoints. Read how incoming requests are sanitized and validated.

---

## 4. Client & Business FAQ (Answer Client Questions)

### Q: "Why is the system rejecting my lead upload?"
*   **Answer:** The upload might contain invalid phone numbers (less than 10 digits) or missing required fields like `source`. We validate data strictly to prevent junk leads from filling up the database.

### Q: "Can we configure different weights for different campaigns?"
*   **Answer:** Yes! Weights are stored in `tenant_configs` table scoped by `tenant_id`. Each client or team can configure custom weights via the sliders in the dashboard.

### Q: "How does the rescoring button work?"
*   **Answer:** Clicking 'Rescore All Leads' tells the server to fetch all stored leads for your tenant, recalculate their score using the active saved weights, and write the new scores back to the database.

---

## 5. Manual Sandbox Verification Steps (How to use)

1.  Open the **Lead Intelligence** page in the dashboard.
2.  Fill in the **Single Lead Ingest** form. Put a formatted phone number like `+91 (9876) 543-210` and submit.
3.  Verify that the lead appears in the table with the phone number normalized to `+919876543210`.
4.  Try to submit the same phone number again. Verify that the system pops up a warning toast stating that a duplicate lead conflict occurred (HTTP 409).
5.  Move the weights sliders on the right. Notice how the configuration sum indicator updates. Try saving with a sum of `1.10` to see the validation error in action.

---

## 🔗 Related Documentation & Navigation
*   To learn how to onboard clients and map headers from custom CSV sheets, refer to the [Module 2 Onboarding & Column Mapper Guide (docs/module2_documentation.md)](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/module2_documentation.md).
*   To see the complete list of endpoint definitions and ingest payload schemas, refer to the [API Contracts Reference (docs/api-contracts.md)](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/api-contracts.md).
*   For a complete end-to-end platform usage walkthrough, refer to the [LEADX Platform User Guide (docs/platform-user-guide.md)](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/platform-user-guide.md).

