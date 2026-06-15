# LEADX Platform — API Contracts

All endpoints are hosted under the `/leads` namespace to maintain compatibility with single-page routing structures.

---

## 1. Script Management

### POST `/leads/scripts`
Creates or updates a conversational script configuration.
- **Request Body (JSON):**
  ```json
  {
    "tenant_id": "default-tenant",
    "script_id": "edtech-admissions-v1",
    "version": "1.0",
    "language": "en",
    "max_duration_seconds": 300,
    "escalation_triggers": [
      {
        "type": "explicit_request",
        "phrases": ["speak to advisor", "talk to human"]
      },
      {
        "type": "sentiment_low",
        "threshold": 0.3
      }
    ],
    "nodes": [
      {
        "id": "greeting",
        "prompt": "Hello {lead_name}, I am calling from Predixion AI Academy. Am I speaking with the right person?",
        "expected_intents": ["yes", "no"],
        "branches": {
          "yes": "course_interest",
          "no": "wrong_number"
        }
      }
    ]
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "script": {
      "id": "e42e4726-281b-4f9e-a89e-83d97f26f212",
      "tenant_id": "default-tenant",
      "script_id": "edtech-admissions-v1",
      "version": "1.0",
      "language": "en",
      "max_duration_seconds": 300,
      "escalation_triggers": [...],
      "nodes": [...],
      "created_at": "2026-06-15T10:00:00Z"
    }
  }
  ```

### GET `/leads/scripts`
Retrieves all scripts published under a specific tenant.
- **Query Parameters:**
  - `tenant_id` (Required)
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "scripts": [
      {
        "id": "e42e4726-281b-4f9e-a89e-83d97f26f212",
        "tenant_id": "default-tenant",
        "script_id": "edtech-admissions-v1",
        "version": "1.0",
        ...
      }
    ]
  }
  ```

### GET `/leads/scripts/:id`
Retrieves a specific script by UUID or by script_id.
- **Query Parameters (only if searching by script_id):**
  - `tenant_id`
  - `version` (Optional, defaults to latest)
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "script": {
      "id": "e42e4726-281b-4f9e-a89e-83d97f26f212",
      ...
    }
  }
  ```

---

## 2. Instant Call Dispatching

### POST `/leads/calls/instant`
Immediately initiates a high-priority call session. Bypasses the priority dialer queue. If maximum active concurrency limits are reached, enqueues the lead with highest priority (`score = 999`).
- **Request Body (JSON):**
  ```json
  {
    "tenant_id": "default-tenant",
    "lead_id": "038bf226-d25a-493e-812a-89a37e81cf26"
  }
  ```
- **Response (200 OK - Direct Dialing):**
  ```json
  {
    "success": true,
    "dial_mode": "instant",
    "voiz_session_id": "voiz-sess-0f4728da",
    "session_id": "93f2f82c-29b1-4f9e-99f2-8ef938dae921"
  }
  ```
- **Response (200 OK - Enqueued):**
  ```json
  {
    "success": true,
    "dial_mode": "queued_high_priority",
    "message": "Concurrency limit reached. Enqueued at highest priority."
  }
  ```

---

## 3. Handoff & Escalations

### GET `/leads/handoff/brief/:lead_id`
Serves the generated agent briefing card context for supervisor reviews.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "brief": {
      "lead_name": "Raman Iyer",
      "phone": "+919999912345",
      "lead_score": 88,
      "call_duration_seconds": 120,
      "call_summary": "The customer expressed immediate interest in gold loans but had concerns regarding processing fees and documentation.",
      "key_phrases": ["speak to advisor", "how do I pay"],
      "objections": ["processing fees too high", "needs physical branch details"],
      "recommended_action": "Explain the zero processing fee promotion and offer local branch direction."
    }
  }
  ```

### POST `/leads/:id/resolve`
Marks a hot escalation as resolved, clearing flags and transitioning the lead status to called.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "lead": {
      "id": "e62a7559-d2b1-49e8-ad93-b639a9788e5c",
      "status": "called",
      ...
    },
    "message": "Escalation resolved successfully."
  }
  ```

### POST `/leads/handoff/escalate`
Triggers an explicit manual escalation for a call session.
- **Request Body (JSON):**
  ```json
  {
    "tenant_id": "default-tenant",
    "lead_id": "e62a7559-d2b1-49e8-ad93-b639a9788e5c",
    "voiz_session_id": "voiz-sess-8f828a1c",
    "reason": "Customer requests supervisor call"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Session manually escalated.",
    "brief": {
      "lead_name": "Raman Iyer",
      "phone": "+919999912345",
      "lead_score": 88,
      "call_duration_seconds": 0,
      "call_summary": "Manual escalation triggered by agent request.",
      "key_phrases": [],
      "objections": [],
      "recommended_action": "Supervisor should contact the lead immediately."
    }
  }
  ```

---

## 4. Analytics Summaries

### GET `/leads/analytics/summary`
Aggregates performance status, connects rate trends, and KPIs.
- **Query Parameters:**
  - `tenant_id`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "kpis": {
      "calls_today": 142,
      "connect_rate": 68.4,
      "qualified_leads": 12,
      "hot_leads": 5
    },
    "funnel": {
      "ingested": 200,
      "scrubbed": 198,
      "scored": 200,
      "queued": 140,
      "attempted": 142,
      "connected": 97,
      "qualified": 12
    },
    "dispositions": [
      { "name": "CALLED", "value": 85 },
      { "name": "HOT_ESCALATED", "value": 5 },
      { "name": "DNC", "value": 2 },
      { "name": "QUEUED", "value": 50 }
    ],
    "connect_rate_trend": [
      { "date": "2026-06-10", "connect_rate": 62.4 },
      { "date": "2026-06-11", "connect_rate": 65.1 },
      { "date": "2026-06-12", "connect_rate": 68.4 }
    ],
    "scoring_effectiveness": [
      { "category": "Hot (>=80)", "converted": 5 },
      { "category": "Warm (50-79)", "converted": 6 },
      { "category": "Cold (<50)", "converted": 1 }
    ]
  }
  ```
