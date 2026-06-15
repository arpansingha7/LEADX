# LEADX Module 6 — Operations Handoffs, Agent Briefs, & Instant Calls Educational Guide

Welcome, Intern / Junior Software Engineer! This guide explains the technical details and business value behind supervisor handoff flows, Slack notifications, automated agent context brief generation, and the high-priority instant call queue bypass mechanism.

---

## 1. The Business Purpose (Why we built this)

When an AI voice assistant identifies that a call session requires human intervention, the system must hand off the conversation seamlessly:
1.  **Immediate Operations Alerting:**
    *   *Problem:* If a customer asks to speak with a human or raises an urgent complaint, sales team managers cannot wait to read report logs at the end of the day.
    *   *Solution:* We trigger instant, rich notifications to the team's Slack operations channel the second a trigger is matched, prompting a quick response.
2.  **Contextual Handover (Agent Briefs):**
    *   *Problem:* When a human specialist takes over a lead, they usually have to ask: *"What were you speaking to the AI about?"* This frustrates the customer and ruins the sales flow.
    *   *Solution:* We compile a structured "Agent Brief" summarizing call history, sentiment, specific objections raised, and actionable recommended responses (e.g., offering discounts for price objections).
3.  **High-Priority Instant Dialing (Queue Bypass):**
    *   *Problem:* If a manager clicks "Call Now" for a hot prospect, they expect the system to dial immediately, not wait in a queue behind 1,000 low-scoring leads.
    *   *Solution:* We implement a bypass route that initiates the call instantly. If all concurrent lines are occupied, the system places the lead at the absolute top of the queue with a priority score of `999`.

---

## 2. Technical Design & Logic (How it works)

### 💡 Concept 1: Automatic Handoff Workflow & Slack Alerts
The webhook callback endpoint receives a trigger indicating an escalation condition (e.g., explicit human request or low sentiment).
1.  The handler invokes `handleEscalation()` inside [handoffService.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/services/handoffService.js).
2.  The lead status in the database is set to `hot_escalated`.
3.  A message containing key session metrics and recommendations is pushed immediately via an incoming webhook to the Slack notifications channel.

### 💡 Concept 2: Dynamic Brief Generation & Objections Logic
To help sales specialists overcome customer hesitation, the handoff service analyzes objections raised during the automated conversation:
*   **Objections Filtering:** We look for events with `event_type === 'objection_raised'` and extract the `objection_type`.
*   **Prescriptive Recommendations Engine:**
    *   *Price / Fee / Cost:* Recommends *"Offer the 15% early-bird discount/scholarship and review monthly EMI plans."*
    *   *Time / Schedule / Work:* Recommends *"Propose weekend-only or evening part-time batch options."*
    *   *Syllabus / Curriculum / Course:* Recommends *"Email program brochure and schedule a curriculum walkthrough."*
    *   *Human Negotiation Request:* Recommends *"Review current discount brackets and close registration manually."*
*   **Upsert Operations:** We write this payload to the `agent_briefs` table so it is instantly available in the frontend UI.

### 💡 Concept 3: High-Priority Instant Call Bypass
When an operator triggers a call manually:
1.  The route `/leads/calls/instant` first checks the active call counter.
2.  If the number of active calls is below the system limit (e.g., 5), it initiates the dial session asynchronously.
3.  If all lines are full, it schedules the call by updating the lead's status to `queued` and setting its score to `999`. The background queue worker picks up score `999` first, bypassing normal campaign lists.

---

## 3. Step-by-Step Junior Developer Implementation Guide

Check out these files to explore the code:

1.  **Handoff Logic:** [handoffService.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/services/handoffService.js)
    *   Read `handleEscalation()`. Note how call events are fetched, how objections are extracted, and how the recommended actions are determined.
2.  **API Routes:** [leads.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/routes/leads.js)
    *   Exposes `POST /leads/calls/instant` and `GET /leads/handoff/brief/:lead_id`. Verify how the bypass mechanism checks concurrency and overrides priority scoring.
3.  **Slack Adapter:** [slackService.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/services/slackService.js)
    *   Implements `sendSlackNotification()`, routing alerts to the configured webhook channel.

---

## 4. Client & Business FAQ

### Q: "How fast do our agents receive the escalation notification?"
*   **Answer:** Handoffs are processed in real time. Once the webhook registers the trigger, Slack alerts and database briefs are generated in less than 200 milliseconds.

### Q: "What happens if a lead has multiple objections?"
*   **Answer:** The recommendation engine reviews all objections. For example, if both "price" and "time" objections are raised, the engine defaults to the price resolution policy, suggesting early-bird discount brackets and EMI plans.

### Q: "Can we view the briefing cards outside of the active alert modal?"
*   **Answer:** Yes. The brief is permanently linked to the lead's profile. You can access it by clicking the lead record in the dashboard table or opening the historical briefs folder.

---

## 5. Manual Sandbox Verification Steps (How to use)

1.  Open the **Live Monitor** panel.
2.  Trigger a simulated call for a lead.
3.  In the Telephony Simulator console, choose the **Simulate Objection** action and select **Price**.
4.  Next, click **Simulate Escalation Request**.
5.  Verify that:
    *   An active escalation notification pops up at the top of the dashboard.
    *   The Slack notifications log at the bottom displays the generated alert.
6.  Click **View Brief** on the active escalation card.
7.  Check that the modal displays:
    *   Lead details and credit score.
    *   Objections list containing `Price`.
    *   Recommended Action: *"Offer the 15% early-bird discount/scholarship and review monthly EMI plans."*
8.  Close the modal and verify that clicking **Instant Call** on the lead card overrides any normal queue scheduling and begins dialing immediately.

---

## 🔗 Related Documentation & Navigation
*   To learn how escalation criteria (explicit words, low sentiment, duration bounds) are configured and validated, refer to the [Module 5 Script Authoring & Escalation Detection Guide (docs/module5_documentation.md)](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/module5_documentation.md).
*   To see how the active handoff banners, print-cards templates, and brief modals are configured in the frontend dashboard view, check the [Module 7 Config UI & Analytics Dashboard Guide (docs/module7_documentation.md)](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/module7_documentation.md).
*   For a complete end-to-end platform usage walkthrough, refer to the [LEADX Platform User Guide (docs/platform-user-guide.md)](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/platform-user-guide.md).

