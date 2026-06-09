# LEADX Module 2 — Onboarding, Mapping, & Integration Engine Technical Reference Guide

This document serves as the authoritative reference guide for **Module 2 (Week 2)** of the LEADX Platform. It outlines the platform's features, client onboarding setup, CRM connectors, hybrid token-saving AI architecture, and notification alert systems.

---

## 1. Executive Summary & Core Platform Capabilities

LEADX is a next-generation AI-powered lead qualification and conversion orchestration system. It bridges the gap between external lead sources (like marketing sheets or web forms), voice dialing agents, and client CRM records.

### 1.1 Complete Feature Rollout (Modules 1 & 2)
Here is a high-level summary of the functionalities implemented across both modules:
*   **Performance Dashboard (Module 1):** Features key metrics (Total Calls, Connect Rate, SLA status), a 7-stage conversion funnel tracker, active activity timelines, and real-time hot lead indicators.
*   **Lead Intelligence Feed (Module 1):** Provides dynamic lead list displays with animated SVG progress rings matching their qualification score. It lets you trigger single mock dials, handoffs, or rescores.
*   **Onboarding Questionnaire Wizard (Module 2):** A step-by-step onboarding pipeline that allows new clients to configure campaign objectives, select industry templates, parse headers of uploaded spreadsheets, map custom columns, set DNC rules, and assign CRM sync destinations.
*   **Self-Serve Spreadsheet Parser (Module 2):** Parses CSV spreadsheets directly in the browser using line-splitting buffer arrays. This decouples our database structure from client custom headers.
*   **DNC Registry Shield (Module 2):** Automatically filters incoming phone numbers against national Do Not Call (DNC) lists to protect client compliance and minimize dial minutes cost.
*   **Central Security Logbook (Module 2):** A Postgres audit trail table tracking administrative configuration edits, bulk uploads, dialing outcomes, and CRM synchronization runs.
*   **Outbound VOIZ Dialer & Webhook loops (Module 2):** Initiates voice calls and processes incoming webhook event streams (such as transcripts, intents, objections, and call ends) in real time.

---

## 2. Platform User & Functionality Guide

This guide details how to navigate the LEADX dashboard panels to orchestrate client campaigns:

### 2.1 Workspace Header Context
*   **Tenant ID Input:** Toggle between client workspace contexts (e.g., `default-tenant`, `test-tenant`). Press **Switch** to fetch the corresponding tenant configurations, scoring weights, and lead intelligence lists.
*   **Co-Branded Client Badge:** Displays the active client name (e.g., *Muthoot Finance*). Clicking it directs you immediately to the **Client Portal** view.

### 2.2 Onboarding Wizard Tab
1.  **Questionnaire (Step 1):** Select the industry template (**BFSI**, **Real Estate**, or **Education**). Enter the campaign objective and instructions for the AI bot.
2.  **Upload (Step 2):** Paste your raw CSV data. Use the quick buttons to load pre-formatted BFSI or Real Estate templates to test the mappings.
3.  **Dynamic Column Mapping (Step 3):** The system reads your CSV headers and matches them to internal fields (`phone`, `name`, `email`, `age`, `income`, `city`). Adjust mapping dropdowns as needed. A live preview grid updates automatically as you change mappings.
4.  **Integration Setup (Step 4):** Toggle the platform-maintained DNC check, choose the destination CRM (**HubSpot** or **LeadSquared**), assign a campaign name, and click **Finalize** to ingest the leads.

### 2.3 Lead Intelligence Tab
*   **Weights Sliders:** Adjust the sliders for the 5-factor scoring engine (Demographic Fit, Source Quality, Interaction Recency, Behavioral Signals, Prior Interactions). The weights sum must equal exactly `1.000` to save.
*   **Ingestion Forms:**
    *   **Single Lead Ingest:** Manually add a lead by inputting contact details, demographics, and page interaction triggers.
    *   **Batch JSON Ingest:** Paste a raw JSON list arrays of leads for fast, high-volume testing.
*   **Intelligence Feed Table:** View the scored leads list. Click **Call** to trigger a voice dialer call stream, click **Block** to add the lead to the DNC registry, or click **Rescore** to re-calculate a lead's score if weights are updated.

### 2.4 Campaigns Manager Tab
*   **Pill Tabs:** Toggle between **Real-Time** campaigns (instant dialers triggering within 60s of lead ingestion), **Non-RT Batch** campaigns (high-concurrency batch calling queues), and **Scheduled** campaigns.
*   **Configuration Side-Panel:** Adjust concurrency slider limits, retry delays, and CRM write-back options based on the active campaign.

### 2.5 Live Call Monitor Tab
*   **Active Call Cards:** Watch ongoing voice dials. You can view connected status, live stream call timers, and active SVG speech waveforms.
*   **Prioritization Queue:** Shows wait-times and priority ranking (P0 - Immediate to P2 - Normal) of incoming calls.
*   **VOIZ Call Event Stream Logs:** Displays live event webhooks dispatched by the dialer (e.g., `call_started`, `objection_raised`, `qualification_intent`, `escalation_triggered`, `call_ended`) with real-time transcript clips.

### 2.6 Client Portal Tab
*   A clean co-branded interface designed for client executives. It displays rollup metrics (Total leads, SLA response times, Connect rates), WoW (Week-over-Week) charts, and platform API health check badges. Click **Export PDF Report** to download a mockup summary.

---

## 3. CRM Integration Guide for Clients

LEADX uses the **Adapter Pattern** to standardize data syncs to external CRM platforms. The core server calls a single interface, while custom adapters translate payload shapes to target CRM API structures.

### 3.1 Supported CRMs & Connection Payload Shapes

#### HubSpot CRM Setup
*   **Endpoint:** `POST https://api.hubapi.com/crm/v3/objects/contacts`
*   **Connection Protocol:** Bearer Token authentication via the `HUBSPOT_API_KEY` header.
*   **Payload Format:**
    ```json
    {
      "properties": {
        "firstname": "Jane Doe",
        "phone": "+919999988888",
        "email": "jane.doe@gmail.com",
        "leadx_score": "85",
        "leadx_status": "hot_escalated"
      }
    }
    ```

#### LeadSquared Setup
*   **Endpoint:** `POST https://api.leadsquared.com/v1/LeadManagement.svc/Lead.Create`
*   **Connection Protocol:** API Key authentication via the `LEADSQUARED_API_KEY` header.
*   **Payload Format:**
    ```json
    [
      { "Attribute": "FirstName", "Value": "Jane Doe" },
      { "Attribute": "Phone", "Value": "+919999988888" },
      { "Attribute": "EmailAddress", "Value": "jane.doe@gmail.com" },
      { "Attribute": "mx_LeadX_Score", "Value": "85" },
      { "Attribute": "mx_LeadX_Status", "Value": "hot_escalated" }
    ]
    ```

### 3.2 Sync Failure Strategy
If a CRM connection is offline during a synchronization run:
1.  The sync attempt fails safely without blocking the dialing transaction thread.
2.  The incident is logged in the `audit_trail` table as a `crm_sync_failure` event.
3.  An instant notification is sent to the client's operations channel on Slack detailing the failure reason.
4.  In production, a background queue worker intercepts failed records for exponential backoff retries.

---

## 4. Hybrid AI Engine Architecture: Heuristics vs. LLMs

To keep API response times low and minimize LLM token costs, LEADX separates task execution between rule-based agentic code blocks and Large Language Model (LLM) calls.

```
Incoming Lead Data / Voice Stream
  │
  ├──► Simple / Heuristic Tasks (Engine Level - 0 Token Usage)
  │     ├── Phone E.164 Parsing & Cleaning
  │     ├── Unique Index Deduplication
  │     ├── DNC Screening Lookup
  │     └── Multi-factor Weighted Lead Scoring
  │
  └──► Complex / Critical Tasks (LLM Level - Targeted Token Usage)
        ├── Outbound Conversational Voice Runtimes
        ├── Intent Objections Classification
        ├── Sentiment Analysis of Responses
        └── Call Transcript Summarization
```

### 4.1 Simple Tasks (Handled by Heuristic Heuristics - 0 Token Usage)
*   **Lead Scoring Computations:** Lead scoring is mathematically intensive. Instead of passing sheets to an LLM, the scoring engine uses simple formula-driven multipliers (e.g., `Score = Fit * W1 + Source * W2...`). Float weight configurations are checked against IEEE-754 decimal rounding errors using delta tolerances.
*   **Phone Normalization:** Trims letters, brackets, and spaces using JavaScript regular expressions to output a clean E.164 string (`+919876543210`).
*   **Deduplication & DNC Checking:** Database lookups check against existing lists before committing rows, avoiding duplicate LLM processing calls.

### 4.2 Critical Tasks (Handled by LLMs)
*   **Active Conversational Voice Runtimes:** The outbound voice agent (VOIZ) uses LLMs to synthesize real-time voice responses based on client focus directives.
*   **Sentiment & Objection Classification:** Classifies objections (e.g., *"Price is too high"*, *"Call me next week"*) to adjust dialogue branches.
*   **Call Transcript Summarization:** Summarizes a 15-minute call history into a short paragraph (e.g., *"Confirming interest in Home Loans. KYC scheduled"*), which is then synced back to the CRM.

---

## 5. Slack Webhook Alerts Integration

LEADX notifies operations teams about key workspace events via Slack notifications.

### 5.1 Slack Webhook Setup
To enable Slack alerts:
1.  Go to the **[Slack API Console](https://api.slack.com/apps)** and click **Create New App**.
2.  Select **From scratch**, name the app, and link it to your workspace.
3.  Navigate to **Incoming Webhooks** and click **Activate Incoming Webhooks**.
4.  Click **Add New Webhook to Workspace**, select the target channel (e.g. `#notifications`), and copy the generated Webhook URL.
5.  Add the URL to your project's `.env` configuration file:
    ```env
    SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00/B00/XXXXXX
    ```

### 5.2 Trigger Conditions
Slack notifications are dispatched asynchronously in the background when:
*   **Scoring Configuration Updates:** Weight modifications are logged with the author's username.
*   **Hot Lead Ingestions:** Dispatches alert details when a new lead scores $\ge 80$.
*   **Telephony DNC Block:** Triggers if an outbound call is blocked due to DNC screening.
*   **Voice Agent Escalations:** Sends alerts when a client requests a supervisor transfer (`escalation_triggered`).
*   **Call Completions:** Logs caller status outcomes (`called`, `dnc`, or `no_answer`).

---

## 6. Saturday Mentor Demo - Shared Presentation Script

Below is the step-by-step presentation script for Arpan and Vedika. All frontend UI elements are designed to be **emoji-free**.

### 🎙️ Part 1: Vedika (Frontend Flow & Client Journey) — 6 Minutes

#### Step 6.1: Introduction & Wizard Navigation (1.5 mins)
*   **What to do:** Open the browser to `http://localhost:3000`. Click on the **Onboarding** tab in the sidebar. Show the wizard interface.
*   **What to say:**
    > *"Good morning. For Module 2, we focused on the client onboarding journey and enterprise integration layer. We designed a cohesive 4-step Onboarding Wizard adhering to clean design principles with zero emojis. This wizard guides business tenants from raw lead data upload to automated voice agent routing and CRM sync setup. We support multiple industries, starting with Real Estate, Education, and BFSI."*

#### Step 6.2: Discovery Questionnaire & Industry Selection (1.5 mins)
*   **What to do:** In Step 1, select **BFSI** from the industry dropdown. Type "Credit Card Qualification" as the campaign objective, "Voice Agent will pitch Premium Cards" as the focus, and choose English and Hindi. Click **Proceed to Data Upload**.
*   **What to say:**
    > *"In Step 1, the client completes our Discovery Questionnaire. Selecting an industry template like BFSI alters the backend routing rules and loading presets. The data is packaged and sent to our config layer, defining our voice agent's conversational objectives and constraints dynamically without code changes."*

#### Step 6.3: Data Upload & Dynamic Header Mapping (1.5 mins)
*   **What to do:** In Step 2, click **Load BFSI CSV Sample** to populate the textarea. Click **Parse & Configure Mappings**. In Step 3, show the mapped columns list. Select the appropriate mapping targets from the dropdowns (map `Customer Name` to `name`, `Contact Phone` to `phone`, etc.). Show the mapping preview table updating.
*   **What to say:**
    > *"In Step 2, clients upload data in multiple formats: CSV, JSON, or direct CRM feeds. In Step 3, our Data Mapping Engine parses the column headers. It generates dropdown selectors allowing clients to map their proprietary headers to our database schema. This decouples client data structures from our engine."*

#### Step 6.4: User Review screen Validation (1.5 mins)
*   **What to do:** Show the preview table generated at the bottom of Step 3. Highlight that the phone numbers are formatted and mock records are displayed. Click **Verify & Set Handoff**.
*   **What to say:**
    > *"Before final processing, the User Mapping Review screen presents a tabular validation preview. Users confirm the mapped columns line up correctly, verifying that phone formats are cleaned and readable, eliminating ingestion formatting errors before they are committed."*

---

### 🎙️ Part 2: Arpan (Backend Infrastructure & Integration) — 6 Minutes

#### Step 6.5: Normalization, DNC Scrubbing, & Data Labeling (1.5 mins)
*   **What to do:** Open the code editor. Point to the data mapping route in [leads.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/routes/leads.js) and the DNC checking helper.
*   **What to say:**
    > *"On the backend, incoming columns are normalized. The phone values go through our `cleanPhone` sanitation. We also run a DNC Validation check. Clients can opt to use their own client-side logic or rely on our platform-maintained database validation. Additionally, every record is labeled with a `dataset_id` and `campaign_name` to ensure complete traceability of leads back to their source files."*

#### Step 6.6: Automated Agent Assignment & Audit Logging (1.5 mins)
*   **What to do:** Show the database insertion logic in [db.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/config/db.js). Point to the `insertAuditLog` command being called for onboarding and ingestion events.
*   **What to say:**
    > *"Once the leads are validated, we automate Agent Assignment. The ingestion router maps leads to active agents on our VOIZ roster according to language and industry criteria. Simultaneously, we write records to our centralized `audit_trail` table. This provides a detailed ledger of lead imports and configuration actions for system diagnostics."*

#### Step 6.7: CRM Synchronization & Slack webhook Alerts (2 mins)
*   **What to do:** Show [crmService.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/services/crmService.js) and [slackService.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/services/slackService.js). Point to the HubSpot API call structure and the Slack fetch request.
*   **What to say:**
    > *"We support native CRM Integrations for HubSpot and LeadSquared. Leads and calling outcomes are synced bidirectionally. Whenever a sync completes or an error is encountered, our Slack service sends immediate webhook notifications to the operations channel. If webhook URLs are absent, it falls back to secure logging, keeping the engine running smoothly."*

#### Step 6.8: Automated Test Execution (1 min)
*   **What to do:** Run `npm test` in the terminal to execute the testing suite. Highlight the green passing assertions for Module 2 endpoints.
*   **What to say:**
    > *"We have added comprehensive integration tests validating our questionnaire endpoints, column mapping engine, CRM sync status, and audit trail insertions. All tests run locally using Node's native test runner in under 1.5 seconds, proving our system's reliability. Vedika and I will now take questions."*

---

## 7. Saturday Technical & Business Q&A Prep Sheet

### 7.1 Technical Prep
> [!TIP]
> **Q: How does the Data Mapping Engine normalize unstructured headers without failing database constraints?**
> *   **Answer:** *"The mapping engine uses a lookup dictionary. When a file is processed, we map the user's columns (e.g. `MobNo`) to internal schema properties (e.g. `phone`). We only extract the mapped keys to build the lead object, validating and cleaning variables like phone formats. Unmapped columns are safely moved to the `raw_data` JSONB object, preserving customer details without cluttering core columns."*

> [!TIP]
> **Q: How does the system ensure audit trails are tamper-evident and decoupled from primary lead tables?**
> *   **Answer:** *"Audit trails are written to a dedicated `audit_trail` table. The table acts as an append-only log with no update or delete APIs exposed. Additionally, database transactions are structured such that if a lead ingestion fails, the audit log transaction still records the event status, ensuring all system anomalies are documented."*

> [!TIP]
> **Q: What is the failure mode if the HubSpot or LeadSquared API goes offline during lead sync?**
> *   **Answer:** *"We use an asynchronous retry design. If the CRM API returns a 5xx error or rate limit response, the lead status is updated to `sync_failed` in our database. The failure triggers a Slack webhook alert. In a production setup, a background worker (like BullMQ) intercepts these records and retries the sync using exponential backoff, preventing lead loss."*

### 7.2 Business & Product Prep
> [!IMPORTANT]
> **Q: Why are all Module 2 onboarding interfaces designed with zero emojis?**
> *   **Answer:** *"Onboarding and campaign management are primary portals for enterprise financial and educational executives. Maintaining a clean, professional, emoji-free typography focuses attention on critical fields, reinforces corporate identity guidelines, and aligns the application interface with premium B2B SaaS standards."*

> [!IMPORTANT]
> **Q: Why is industry-specific workflow categorization necessary at ingestion?**
> *   **Answer:** *"Different industries require entirely different operations. Real estate leads require quick location-budget routing. BFSI leads must bypass DNC lines and check credit history. Under educational leads, we check academic prerequisites. Pre-classifying leads by industry ensures the scoring algorithms and conversational VOIZ scripts are tailored for higher conversion rates."*
