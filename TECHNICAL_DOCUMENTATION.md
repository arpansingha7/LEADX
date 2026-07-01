# LEADX Platform Technical Documentation

## 1. System Overview & Architecture

LEADX is a next-generation, multi-tenant AI-powered lead qualification and conversion platform. It operates as the orchestration layer sitting on top of **VOIZ** (Predixion AI's voice agent telephony infrastructure). While VOIZ handles ASR, TTS, and conversational LLM runtimes, LEADX manages ingestion pipelines, dynamic intent scoring, caller scheduling, DNC screening, CRM integrations, and operations alerting.

### Core Architecture Flow
```mermaid
flowchart TD
    A[Lead Sources / CSVs / CRM Webhooks] -->|POST /leads/ingest| B(Ingestion API)
    CRM[CRM Contacts Inbound] -->|Pull List Segments| B
    B -->|1. Normalize Phone| C{Duplicate Check}
    C -->|Duplicate Found| D[409 Conflict Response]
    C -->|Unique Phone| E{DNC Screen}
    E -->|Blocked| F[DNC Status & Slack Alert]
    E -->|Allowed| G[Scoring Engine v2]
    G -->|2. Compute Score| H[Dual-Mode Database Adapter]
    H -->|Supabase Configured| I[(Live Supabase Cloud DB)]
    H -->|Supabase Offline| J[(In-Memory Sandbox DB)]
    I & J -->|3. Live Refresh| K[Glassmorphic Control Center UI]
    K -->|4. Trigger Outbound Call| L[VOIZ Dialer Adapter]
    L -->|5. Webhook callbacks| B
    B -->|6. Sync Outcomes| M[CRM Sync Adapter HubSpot/LS/Salesforce]
    B -->|7. Slack webhook| N[Slack Notifications]
```

### Technology Stack
- **Backend:** Node.js + Express (ESM). Highly efficient for real-time voice webhook streams.
- **Database:** Supabase (PostgreSQL) for relational schema (ACID-compliant state transitions) and JSONB indexing.
- **Queue System:** BullMQ + Redis for asynchronous background processing.
- **Frontend UI:** Vanilla HTML5 & CSS3 with a custom-built dark theme.
- **AI Calling:** VOIZ API (external).

---

## 2. Platform Modules & Phases

### Phase 1: Multi-Tenancy & User Management
- **Tenancy:** Every database query is scoped by `tenant_id` (UUID). Role-based access control (RBAC) enforces isolation between `admin`, `manager`, `agent`, and `viewer` roles.
- **Plans:** Companies are assigned Plans that limit max leads/month, max campaigns, max VOIZ minutes, and max users.

### Phase 2: CRM Connection & Field Mapping
- **Adapters:** Connectors for HubSpot (OAuth), Zoho CRM (OAuth), Salesforce (OAuth), and LeadSquared (API Key). 
- **Mapping:** Administrators can map CRM fields to LEADX's internal schema dynamically. Credentials are encrypted via AES-256-GCM.

### Phase 3: Lead Ingestion Pipeline
- **Validation Engine:** Validates required fields, E.164 phone formats, and uniqueness (deduplication). Failed validations generate structural reports instead of halting entirely.
- **Data Intake:** Supports REST API endpoints (`POST /leads/ingest`, `POST /leads/batch`) and browser-based CSV/Excel column mapping.

### Phase 4: Campaign Lifecycle
- **States:** Draft → Configured → Validated → Ready → Active → Completed/Paused/Cancelled.
- **Configuration:** Defines objectives, qualification rules, retry conditions (backoff intervals), and calling windows (e.g., 9:00 AM - 8:00 PM IST).

### Phase 5: Lead Scoring (Pre-Call)
- **Engine:** Config-driven multi-factor rules evaluating 5 customizable parameters (e.g., industry, company size).
- **Thresholds:** Computes a score [0, 100]. Leads scoring below the threshold are deprioritized; those above are queued to `leadx:calls` via BullMQ.

### Phase 6: AI Calling & Dispatch (VOIZ)
- **Dispatch:** Worker sends lead context (name, objective, custom questions) to the VOIZ API.
- **Retry Logic:** Exponential backoffs are used for No Answer, Busy, or Voicemail statuses. Exceeding max retries marks the lead as `disqualified`.

### Phase 7: Post-Call Re-Scoring & Qualification
- **Analysis:** Parses structured JSON from VOIZ transcripts for intent signals, objections, and conversation sentiment.
- **Classification:** 
  - `> 80`: **Hot** (Qualified, triggers immediate alerts)
  - `50-79`: **Warm** (Qualified)
  - `< 50`: **Cold** (Not qualified)

### Phase 8: Bi-Directional CRM Sync
- **Webhook Updates:** Async jobs update connected CRM records with LEADX lead statuses (`Processing`, `Qualified`, `Converted`), scores, and call dispositions.
- **Fallback:** Failed syncs use a Dead Letter Queue (DLQ) for operations alerting.

### Phase 9 & 10: Intelligence & Asynchronous Workers
- **Lead Timeline:** Chronological event histories including call durations, dispositions, score evolution, and voicemails.
- **BullMQ Topology:** Includes distinct queues for `ingestion`, `crm_sync`, `scoring`, `calls`, `analytics`, and `notifications`.

### Phase 11: Real-Time Analytics & Alerting
- **Dashboards:** View conversion funnels, score distribution histograms, agent utilization, and VOIZ consumption costs.
- **Notifications:** Delivered via in-app feeds, Nodemailer/SendGrid emails, and Slack Webhooks.

---

## 3. Deployment & Environment Setup

### Prerequisites
Install Node.js dependencies:
```bash
npm install
```

### Environment Variables
Create a `.env` file referencing the following required variables:
```env
DATABASE_URL=postgres://user:password@hostname:port/dbname
REDIS_URL=redis://hostname:port
JWT_SECRET=your_secure_jwt_secret
ENCRYPTION_KEY=32_byte_hex_key_for_aes_256_gcm
VOIZ_API_URL=https://api.voiz.ai/v1
VOIZ_API_KEY=your_voiz_api_key
SENDGRID_API_KEY=your_sendgrid_key
```

### Database Migration
1. Provision a PostgreSQL instance via **Supabase**.
2. Run the provided schema migrations in `database/schema.sql` via the Supabase SQL Editor.
3. The platform dual-supports an In-Memory Sandbox DB for local testing if Supabase is offline.

---

## 4. API Interface Contracts

### CRM Adapter Standard Interface
All future CRM integrations must satisfy this abstract class/interface:
```typescript
interface CRMConnector {
  validateCredentials(credentials: CRMCredentials): Promise<boolean>;
  fetchFields(): Promise<CRMField[]>;
  fetchLeads(options: FetchOptions): Promise<RawLead[]>;
  pushLeadUpdate(leadId: string, update: LeadUpdate): Promise<void>;
}
```

### Ingestion Endpoints
- `POST /leads/ingest`
- `POST /leads/batch`
- `POST /leads/calls/instant` (High-priority bypass API for instant outbound dialing)

All endpoints require JWT authorization carrying `{ userId, tenantId, role }`.
