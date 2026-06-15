# LEADX Module 5 — Script Authoring & Escalation Detection Educational Guide

Welcome, Intern / Junior Software Engineer! This guide explains how to build, configure, and troubleshoot the Script Authoring and automated Escalation Detection engine of the LEADX Platform. You will learn the business values behind script-guided conversations and the technical details of the transcript parsing pipeline.

---

## 1. The Business Purpose (Why we built this)

When AI voice agents (VOIZ dialers) interact with customers, they must follow a structured, compliant, and natural conversation flow. 
However, **fully automated conversations can reach limits**:
*   A customer gets frustrated and says: *"Let me speak to a manager"* or *"Connect me to a real person"*.
*   A customer expresses strong anger, causing the call's sentiment score to drop.
*   A customer shows **extremely high purchase intent** (e.g., *"Where is the link to pay?"*), requiring immediate supervisor intervention to secure the conversion.
*   The call runs too long, wasting premium telephony channel minutes.

**Module 5 solves these challenges** by:
1.  Providing a structured conversational script manager where clients configure script nodes, intent branches, and escalation rules.
2.  Screening voice transcripts and metadata in real-time.
3.  Automatically flagging supervisor escalations when configured triggers (explicit requests, low sentiment, high intent, or max duration) are detected.

---

## 2. Technical Design & Logic (How it works)

### 💡 Concept 1: Config-Driven Script Graphs
A script is modeled as a directed graph where each node represents an AI prompt:
*   **Nodes:** Contain an `id`, a text `prompt` (with dynamic placeholders like `{lead_name}` or `{email}`), an array of `expected_intents`, and a `branches` object mapping intents to target node IDs.
*   **Terminal Nodes:** Leaf nodes with no branches where the call naturally concludes.
*   **Validation:** Before publishing, the schema is verified. Every branch target ID MUST correspond to an existing node ID in the script to prevent conversation dead-ends.

### 💡 Concept 2: Real-Time Transcript Screening
When the VOIZ dialer streams events (like `transcription_chunk` or `qualification_intent`) to our webhook `/leads/voiz-webhook`, the webhook parses the transcript against four trigger types:
1.  **explicit_request:** Uses case-insensitive word boundary regex matches to check if the caller explicitly requests a human transfer (e.g. `speak to advisor`, `talk to human`).
2.  **sentiment_low:** Inspects the dialer's computed sentiment score (from `1.0` positive to `-1.0` negative) and triggers escalation if it drops below a threshold (e.g. `0.3`).
3.  **high_intent:** Checks for key buying phrases (e.g. `how do I pay`, `enroll me now`) to immediately hand off the hot lead.
4.  **max_duration:** Tracks call duration and escalates if it exceeds the script's `max_duration_seconds`.

---

## 3. Step-by-Step Junior Developer Implementation Guide

To explore the code behind this module, check out these files:

1.  **Escalation Logic:** [escalationService.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/services/escalationService.js)
    *   Implements `checkEscalation()`. Read how phrases are screened and how trigger thresholds are evaluated.
2.  **Validation Engine:** [validation.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/utils/validation.js)
    *   Contains the `validateScript()` function which verifies JSON schema properties, validates trigger values, and ensures graph connectivity.
3.  **Webhook Handler:** [leads.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/routes/leads.js)
    *   Check out `/leads/voiz-webhook`. Notice how it intercepts incoming events, runs `checkEscalation()`, and raises internal `escalation_triggered` actions.

---

## 4. Client & Business FAQ

### Q: "Why didn't the system escalate when the customer said 'human'?"
*   **Answer:** Verify that "human" is defined in the script's `explicit_request` phrase configuration. Triggers are completely config-driven, meaning the AI only flags phrases explicitly listed in the active script version.

### Q: "What happens if a script contains a node that branches to a deleted node?"
*   **Answer:** The script validator will catch this error. The backend rejects publishing with a `400 Validation Error`, detailing exactly which node points to a non-existent target.

### Q: "How does the webhook callback handle multiple triggers in one call?"
*   **Answer:** The first trigger that matches is evaluated and escalates the session immediately. Once escalated, the lead's status transitions to `hot_escalated`, and subsequent webhook messages for that call are not re-evaluated.

---

## 5. Manual Sandbox Verification Steps (How to use)

1.  Navigate to the **Script Editor** page.
2.  Click **Load Ed-Tech Admissions** to populate the JSON template.
3.  Review the `escalation_triggers` array. Note the trigger words (e.g., "speak to advisor", "how do I pay").
4.  Click **Validate Schema** and then **Save & Publish**. Verify that the script appears in the version history table on the right.
5.  Go to the **Lead Intelligence** page and ingest a lead (make sure the phone number doesn't contain `0000` to avoid DNC blocks).
6.  Click the **Call** button for the ingested lead. This initiates a simulated call session.
7.  Go to the **Live Monitor** or event logs. Check how the webhook registers caller transcription events.
8.  Simulate a transcription event containing the phrase *"I want to speak to advisor"*. Verify that the warning banner *"ACTIVE ESCALATION DETECTED"* immediately flashes at the top of the dashboard page.
