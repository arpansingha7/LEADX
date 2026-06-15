# LEADX Module 3 — Call Orchestrator & Priority Queue Educational Guide

Welcome, Intern / Junior Software Engineer! This guide explains the technical logic and business value behind outbound dialing automation, priority queueing, calling hours regulations, DNC screening, and dialing retry logic on the LEADX Platform.

---

## 1. The Business Purpose (Why we built this)

Once leads are ingested and scored, we need to call them to qualify them. But we cannot just call them randomly:
1.  **Limited Calling Lines:** If we have 10,000 leads but our telephony provider only allows **5 concurrent calls**, we must prioritize. We want to call our hot leads (score $\ge 80$) first to lock in interest.
2.  **Regulatory & Brand Safety (Calling Hours):** Calling a customer at 10 PM or on a Sunday is illegal in many jurisdictions, ruins the brand reputation, and results in customer complaints. We must strictly block dialing outside **9:00 AM – 8:00 PM IST** and on **Sundays**.
3.  **DNC Compliance (Do Not Call):** If a customer registers their number on a Do Not Call registry, calling them can result in heavy financial penalties.
4.  **No-Answer Engagement (Retry Logic):** More than **60% of cold calls** go unanswered because the prospect is busy, driving, or doesn't recognize the number. If we give up after one call, we lose potential business. We need an automated retry engine to schedule follow-up calls at smart intervals.

---

## 2. Technical Design & Logic (How it works)

### 💡 Concept 1: The Asynchronous Priority Worker
To manage dialing without slowing down the web server, we run a background loop (a "worker"):
1.  **Ingestion:** The route `/ingest` saves the lead and enqueues it.
2.  **Worker Loop:** A background process polls the database every 5 seconds for leads with a `'queued'` or `'re-queued'` status.
3.  **Priority Sorting:** The worker sorts leads by `score` descending, ensuring high-value prospects are called first.
4.  **Capacity Check:** The worker counts active calls. If the active call count reaches the limit (e.g. 5), it halts further dialing until an active call ends.

### 💡 Concept 2: Global Time Zone Calculations (IST Enforcer)
Our application servers might be hosted in Ireland, Oregon, or Singapore. If the server checks the local clock, it will dial customers at the wrong local time.
*   **Logic:** We enforce **Indian Standard Time (IST)** (UTC+5:30) programmatically using JavaScript's native internationalization formatter `Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata' })`. This guarantees that calling hours are calculated correctly regardless of where the server is located.

### 💡 Concept 3: Exponential Backoff & Retry Gaps
If a call outcome ends in a failure (busy, no answer), we calculate the next call window:
*   **Logic:** The system schedules retries at expanding intervals (e.g., attempt 1: 15 minutes; attempt 2: 2 hours; attempt 3: 24 hours). This prevents spamming the customer while giving them time to become available.
*   *Testing Short-Circuit:* Waiting 2 hours in a unit test environment is impossible. During automated test runs or in mock modes, we automatically short-circuit these gaps to seconds (`[1s, 2s, 3s]`) so tests finish instantly.

---

## 3. Step-by-Step Junior Developer Implementation Guide

Check out these files to see the implementation:

1.  **Background Queue Worker:** [queueService.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/services/queueService.js)
    *   Implements the polling worker, calling hours verification (`isCallable`), and retry logic (`handleCallOutcome`).
2.  **Telephony Integration Route:** [leads.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/routes/leads.js)
    *   Exposes endpoints to retrieve queue statistics (`GET /leads/queue-status`) and register blocks (`POST /leads/dnc`).
3.  **Active Queue Table Renderer:** [app.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/frontend/app.js)
    *   Find `fetchQueueStatus` and `renderActiveQueueTable` which poll backend stats and update the Live Monitor table.

---

## 4. Client & Business FAQ (Answer Client Questions)

### Q: "Why is a lead with score 95 sitting in the queue and not being called?"
*   **Answer:** There are three potential reasons:
    1.  The local time is outside calling hours (before 9 AM or after 8 PM IST) or it is Sunday.
    2.  We have reached our concurrent call limit of 5 lines, and the worker is waiting for a line to open.
    3.  The lead is in a retry-backoff cooling period after a failed dial.

### Q: "How does the 'Force Retry' button work?"
*   **Answer:** If campaigns end and you have leads that were marked as closed or called, clicking "Force Retry" resets their retry counters and enqueues them back into the active dialer queue.

### Q: "Can we configure different calling hours for different regions?"
*   **Answer:** Yes! The timezone and hours boundaries are stored in the client onboarding configurations. The enforcer dynamically matches these rules for each individual tenant.

---

## 5. Manual Sandbox Verification Steps (How to use)

1.  Go to the **Live Monitor** page on the dashboard.
2.  Locate the **Queue Status Widget**. Notice the metrics counts: `QUEUED`, `DIALING`, `RETRIES`, and `DNC BLOCKED`.
3.  Ingest a lead with a phone number containing `403` or `0000`. Verify that the worker blocks it immediately and increments the **DNC BLOCKED** count.
4.  Trigger a call manually. Notice the lead moves to the active table and is marked as `calling`.
5.  Simulate a failed call outcome from the telephony simulator (busy or no answer). Notice the lead moves to `re-queued` status and increments the **RETRIES** count.
6.  Click **Force Retry** and verify that the metrics reset and enqueued leads return to the active pool.

---

## 🔗 Related Documentation & Navigation
*   To learn how to configure dialer script versions and validation rules, refer to the [Module 5 Script Authoring & Escalation Detection Guide (docs/module5_documentation.md)](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/module5_documentation.md).
*   To understand how call outcomes can trigger instant operations notifications and agent context cards, refer to the [Module 6 Handoffs, Briefs, & Instant Calls Guide (docs/module6_documentation.md)](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/module6_documentation.md).
*   For a complete end-to-end platform usage walkthrough, refer to the [LEADX Platform User Guide (docs/platform-user-guide.md)](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/platform-user-guide.md).

