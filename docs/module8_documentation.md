# LEADX Module 8 — Ed-Tech Admissions Bundle & Documentation Educational Guide

Welcome, Intern / Junior Software Engineer! This guide explains the structure, purpose, and implementation details of the pre-packaged Ed-Tech Admissions configuration bundle, including how script routing nodes, CRM mappings, and dialing rules are packaged.

---

## 1. The Business Purpose (Why we built this)

Setting up a new client on the LEADX platform from scratch can take hours. To scale quickly, we package industry-specific configurations as pre-configured "bundles":
1.  **Ed-Tech Industry Pre-sets:**
    *   *Problem:* Ed-Tech programs (like the *Full-Stack AI Engineering Program*) have specific lead qualifications: coding background, career shift timeline, and tuition budget.
    *   *Solution:* We package default demographic weights (e.g., scoring profile based on income, education, and source quality) that are optimized for course sales.
2.  **Turnkey Conversational Scripting:**
    *   *Problem:* Writing conversational logic for AI voice agents is complex. If they start asking random questions, leads hang up.
    *   *Solution:* The bundle provides a structured, multi-step conversation path (Greeting $\rightarrow$ Interest Check $\rightarrow$ Tech Background Check $\rightarrow$ Cohort Timeline $\rightarrow$ Budget & Scholarship $\rightarrow$ Handoff or Close).
3.  **CRM Field Alignment:**
    *   *Problem:* Ingested leads must sync with specific LeadSquared or HubSpot properties. Mapping database names manually for every tenant leads to schema mismatches.
    *   *Solution:* The bundle pre-defines mappings like `mx_LeadX_Score`, `mx_Call_Disposition`, and `mx_Call_Summary` for immediate out-of-the-box integration.

---

## 2. Technical Design & Logic (How it works)

### 💡 Concept 1: Pre-packaged Tenant Configuration
The bundle is defined in [edtech_bundle.json](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/config/edtech_bundle.json). It contains:
*   `scoring_weights`: Assigns weight percentages (Demographic Fit: 30%, Source Quality: 30%, Recency: 20%, Behavioral Signals: 10%, Prior Interaction: 10%).
*   `calling_schedule`: Restricts dialing times to **10:00 AM – 7:00 PM IST** (excluding Sundays) and schedules retries at gaps of `[30 min, 4 hr, 24 hr]`.

### 💡 Concept 2: Conversational Script Nodes Graph
The conversational script is modeled as a state machine where:
*   The call starts at the `greeting` node.
*   The caller's response is mapped to expected intents (e.g. `yes` or `no`).
*   The `branches` object redirects the flow to subsequent nodes like `course_interest`, `wrong_number`, or `budget_check`.
*   Terminal nodes like `wrong_number` and `terminal_success` conclude the session by ending the call cleanly.

### 💡 Concept 3: Objections & Call Retry Calendars
The script defines custom triggers to flag immediate supervisor handoffs:
*   **Explicit request:** Triggers escalation when matching words like `speak to advisor` or `representative`.
*   **High intent:** Triggers handoff when phrases like `how do I pay` or `where is the link to pay` are spoken.
*   **Backoff Calendar:** Specifying retry gaps in milliseconds ensures that if a call fails, the database scheduler updates the `next_call_at` timestamp with mathematical precision.

---

## 3. Step-by-Step Junior Developer Implementation Guide

Explore these core resources in the repository:

1.  **Ed-Tech Bundle Reference File:** [edtech_bundle.json](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/config/edtech_bundle.json)
    *   Review the structured config package schema. Note how node branches link from node-to-node.
2.  **API Contracts Guide:** [api-contracts.md](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/api-contracts.md)
    *   Lists the exact requests, query schemas, and response JSON formats for all endpoints.
3.  **CRM Setup Guide:** [crm-connector-setup.md](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/crm-connector-setup.md)
    *   Provides step-by-step instructions for OAuth connections, LeadSquared HMAC verification, and field syncing.
4.  **Deployment Guide:** [deployment-guide.md](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/deployment-guide.md)
    *   Outlines database migration instructions, environment variables setup, and telemetry verification commands.

---

## 4. Client & Business FAQ

### Q: "Can we translate the Ed-Tech script into Hindi or Spanish?"
*   **Answer:** Yes. The configuration accepts a `language` property (e.g. `language: "hi"` or `language: "es"`). You can publish regional variations by adjusting prompt values in the JSON script editor.

### Q: "What happens if our LeadSquared account does not have custom 'mx_' fields?"
*   **Answer:** The sync will return a schema error. Before deploying the bundle, make sure custom fields (`mx_LeadX_Score`, etc.) are created in the CRM Settings panel.

### Q: "Can we change the default retry intervals for unanswered calls?"
*   **Answer:** Yes. You can customize the `retry_gaps_ms` array in the dashboard configuration drawer to adjust backoff intervals.

---

## 5. Manual Sandbox Verification Steps (How to use)

1.  Go to the **Script Editor & Graph Manager** page.
2.  Click the **Load Ed-Tech Admissions** template button.
3.  The text editor automatically populates with the JSON payload from the reference bundle.
4.  Click **Validate Schema**. Confirm that the banner reports *"Script Schema Valid!"*
5.  Click **Save & Publish**.
6.  Navigate to **Lead Intelligence** and submit a lead:
    *   Name: `Arpan Admissions Test`
    *   Income: `800000` (8 Lacs)
    *   Credit Score: `750`
7.  Verify the computed lead score is high (Hot prospect status).
8.  Trigger a manual call.
9.  Trace the call conversation steps in the Telephony Simulator logs. Step through: Greeting $\rightarrow$ Yes $\rightarrow$ Upgraders $\rightarrow$ Coding experience $\rightarrow$ Enrollment budget.
10. Click **Mark Converted** at the final step, and verify the lead status updates to `converted` in the dashboard list.
