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
*   **HubSpot OAuth 2.0 Integration & Auto-Refresh (Module 2):** Supports secure 3rd party authentication via OAuth 2.0 protocol with custom mock consent popups, automatic access token refreshing, and JSONB database credential storage.
*   **CRM Sync Control Center (Module 2):** Connects to HubSpot and LeadSquared with real-time connector pipeline visualization nodes, Private App / Access Key testing handshakes, manual/bulk push tables, and sync audit logging.
*   **Direct CRM Inbound Sync (Module 2):** Fetches and syncs target contact lists/segments directly from HubSpot or LeadSquared into active LeadX pipelines.
*   **Dynamic Lead Analytics (Module 2):** Displays real-time qualitative lead insights (Total Leads, Average Intent Score, Hot Lead volume/percentage, Qualified contact counts/percentage) directly inside the Intelligence Feed.
*   **Dynamic Industry-Specific Scoring (Module 2):** Custom math rules for BFSI, Real Estate, and Education domains, mapping unique fields (e.g. credit score, budget, qualification) to qualify leads with high precision.

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
*   **Dynamic Lead Analytics Cards:** Located at the top of the feed, displaying critical volumes and average conversion rates:
    *   *Total Ingested Leads:* Active lead count across all campaigns.
    *   *Average Intent Score:* Aggregated qualitative intent percentage.
    *   *Hot Leads:* Count and percentage of leads with qualification score $\ge 80$.
    *   *Qualified Contacts:* Count and percentage of leads with qualification score $\ge 65$.
*   **Ingestion Forms:**
    *   **Single Lead Ingest:** Manually add a lead by inputting contact details, demographics, and page interaction triggers.
    *   **Batch JSON Ingest:** Paste a raw JSON list arrays of leads for fast, high-volume testing.
    *   **Import from CRM:** Connect to HubSpot or LeadSquared and sync specific contact lists (e.g. *BFSI Hot Contacts*, *Real Estate Prospects*, or *Education Registrations*) directly into your active LeadX pipeline.
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

### 2.7 CRM Sync Control Center Tab
*   **Integration Pipeline Node:** Displays an interactive network status map. Nodes glow green when connections are tested and verified.
*   **HubSpot Integration Panel:** Supports authentication via OAuth 2.0 or Private App Access tokens. It defines sync rules (e.g. auto-sync Hot Escalated leads or Qualified leads, attach transcripts).
*   **LeadSquared Integration Panel:** Configures regional API endpoints with Access and Secret keys.
*   **Manual Push & Bulk Sync Queue Drawer:** Pulls a list of unsynced qualified/hot leads. Select leads via checkboxes and push them in bulk or individually.
*   **CRM Logs Audit Logbook:** Displays continuous sync status updates, timestamps, target platforms, success metrics, and external entity IDs.

---

## 3. CRM Integration Guide for Clients

LEADX uses the **Adapter Pattern** to standardize data syncs to external CRM platforms. The core server calls a single interface, while custom adapters translate payload shapes to target CRM API structures.

### 3.1 Integration Authentication Protocols & Connection Payload Shapes

#### HubSpot Integration Setup
*   **Authentication Modes:**
    *   **OAuth 2.0 (Preferred):** User triggers authorization flow redirection. Authorization endpoints (`/oauth/hubspot/authorize` and callback `/oauth/hubspot/callback`) handle code exchanges for credentials. Tokens are saved in the tenant onboarding config JSONB column. 
    *   **Private App Access Token (Fallback):** Manual authorization key stored in configuration (`HUBSPOT_API_KEY`).
*   **Token Refresh Scheduler:** Authorizations expire in 5 hours (18,000 seconds). The backend automatically intercepts expired sessions during sync cycles, executes `refreshHubSpotToken` server-to-server POST requests using saved refresh tokens, updates database configs, and retries the sync without failing transactions.
*   **Endpoint:** `POST https://api.hubapi.com/crm/v3/objects/contacts`
*   **Connection Protocol:** Bearer Token authentication via the `Authorization: Bearer <access_token>` header.
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
*   **Authentication Modes:**
    *   **Access Key & Secret Key:** Direct authentication setup. Kept secure and checked against regional servers.
*   **Endpoint:** `POST https://api.leadsquared.com/v1/LeadManagement.svc/Lead.Create`
*   **Connection Protocol:** API Key authentication via `LEADSQUARED_API_KEY` header, or customized Access Key mappings saved in onboarding configuration.
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

### 3.2 Direct CRM Inbound Pulling (Lists Integration)
LEADX supports fetching marketing list files directly from CRM targets and converting them into normalized lead feeds:
*   **Connection Check:** Verifies CRM node connection flags.
*   **Lists Selection:** User selects segment dropdowns (e.g. *BFSI Hot Contacts*, *Real Estate Prospects*, *Education Registrations*).
*   **Inbound Parser:** Dispatches batch payload array maps (`/leads/batch`), normalizing contacts in the background.

### 3.3 Bulk CRM Syncing Endpoint
*   **Endpoint:** `POST /leads/batch-sync-crm`
*   **Payload:**
    ```json
    {
      "ids": ["lead-uuid-1", "lead-uuid-2"],
      "provider": "hubspot"
    }
    ```
*   **Response:** Iterates through ID maps, fetches profiles, triggers adapters in parallel, writes success statuses to logs, and returns status details:
    ```json
    {
      "success": true,
      "message": "Batch sync completed for hubspot",
      "results": [
        { "id": "lead-uuid-1", "success": true, "result": { "id": "hs-contact-99201" } },
        { "id": "lead-uuid-2", "success": true, "result": { "id": "hs-contact-99202" } }
      ]
    }
    ```

### 3.4 Sync Failure Strategy
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
*   **Dynamic Industry Demographic Fit Rules:** Demographic fit is calculated using specific rules mapped based on active industry categories:
    *   **BFSI Template:** Evaluates `monthly_income` ($\ge 85,000$ returns $100$; $\ge 45,000$ returns $80$; else $50$), `credit_score` ($\ge 750$ returns $100$; $\ge 650$ returns $75$; else $40$), and `loan_amount` (between $100,000$ and $1,500,000$ returns $100$; else $70$).
    *   **Real Estate Template:** Evaluates `budget` ($\ge 5,000,000$ returns $100$; $\ge 2,500,000$ returns $80$; else $50$), `property_type` matching 2BHK/3BHK queries (returns $100$; else $70$), and `location_preference` (matching Mumbai, Pune, Center keywords returns $100$; else $70$).
    *   **Education Template:** Matches `course_interest` (returns $100$) and `qualification` keywords like graduate, bachelor, degree (returns $100$; else $70$).
    *   **Default Baseline Fallbacks:** If no industry template matches, calculates demographic fit by averaging Age (21-35: 100, 18-45: 70, else 40), City (Tier 1: 100, Tier 2: 70, else 40), and Income (>=500k: 100, >=300k: 75, else 45) scores.
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

### Part 1: Vedika (Frontend Flow & Client Journey) — 6 Minutes

#### Step 6.1: Introduction & Onboarding Wizard (1.5 mins)
*   **What to do:** Open the browser to `http://localhost:3000`. Click on the **Onboarding** tab in the sidebar. Show the questionnaire wizard.
*   **What to say:**
    > *"Good morning. For Module 2, we focused on the client onboarding journey and enterprise integration layer. We designed a cohesive 4-step Onboarding Wizard adhering to clean design principles with zero emojis. This wizard guides business tenants from raw lead data upload to automated voice agent routing, custom mapping configurations, and CRM sync setup."*

#### Step 6.2: Discovery Questionnaire & Custom Industry Mapping (1.5 mins)
*   **What to do:** In Step 1, select **BFSI** from the industry dropdown. Type "Credit Card Qualification" as the campaign objective, "Voice Agent will pitch Premium Cards" as the focus, and choose English and Hindi. Click **Proceed to Data Upload**. In Step 2, click **Load BFSI CSV Sample**, parse it, and in Step 3 adjust mapping targets. Show the live mapping preview table updating.
*   **What to say:**
    > *"In Step 1, the client completes our Discovery Questionnaire. Selecting an industry template like BFSI alters the backend scoring parameters and templates dynamically. The column mapping parses raw headers and maps them to internal schema fields, allowing complete configuration freedom. Unmapped columns are safely packed into a raw data JSONB block."*

#### Step 6.3: CRM Connection & HubSpot OAuth Approval (1.5 mins)
*   **What to do:** Click on the **CRM Integration** tab in the sidebar. Point out the interactive connector pipeline map. Under HubSpot, click **Connect HubSpot CRM**. Spawns the mock OAuth Consent Screen popup. Click **Approve Connection**. Show popup closing, a toast success message appearing, and the HubSpot node glowing green with "CONNECTED" status.
*   **What to say:**
    > *"Next, we've integrated HubSpot OAuth 2.0. By clicking 'Connect HubSpot CRM', the user authorizes LeadX. Since we are running in a local sandbox context, the platform redirects to our custom HTML Mock Consent UI. Upon approval, authorization tokens are securely passed back, saved, and the visual integration map highlights our connection is active."*

#### Step 6.4: Direct CRM Inbound Pulling & Feed Analytics (1.5 mins)
*   **What to do:** Go back to the **Lead Intelligence** tab. Click on **Import from CRM** tab in the ingestion section. Select **HubSpot CRM**, select the list **BFSI Hot Contacts (3 leads)**, click **Sync CRM Contacts**. Wait for the toast completion. Show the list table updating. Point to the **Dynamic Lead Analytics Cards** at the top showing updated total leads, intent averages, and qualification ratios.
*   **What to say:**
    > *"We also support direct inbound sync from CRMs. Under Lead Intelligence, we choose our list segment, verify it is active, and click Sync. Contacts are fetched, parsed, normalized, scored, and committed to the LeadX database. At the top of our feed, the Dynamic Lead Analytics cards immediately adjust to show our total lead volume, average intent scoring, and percentage of hot and qualified contacts."*

---

### Part 2: Arpan (Backend Infrastructure & Integration) — 6 Minutes

#### Step 6.5: Normalized Industry Scoring & DNC Shield (1.5 mins)
*   **What to do:** Open the code editor. Point to the custom scoring rules inside [scoringEngine.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/services/scoringEngine.js) and the platform DNC filter check in [leads.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/routes/leads.js).
*   **What to say:**
    > *"On the backend, incoming leads go through industry-specific scoring filters. In BFSI mode, our engine validates monthly income, loan thresholds, and credit ratings dynamically. In Real Estate mode, it qualifies budget parameters, location, and BHK preferences. Furthermore, before triggering dial sessions, we run a DNC Shield validation check to filter phone numbers against national registries, logging blocks in our Postgres audit trails."*

#### Step 6.6: Database OAuth Storage & Auto-Token Refresh (1.5 mins)
*   **What to do:** Open the code editor. Point to the OAuth callback handler route in [oauth.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/routes/oauth.js) and token refresh routines in [crmService.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/services/crmService.js).
*   **What to say:**
    > *"When Vedika clicked approve, HubSpot redirected to our backend callback, exchanging authorization codes for access and refresh tokens. These tokens are saved inside the tenant's onboarding config JSONB row in our database. Our CRM service automatically checks token expiration. If expired, it triggers a background refresh token exchange (`refreshHubSpotToken`), ensuring continuous API connectivity."*

#### Step 6.7: Manual/Bulk CRM Sync & System Audits (1.5 mins)
*   **What to do:** Open the browser. Under **CRM Integration**, click the **Manual Push Queue** drawer. Select multiple leads, choose HubSpot, click **Bulk Sync**. Point out the visual connection line active animation, toast notification, and new entries in the **CRM Logs** audit logger below.
*   **What to say:**
    > *"For data outflow, we provide manual and bulk CRM syncing. In the CRM tab, the Manual Push Queue displays all unsynced qualified contacts. Selecting them and clicking 'Bulk Sync' dispatches requests to our `/leads/batch-sync-crm` endpoint. The server connects via HubSpot or LeadSquared adapters in parallel, records successes in our logging table, and notifies our operations team on Slack."*

#### Step 6.8: Test Assertions Execution (1.5 mins)
*   **What to do:** Open the terminal in the IDE workspace. Execute `npm test`. Show all 15 test assertions completing green and outputting successfully.
*   **What to say:**
    > *"We validate our entire integration engine using native automated test suites. We have mock assertions checking single/batch ingestion, custom industry weight updates, OAuth callback credential saves, bulk sync failures, and event streams. All 15 tests execute cleanly in under 2 seconds, proving the reliability of our system. Vedika and I are ready for questions."*

---

## 7. Saturday Technical & Business Q&A Prep Sheet

### 7.1 Technical Prep
> [!TIP]
> **Q: How does OAuth 2.0 function in LeadX, and how do we handle session credential expirations?**
> *   **Answer:** *"Our HubSpot adapter queries the tenant onboarding config JSONB columns for token payloads. When a sync request is made, we check if the current time exceeds `expires_at`. If it has expired, we run `refreshHubSpotToken()` server-to-server POSTing to the token callback, retrieve an updated access token, write it back to our database, and complete the CRM push asynchronously."*

> [!TIP]
> **Q: How are CRM lists imported directly without overloading database ingestion?**
> *   **Answer:** *"Direct CRM imports utilize list selections to retrieve contact segments. The client triggers the sync, and our backend receives the list as a batch dataset, passing it to our optimized `/leads/batch` route. This route filters duplicates, checks phone normalizations, runs math calculations, and bulk inserts them, maintaining sub-second ingestion rates."*

> [!TIP]
> **Q: How does the scoring engine evaluate demographic fit dynamically based on industry templates?**
> *   **Answer:** *"The demographic fit calculation is dynamic. If the active tenant config is set to BFSI, the engine qualifies credit score, monthly income, and loan parameters. If Real Estate is active, it searches budget ranges and BHK property styles using regular expressions. If Education is active, it checks graduate qualifications and course interests. This ensures lead score calculations are highly industry-relevant."*

### 7.2 Business & Product Prep
> [!IMPORTANT]
> **Q: Why are all Module 2 onboarding interfaces designed with zero emojis?**
> *   **Answer:** *"Onboarding and campaign management are primary portals for enterprise financial and educational executives. Maintaining a clean, professional, emoji-free typography focuses attention on critical fields, reinforces corporate identity guidelines, and aligns the application interface with premium B2B SaaS standards."*

> [!IMPORTANT]
> **Q: Why is industry-specific workflow categorization necessary at ingestion?**
> *   **Answer:** *"Different industries require entirely different operations. Real estate leads require quick location-budget routing. BFSI leads must bypass DNC lines and check credit history. Under educational leads, we check academic prerequisites. Pre-classifying leads by industry ensures the scoring algorithms and conversational VOIZ scripts are tailored for higher conversion rates."*

---

## 8. Real-Time Sandbox Integration & Verification Guide

This section outlines how to transition the platform from the offline local mock context to a live, real-time environment.

### 8.1 Step 1: Initialize the Local Workspace
Ensure the Node dependencies are installed and the development server is running:
1. Install core dependencies:
   ```bash
   npm install
   ```
2. Start the hot-reloading development server:
   ```bash
   npm run dev
   ```
3. Open [http://localhost:3000](http://localhost:3000) in your web browser.

### 8.2 Step 2: Establish the Live Postgres Database (Supabase)
To move away from the local, volatile in-memory database adapter (configured in [db.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/config/db.js)):
1. Create a database project in the **[Supabase Dashboard](https://supabase.com)** (this has already been provisioned under project ID `navklqmhgvluddoxqbag`).
2. In the **SQL Editor** tab of your Supabase console, paste and run the SQL instructions located in **[database/schema.sql](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/database/schema.sql)**. This will initialize the schemas and disable Row-Level Security (RLS) policies for sandboxed demo client reads/writes (already applied on the active project).
3. Open your local **[.env](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/.env)** config file and configure the credentials. The project URL is pre-filled:
   ```env
   SUPABASE_URL=https://navklqmhgvluddoxqbag.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
   ```

### 8.3 Step 3: Connect Live Slack Webhook Alerts (With Offline Fallback)
To route system notifications and hot-lead alerts to your operational channels:
1. Create a Slack App in your workspace via the **[Slack API Console](https://api.slack.com/apps)**.
2. Enable **Incoming Webhooks** and authorize it for your target channel (e.g. `#notifications`).
3. Copy the Webhook URL and paste it into your local **[.env](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/.env)** file:
   ```env
   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00/B00/XXXXXX
   ```
   *(Backend logging flows defined in [slackService.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/services/slackService.js) will automatically swap from debug stdout printing to live Slack HTTP dispatches).*

> [!NOTE]
> **Slack Free Plan App Limit Fallback:** If your Slack workspace has reached its limit of 10 apps (common on free tiers) and cannot install the LeadX alerts app, you do not need to do anything. If `SLACK_WEBHOOK_URL` in [`.env`](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/.env) is left as the default mock URL (`https://hooks.slack.com/services/mock/webhook/url`) or is empty, [`slackService.js`](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/services/slackService.js) will automatically fall back to logging all notification alerts directly to the terminal stdout console.

### 8.4 Step 4: Integrate Real CRM Handshakes
Update credentials in **[.env](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/.env)** or through the Client Portal UI:
* **HubSpot CRM:**
  * Configure your HubSpot OAuth 2.0 app credentials:
    ```env
    HUBSPOT_CLIENT_ID=<your-client-id>
    HUBSPOT_CLIENT_SECRET=<your-client-secret>
    ```
  * Or, configure a HubSpot Private App access key as a direct fallback:
    ```env
    HUBSPOT_API_KEY=<your-private-app-access-token>
    ```
* **LeadSquared CRM:**
  * Define your regional access key:
    ```env
    LEADSQUARED_API_KEY=<your-leadsquared-api-key>
    ```
  *(The adapters in [crmService.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/services/crmService.js) check for live keys, sending payload objects directly to the vendor endpoints instead of using internal mock stubs).*

### 8.5 Step 5: Configure Outbound Dialer & Webhook Loops (VOIZ)
Outbound voice dialing sessions use webhooks to report call state changes in real time. To receive live callbacks from external telephony APIs:
1. **Expose Localhost Port:** External servers cannot route traffic to `localhost`. Expose port 3000 to the public web using **ngrok**:
   ```bash
   ngrok http 3000
   ```
2. **Setup Call Webhooks:** Ensure that the webhook callback parameter generated in [leads.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/routes/leads.js#L418) maps to the public ngrok address (e.g., `https://<subdomain>.ngrok-free.app/leads/voiz-webhook`).
3. **Trigger Live Calls:** Swap the mock dialing initiator in [voizAdapter.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/services/voizAdapter.js) with a live API POST request to the VOIZ outbound campaign service.

### 8.6 Step 6: Ingest Real Lead Lists
With the system fully configured, you can populate active pipelines:
* **Onboarding UI Wizard:** Navigate to the Onboarding tab, upload a real CSV contact sheet, map the custom columns dynamically in the UI preview grid, and hit **Finalize** to ingest.
* **Direct Webhooks / Ingestion API:** Configure third-party lead generation forms (e.g., LeadSquared Webhooks, Facebook Lead Ads, custom webforms) to POST JSON payloads directly to your endpoint `/leads/ingest` or `/leads/batch`.
