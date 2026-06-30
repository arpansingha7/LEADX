# LEADX Platform — Master Build Prompt

> Paste this into Cursor, Claude Code, or any AI coding agent to scaffold and implement the LEADX platform. This document is the authoritative source of truth for system behavior, data flow, and business logic across all 11 phases of the platform.

---

## 0. Platform Overview

LEADX is a multi-tenant, AI-powered lead qualification platform. It ingests leads from CRMs or file uploads, scores them using a weighted rule engine, routes them to the VOIZ AI calling agent, analyzes conversation outcomes, re-scores leads, syncs results back to the CRM, and surfaces intelligence through a real-time analytics dashboard.

**Tech stack (reference implementation):**
- Backend: Node.js (TypeScript) + Express / Fastify
- Queue: BullMQ + Redis
- Database: PostgreSQL (multi-tenant, all queries scoped by `tenant_id`)
- CRM connectors: HubSpot, Zoho CRM, Salesforce, LeadSquared (pluggable adapter pattern)
- AI calling: VOIZ API (external)
- Frontend: Next.js App Router (React)
- Notifications: in-app, email (Nodemailer / SendGrid), webhooks

All phases below must be implemented exactly as described. Do not skip steps or reorder phases.

---

## Phase 1 · Multi-Tenancy & User Management

### Behavior
1. A **Super Admin** logs in via a protected `/admin` route.
2. Super Admin creates a **Company** (tenant). Each company gets a unique `tenant_id` (UUID).
3. Super Admin assigns a **Plan** to the company (plan defines limits: max leads/month, max campaigns, max VOIZ minutes, max users).
4. Super Admin invites a **Company Admin** by email.
5. Company Admin accepts the invite, sets a password, and logs in.
6. Company Admin creates **Users** within their tenant and assigns roles: `admin`, `manager`, `agent`, `viewer`.

### Enforcement Rules
- **Every database query must include a `WHERE tenant_id = :tenantId` clause.** No exceptions.
- JWT tokens must encode `{ userId, tenantId, role }`.
- Middleware must extract `tenantId` from the JWT and inject it into every request context before any DB call is made.
- Role-based access control (RBAC) must be enforced at the API layer. Agents cannot see other tenants' data. Admins cannot exceed plan limits.
- Plan limits must be checked before any resource creation (lead, campaign, user). Return HTTP 429 with a descriptive error if exceeded.

### Data Models
```
Company { id, name, plan_id, created_at, status }
Plan { id, name, max_leads_per_month, max_campaigns, max_voiz_minutes, max_users }
User { id, tenant_id, email, role, status, invited_by, created_at }
```

---

## Phase 2 · CRM Connection & Field Mapping

### Behavior
1. A Company Admin selects a CRM platform: **HubSpot**, **Zoho CRM**, **Salesforce**, or **LeadSquared**.
2. The system presents the appropriate auth flow per CRM:
   - HubSpot → OAuth 2.0
   - Zoho CRM → OAuth 2.0
   - Salesforce → OAuth 2.0 (Connected App)
   - LeadSquared → API key + secret
3. On credential submission, the system **validates credentials** by making a test API call to the CRM (e.g., fetch 1 contact). If it fails, return a clear error and do not save credentials.
4. On success, credentials are stored encrypted (AES-256) in the DB, scoped to `tenant_id`.
5. The system fetches the CRM's available fields and presents a **field mapping UI** where the admin maps CRM fields to LEADX's internal schema: `name`, `phone`, `email`, `company`, `industry`, `source`, plus up to 10 custom fields.
6. Field mapping is saved per `(tenant_id, crm_platform)`.

### CRM Adapter Interface
All CRM connectors must implement this interface:
```typescript
interface CRMConnector {
  validateCredentials(credentials: CRMCredentials): Promise<boolean>;
  fetchFields(): Promise<CRMField[]>;
  fetchLeads(options: FetchOptions): Promise<RawLead[]>;
  pushLeadUpdate(leadId: string, update: LeadUpdate): Promise<void>;
  getAuthUrl?(): string; // OAuth only
  exchangeCode?(code: string): Promise<CRMCredentials>; // OAuth only
}
```

---

## Phase 3 · Lead Ingestion

### Entry Points
Two ingestion methods, both must be supported:

**A. CRM Import**
- Trigger: manual "Import from CRM" button or scheduled sync (configurable interval per tenant).
- Fetch leads from the connected CRM using the CRM adapter.
- Apply field mapping from Phase 2 to transform raw CRM data into the LEADX lead schema.

**B. CSV / Excel Upload**
- Accept `.csv` or `.xlsx` files up to 50MB.
- Parse using `papaparse` (CSV) or `xlsx` (Excel).
- Map columns to LEADX schema using a column-mapping UI (similar to field mapping in Phase 2).

### Ingestion Pipeline
Once leads are collected from either source:

1. **Create an Ingestion Job** record in the DB: `{ id, tenant_id, source, status: 'pending', total_records, created_at }`.
2. **Enqueue to BullMQ** ingestion queue: `leadx:ingestion`.
3. A **worker** picks up the job and runs the **Validation Engine**:

   **Validation Engine rules (all must pass):**
   - `name` is present and non-empty
   - `phone` is present and matches E.164 format (e.g. `+919876543210`)
   - `email` (if present) is a valid email format
   - All fields marked as mandatory in the tenant's config are present
   - No duplicate `phone` exists in the same tenant's lead table (dedup check)

4. If **any record fails validation**:
   - Do NOT insert any leads.
   - Generate a **Validation Report**: a structured list of failed rows with the specific rule that failed per row.
   - Save the report to the DB, attached to the ingestion job.
   - Update job status to `failed`.
   - Notify the user (in-app notification + email) with a link to download the report.
   - Expose a "Fix & Retry" flow: user can download the report, fix the file, and re-upload. The retry reuses the same job record (new attempt ID).

5. If **all records pass validation**:
   - Run the **Field Mapping Engine**: transform each record using the saved field map.
   - Insert all leads into the `leads` table with `tenant_id`, `status: 'ingested'`.
   - Associate leads with the selected campaign (see Phase 4).
   - Update job status to `completed`.

### Data Model
```
Lead {
  id, tenant_id, campaign_id,
  name, phone, email, company, industry, source,
  custom_fields (JSONB),
  status, score, created_at, updated_at
}

IngestionJob {
  id, tenant_id, source, status, total_records,
  valid_count, invalid_count, validation_report_url,
  created_at, completed_at
}
```

---

## Phase 4 · Campaign Creation & Lifecycle

### Campaign States
```
Draft → Configured → Validated → Ready → Active → Completed / Paused / Cancelled
```

### Behavior
1. User creates a campaign in **Draft** state.
2. User fills in the campaign config:
   - `name` — campaign name
   - `objective` — e.g. "Lead qualification", "Appointment booking"
   - `industry` — target industry vertical
   - `qualification_rules` — JSON array of rules used to determine if a lead is qualified
   - `retry_rules` — max retries, retry interval, retry conditions (no answer / busy / voicemail)
   - `calling_window` — days of week + time range (e.g. Mon–Fri, 09:00–18:00, tenant timezone)
   - `assigned_voiz_agents` — list of VOIZ agent IDs assigned to this campaign
   - `score_threshold` — minimum pre-call score to enter call queue (Phase 5)
3. On save, the system **validates** the config:
   - All required fields present
   - At least one VOIZ agent assigned
   - Qualification rules are syntactically valid
   - Calling window is valid (start < end, at least one day selected)
4. If invalid → return validation errors, stay in **Draft**.
5. If valid → move to **Ready** state.
6. Admin activates → **Active** state. Leads ingested into this campaign are immediately associated.
7. Leads are associated to a campaign at the time of ingestion (not post-ingestion).

### Data Model
```
Campaign {
  id, tenant_id, name, objective, industry,
  qualification_rules (JSONB), retry_rules (JSONB),
  calling_window (JSONB), assigned_voiz_agents (array),
  score_threshold, status, created_at, updated_at
}
```

---

## Phase 5 · Lead Scoring (Pre-Call)

### Behavior
After a lead is ingested and associated to a campaign, it must be scored **before** entering the call queue.

1. The scoring engine evaluates the lead against **5 configurable parameters** (defined per campaign or tenant):
   - Each parameter has a name, a condition (rule), and a weight (contribution to total score out of 100).
   - Parameters are fully configurable. Examples: `industry_match`, `company_size`, `data_completeness`, `source_quality`, `recency`.
2. Each parameter returns a sub-score (0–100).
3. Final score = weighted average across all 5 parameters → clamped to [0, 100].
4. Compare final score against campaign's `score_threshold`:
   - **Score < threshold** → set lead status to `low_priority`. Do not add to call queue.
   - **Score ≥ threshold** → set lead status to `queued`. Add to BullMQ call queue: `leadx:calls`.
5. Store the score and scoring breakdown in the `lead_scores` table.

### Data Model
```
LeadScore {
  id, lead_id, tenant_id, campaign_id,
  score (0–100), parameter_scores (JSONB),
  scored_at, scored_by ('pre_call' | 'post_call')
}
```

---

## Phase 6 · AI Calling (VOIZ)

### Behavior
The call queue worker processes leads from `leadx:calls`:

1. **Send lead data to VOIZ API**: POST lead context (name, phone, campaign objective, qualification questions, industry) to the VOIZ API.
2. **Agent assignment + schedule**: VOIZ assigns an agent from the campaign's assigned agents. The call is scheduled based on the campaign's calling window (Phase 4). Do not attempt calls outside the calling window.
3. **Call attempt** is initiated by VOIZ. LEADX receives a webhook callback with the call outcome.

### Call Outcomes (handle all of these)

| Outcome | Action |
|---|---|
| **Connected → Conversation** | VOIZ conducts the qualification conversation. Collect: transcript, collected responses, summary, structured JSON output. Store in `call_logs`. Proceed to Phase 7. |
| **No Answer** | Trigger retry logic (see below). |
| **Busy** | Trigger retry logic. |
| **Call Failed** | Log error with VOIZ error code. Trigger retry logic. |
| **Invalid Number** | Set lead status to `disqualified`. Reason: `invalid_number`. No retry. |
| **Voicemail** | VOIZ leaves a pre-configured voicemail message. Trigger retry logic. |

### Retry Logic
- On every non-connected outcome: increment `retry_count` on the lead.
- Check against campaign's `retry_rules.max_retries`:
  - If `retry_count < max_retries` → re-schedule the call (respect retry interval + calling window). Re-enqueue to `leadx:calls`.
  - If `retry_count >= max_retries` → set lead status to `disqualified`. Reason: `max_retries_reached`.

### Data Model
```
CallLog {
  id, lead_id, tenant_id, campaign_id,
  voiz_call_id, agent_id,
  outcome, transcript (text), responses (JSONB),
  summary (text), structured_output (JSONB),
  duration_seconds, attempted_at, completed_at,
  retry_count, disqualify_reason
}
```

---

## Phase 7 · Post-Call Re-Scoring & Qualification

### Behavior
Triggered immediately after a successful conversation is received from VOIZ (Phase 6).

1. **Conversation Analysis**: parse the structured JSON output from VOIZ. Extract intent signals, objection flags, and response quality indicators.
2. **Intent Detection**: classify lead intent as `high`, `medium`, `low`, or `none` based on conversation signals.
3. **Re-score**: run the scoring engine again (same 5-parameter framework from Phase 5), this time incorporating conversation signals as additional input to the parameters. Store with `scored_by: 'post_call'`.
4. **Conversion Probability**: compute a conversion probability (0–100%) as a secondary metric.
5. **Final Score Classification**:

| Score | Classification | Action |
|---|---|---|
| > 80 | **Hot** | Qualified. Notify sales team immediately (email + in-app). |
| 50–79 | **Warm** | Qualified. Notify sales team. |
| < 50 | **Cold** | Not qualified. Set status to `cold`. |
| — | **Disqualified** | Already set in Phase 6. No action. |

6. Update lead status to `qualified` (Hot/Warm) or `cold`.
7. Store final classification in `lead_scores`.

---

## Phase 8 · CRM Sync (Bi-Directional)

### Behavior
After a lead's status changes (qualified, disqualified, called, etc.), sync the update back to the CRM.

1. Enqueue a sync job to BullMQ: `leadx:crm_sync`.
2. Worker picks up the job and calls the appropriate CRM connector (from Phase 2).
3. The connector updates the corresponding CRM record with:
   - LEADX lead status
   - Score
   - Call outcome / disposition
   - Qualification classification
   - LEADX lead ID (for cross-reference)

### Sync Outcomes
- **Success** → Update `crm_sync_log` record as `success`. Notify sales team (email) that the CRM record is updated.
- **Failure** → Log failure. Retry up to 3 times with exponential backoff. If all retries fail → move to Dead Letter Queue (DLQ). Trigger an ops alert (webhook + in-app).

### Lead Statuses (must be synced to CRM)
`Ingested` → `Processing` → `Called` → `Qualified` → `Disqualified` → `Escalated` → `Converted`

### Data Model
```
CRMSyncLog {
  id, lead_id, tenant_id, crm_platform,
  crm_record_id, status ('success' | 'failed' | 'dlq'),
  attempt_count, last_attempted_at, error_message
}
```

---

## Phase 9 · Lead Intelligence

### Behavior
For every lead, maintain a complete, chronological intelligence record:

1. **Identity**: `crm_id`, `leadx_id`, cross-reference between systems.
2. **Call History**: all call attempts, outcomes, durations.
3. **Dispositions**: per-call outcome classification.
4. **Score Evolution**: pre-call score → post-call score, stored with timestamps.
5. **Message History**: voicemails left, emails sent.
6. **Timeline Generation**: automatically build a chronological event timeline for the lead (ingested → scored → called → re-scored → qualified → CRM synced).

### Output
Expose this data as a **Lead Intelligence Dashboard** in the frontend. Per lead, show:
- Summary card (name, phone, status, current score, classification)
- Score evolution chart (line graph over time)
- Call timeline
- Conversation transcript + structured output (from Phase 6)
- CRM sync status

---

## Phase 10 · Background Job Processor (BullMQ)

### Queues
All async work runs through BullMQ. The following queues must be defined:

| Queue Name | Purpose |
|---|---|
| `leadx:ingestion` | Lead ingestion jobs (Phase 3) |
| `leadx:crm_sync` | CRM sync jobs (Phase 8) |
| `leadx:scoring` | Scoring jobs (Phases 5 & 7) |
| `leadx:calls` | Call scheduling + VOIZ dispatch (Phase 6) |
| `leadx:analytics` | Analytics aggregation jobs (Phase 11) |
| `leadx:notifications` | Notification dispatch (email, in-app, webhook) |

### Worker Behavior (applies to all queues)
1. Worker picks up job from queue.
2. Executes the job handler.
3. **On success** → mark job as `completed`. Update the relevant DB record status.
4. **On failure** → check `attemptsMade` vs `opts.attempts`:
   - If `attemptsMade < max_attempts` → BullMQ auto-retries with exponential backoff.
   - If `attemptsMade >= max_attempts` → job moves to **Dead Letter Queue (DLQ)**. Trigger an ops alert.
5. All job failures must be logged with: `job_id`, `queue`, `error_message`, `stack_trace`, `tenant_id`, `timestamp`.

### Configuration
- Redis connection must be configurable via env vars.
- Worker concurrency must be configurable per queue.
- Retry attempts per queue: `ingestion: 3`, `crm_sync: 3`, `scoring: 2`, `calls: use campaign retry_rules`, `analytics: 2`, `notifications: 3`.
- DLQ alert threshold: immediately on first DLQ entry.

---

## Phase 11 · Analytics & Notifications

### Analytics Dashboards
Four analytics views must be implemented, each scoped by `tenant_id`:

**1. Campaign Analytics**
- Total leads per campaign
- Leads by status (ingested / processing / called / qualified / disqualified)
- Qualification rate (%)
- Average pre-call and post-call score
- Campaign progress (active leads / total leads)

**2. Lead Analytics**
- Score distribution histogram
- Classification breakdown (Hot / Warm / Cold / Disqualified)
- Conversion funnel (ingested → scored → called → qualified)
- Top-performing industries / sources

**3. Agent Analytics**
- Per VOIZ agent: calls handled, qualification rate, average conversation duration
- Agent utilization over time

**4. Cost Metrics**
- VOIZ minutes consumed vs. plan limit
- Leads processed vs. plan limit
- Cost per qualified lead (if cost-per-minute is configured)

All analytics must update in **real-time** (use WebSockets or SSE for live updates).

### Notifications

| Trigger | Notification Type | Recipients |
|---|---|---|
| Campaign completed | In-app notification | Campaign owner, company admin |
| Lead qualified (Hot/Warm) | Email + in-app | Assigned sales user, company admin |
| CRM sync failed | Ops alert + webhook | Company admin, ops webhook URL |
| Ingestion error (validation failed) | In-app + email | User who triggered ingestion |
| Agent error (VOIZ API failure) | System alert + in-app | Company admin |

Notification templates must be customizable per tenant (HTML email templates stored in DB).

Webhooks must POST a JSON payload to a tenant-configured URL. Retry webhook delivery up to 3 times with exponential backoff on non-2xx responses.

---

## Cross-Cutting Concerns

### Multi-tenancy (applies everywhere)
- Every API endpoint must validate the JWT and extract `tenant_id`.
- Every DB query must be scoped by `tenant_id`. Use a DB middleware or repository pattern to enforce this automatically.
- Tenants must never be able to access another tenant's data, even if they guess a valid UUID.

### Error Handling
- All async operations must have try/catch with structured error logging.
- All BullMQ jobs must handle errors gracefully and never crash the worker process.
- User-facing errors must be descriptive (what went wrong + what to do).
- System-facing errors must include `tenant_id`, `job_id`, `timestamp`, and stack trace.

### Security
- Credentials (CRM API keys, tokens) must be stored encrypted (AES-256-GCM) with the encryption key in env vars.
- All file uploads must be scanned for MIME type (reject non-CSV/XLSX).
- File size limit: 50MB per upload.
- Rate limiting on all public API endpoints.

### Environment Variables (minimum required)
```
DATABASE_URL
REDIS_URL
JWT_SECRET
ENCRYPTION_KEY
VOIZ_API_URL
VOIZ_API_KEY
SENDGRID_API_KEY (or SMTP config)
```

---

## End of Specification

Every feature, flow, and decision described in this document must be implemented. Do not add features not described here without confirmation. Do not skip phases. Implement them in order (Phase 1 first, Phase 11 last), as later phases depend on earlier ones.
