# LEADX Module 7 — Config UI & Analytics Dashboard Educational Guide

Welcome, Intern / Junior Software Engineer! This guide explains the technical architecture and business purpose behind the glassmorphic analytics dashboard, dynamic Chart.js visualizations, funnel status tracking, and the active escalation warning system.

---

## 1. The Business Purpose (Why we built this)

Sales managers and company executives need clear, real-time visibility into the performance of their automated lead generation funnel:
1.  **Funnel Visibility:**
    *   *Problem:* Managers do not know where leads are dropping off. Are they blocked by DNC? Are they not answering? Or are they failing qualification during the call?
    *   *Solution:* We track and display the lead's progression through 7 distinct funnel stages: Ingested $\rightarrow$ Scrubbed $\rightarrow$ Scored $\rightarrow$ Queued $\rightarrow$ Attempted $\rightarrow$ Connected $\rightarrow$ Qualified.
2.  **Scoring Effectiveness Validation:**
    *   *Problem:* How do we prove that prioritizing hot leads (score $\ge 80$) actually yields more conversions than dialing cold ones?
    *   *Solution:* The dashboard compares conversions across Hot ($\ge 80$), Warm (50-79), and Cold ($< 50$) groups, validating the scoring model with historical proof.
3.  **Real-Time Supervisor Escalations:**
    *   *Problem:* When a lead triggers an escalation during a live call, the operator must know immediately to intercede.
    *   *Solution:* We display a sticky, glowing red notification banner across the top of the interface, displaying active escalation details.

---

## 2. Technical Design & Logic (How it works)

### 💡 Concept 1: API Aggregation & Metric Summaries
The backend endpoint `GET /leads/analytics/summary` aggregates telemetry:
*   **Connect Rate:** Calculated as the percentage of calls with dispositions matching active statuses: `['called', 'qualified', 'interested', 'callback', 'qualified_escalated', 'converted', 'hot_escalated']`.
*   **Trend Tracking:** Groups sessions by call date for the last 7 days to calculate day-over-day connect rate changes.
*   **Scoring Effectiveness:** Segments leads by score range and tracks how many have successfully reached `called`, `hot_escalated`, or `converted` status.

### 💡 Concept 2: Chart.js Integration & Canvas Lifecycle
To draw smooth, responsive graphics on the dashboard, we integrate Chart.js via CDN. 
*   **The Overlap Glitch:** If you try to render a new Chart.js instance on an HTML canvas element where an instance already exists, hover animations will glitch and flip between old and new graphs.
*   **The Solution:** We maintain global references to the charts (`connectRateChartInstance`, `dispositionsChartInstance`, `effectivenessChartInstance`). Before building a new chart, we call `.destroy()` on the active instance:
    ```javascript
    if (connectRateChartInstance) {
      connectRateChartInstance.destroy();
    }
    connectRateChartInstance = new Chart(ctx, { ... });
    ```

### 💡 Concept 3: Glassmorphic UI Theme & Polling
The interface features a co-branded dark glassmorphic design:
*   **CSS Styles:** Uses a mix of `backdrop-filter: blur(12px)`, translucent borders (`rgba(255,255,255,0.08)`), and soft radial gradients.
*   **Live Polling:** The frontend runs a polling cycle every 5 seconds, querying `/leads/analytics/summary` and `/leads/queue-status` to update charts and tables dynamically without page reloads.

---

## 3. Step-by-Step Junior Developer Implementation Guide

Check out these files to see the implementation details:

1.  **Analytics Routes:** [leads.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/routes/leads.js)
    *   Inspect `GET /leads/analytics/summary`. Note how the funnel phases and scoring categories are compiled.
2.  **Dashboard Layout:** [index.html](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/frontend/index.html)
    *   Look at the layout structural elements: the KPI cards, the canvas elements (`connectRateChart`, `dispositionsChart`, `effectivenessChart`), and the floating escalation banner (`#escalation-banner`).
3.  **Visualization Logic:** [app.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/frontend/app.js)
    *   Find the `drawAnalyticsCharts()` function. Note the destroy lifecycle hooks and custom option configs.

---

## 4. Client & Business FAQ

### Q: "Why is the Connect Rate calculated as 0% when we have calls in the database?"
*   **Answer:** Verify the outcomes of the calls. If all call sessions are marked as `busy` or `no_answer`, these do not count as "connected". The system requires at least one answered call disposition (such as `called`, `interested`, or `converted`) to compute a positive connect rate.

### Q: "How does the active escalation banner update?"
*   **Answer:** The dashboard polls the active call sessions in the background. If a session switches to `hot_escalated` status, the frontend interceptor renders the red escalation banner at the top of the viewport.

### Q: "Can we export the chart figures as a spreadsheet?"
*   **Answer:** The charts represent visual renderings of the `/leads/analytics/summary` JSON API. You can download the raw data in Excel or JSON format by using the "Export Data" link in the dashboard settings drawer.

---

## 5. Manual Sandbox Verification Steps (How to use)

1.  Open the **Analytics & Performance** tab on the dashboard.
2.  Observe the 4 KPI cards: **Calls Dialed Today**, **Connect Rate (%)**, **Qualified Leads**, and **Hot Prospects**.
3.  Review the three chart panels:
    *   **Connect Rate Trend (7 Days)** (Line chart)
    *   **Call Dispositions Share** (Doughnut chart)
    *   **Scoring Effectiveness** (Bar chart)
4.  Navigate to the Lead Ingest form and add a new lead with a score of `95`.
5.  Launch a call, and click **Simulate Escalation Request** inside the Telephony Simulator.
6.  Look at the top of the page: verify the red **ACTIVE ESCALATION DETECTED** banner flashes.
7.  Check the Analytics page: notice the **Hot Prospects** KPI increments and the **Scoring Effectiveness** chart reflects the updated count for the Hot ($\ge 80$) tier.

---

## 🔗 Related Documentation & Navigation
*   To learn how active call session escalations generate context briefings and briefs modals, refer to the [Module 6 Handoffs, Briefs, & Instant Calls Guide (docs/module6_documentation.md)](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/module6_documentation.md).
*   To check out all backend API response contracts feeding these Chart.js data models, check the [API Contracts Reference Guide (docs/api-contracts.md)](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/api-contracts.md).
*   For a complete end-to-end platform usage walkthrough, refer to the [LEADX Platform User Guide (docs/platform-user-guide.md)](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/platform-user-guide.md).

