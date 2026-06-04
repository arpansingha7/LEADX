# LEADX Module 1 — Ingestion & Scoring Engine Documentation

This documentation covers **Module 1 (Week 1)** of the LEADX Platform, outlining the Lead Ingestion API, dynamic config-driven Lead Scoring Engine, Database Schema, and the interactive Frontend Control Center.

---

## 1. Directory Structure

```text
LEADX/
├── database/
│   └── schema.sql             # Supabase / PostgreSQL DDL setup script
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   └── db.js          # Database client with live/offline-mock capability
│   │   ├── routes/
│   │   │   └── leads.js       # Express route handlers for ingestion & configurations
│   │   ├── services/
│   │   │   └── scoringEngine.js # Config-driven formulaic score computer
│   │   ├── utils/
│   │   │   └── validation.js  # Payload validation & phone cleaners
│   │   ├── app.js             # Express app core setup (serves frontend statically)
│   │   └── server.js          # Dedicated production entry point
│   └── tests/
│       ├── api.test.js        # Automated API integration tests
│       └── load_test.js       # Node-native performance load-testing suite
├── frontend/
│   ├── index.html             # Dashboard control panel HTML
│   ├── style.css              # Premium dark theme glassmorphism styling
│   └── app.js                 # Front-end API calls & reactive UI widgets
├── .env                       # Local environment variables configuration
├── .env.example               # Template environment configuration
├── .gitignore                 # Files excluded from git
└── package.json               # Node dependency descriptor & script commands
```

---

## 2. Getting Started & Execution

### Prerequisites
- Node.js (version >= 22.0)
- NPM (version >= 10.0)

### Installation
Run the following command at the project root to install standard Express and Supabase client dependencies:
```bash
npm install
```

### Running in Offline Mode (Mock Database)
If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are omitted or commented out in your `.env` file, the server will automatically start in **Mock Mode**, using an in-memory SQL-like dataset seeded with standard defaults. 

Start the server in watch-mode:
```bash
npm run dev
```

Visit the frontend dashboard in your browser:
*   [http://localhost:3000](http://localhost:3000)

### Running with Live Supabase
1. Create a Supabase project at [Supabase](https://supabase.com).
2. Execute the database setup script located in [database/schema.sql](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/database/schema.sql) using the SQL Editor in Supabase.
3. Create a `.env` file in the project root and add your details:
   ```env
   PORT=3000
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
   ```
4. Start the server with `npm start`.

---

## 3. API Route Specifications

All API routes are prefixed with `/leads`.

### 3.1 Single Lead Ingestion
*   **Method:** `POST`
*   **Path:** `/leads/ingest`
*   **Payload Format (JSON):**
    ```json
    {
      "tenant_id": "default-tenant",
      "name": "Jane Doe",
      "phone": "+91 99999-88888",
      "email": "jane@example.com",
      "source": "referral",
      "raw_data": {
        "age": 28,
        "city": "Mumbai",
        "income": 600000,
        "pages_visited": 5,
        "video_watched": true
      }
    }
    ```
*   **Response Codes:**
    *   `201 Created`: Lead ingested and scored successfully. Returns saved lead details.
    *   `400 Bad Request`: Validation failure (missing required fields, malformed email, or invalid phone).
    *   `409 Conflict`: Lead phone number already exists under the same tenant.

### 3.2 Batch Lead Ingestion
*   **Method:** `POST`
*   **Path:** `/leads/batch`
*   **Payload Format (JSON):**
    ```json
    {
      "tenant_id": "default-tenant",
      "leads": [
        {
          "name": "User 1",
          "phone": "+917777777777",
          "source": "organic",
          "raw_data": { "age": 30, "city": "Pune" }
        },
        {
          "name": "User 2",
          "phone": "+918888888888",
          "source": "referral"
        }
      ]
    }
    ```
*   **Max Batch Size:** 500 leads.
*   **Response Format:**
    ```json
    {
      "success": true,
      "accepted": 2,
      "rejected": 0,
      "duplicates": 0,
      "details": [
        { "index": 0, "phone": "+917777777777", "status": "accepted", "lead_id": "..." },
        { "index": 1, "phone": "+918888888888", "status": "accepted", "lead_id": "..." }
      ]
    }
    ```

### 3.3 Dynamic Lead Rescoring
*   **Method:** `POST`
*   **Path:** `/leads/:id/rescore`
*   **Response Format:**
    ```json
    {
      "success": true,
      "lead_id": "uuid-string",
      "old_score": 65,
      "new_score": 82,
      "lead": { ... }
    }
    ```

### 3.4 Configuration Manager
*   **Get Weights:** `GET /leads/config?tenant_id=default-tenant`
*   **Save Weights:** `POST /leads/config`
    *   *Payload:*
        ```json
        {
          "tenant_id": "default-tenant",
          "weights": {
            "demographic_fit": 0.25,
            "source_quality": 0.25,
            "recency": 0.20,
            "behavioural_signals": 0.15,
            "prior_interaction": 0.15
          }
        }
        ```
    *   *Validation:* Server rejects weight adjustments with `400 Bad Request` if the sum of weights is not exactly `1.0 ± 0.001` or if any weight is negative.

---

## 4. Scoring Algorithm Details

The dynamic score of a lead (0-100) is calculated as:
$$\text{Score} = \sum (\text{Subscore}_i \times \text{Weight}_i)$$

Weights default to:
- `demographic_fit`: 0.25
- `source_quality`: 0.25
- `recency`: 0.20
- `behavioural_signals`: 0.15
- `prior_interaction`: 0.15

### Subscore Calculation Framework:
1.  **Demographic Fit (0-100)**: Evaluates age, city, and monthly income (each is scored out of 100 and averaged):
    - **Age**: 21-35 = 100; 18-20 or 36-45 = 70; else = 40.
    - **City**: Tier 1 (Mumbai, Delhi, Bangalore, etc.) = 100; Tier 2 = 70; other = 40.
    - **Income**: $\ge$ ₹500,000 = 100; $\ge$ ₹300,000 = 75; else = 45.
2.  **Source Quality (0-100)**:
    - `referral` = 100
    - `organic` = 85
    - `re-engagement` = 75
    - `paid_ads` = 60
    - default/other = 50
3.  **Recency (0-100)**: Calculates minutes since lead created/submitted:
    - $\le$ 15 minutes = 100
    - $\le$ 60 minutes = 85
    - $\le$ 24 hours = 60
    - else = 40
4.  **Behavioral Signals (0-100)**: Sums active points:
    - Pages visited: 10 points per page (capped at 50)
    - Video watched: 30 points
    - Course/Product viewed: 20 points
    - Baseline: 30 points (if no signals are present)
5.  **Prior Interaction Outcome (0-100)**:
    - `callback_requested` = 100
    - `interested` / `converted` = 95
    - `no_answer` / `not_reachable` = 30
    - `not_interested` = 10
    - default/new = 50

---

## 5. Test Suite Specifications

### Automated Integration Tests
Runs integration tests executing routing pipelines, payloads validation, duplicate conflicts, configurations, and rescoring inside a dynamic isolated test port:
```bash
npm run test
```

### Performance Load Benchmark
Generates parallel burst ingestion loads (100 parallel requests) to evaluate API latency and throughput, asserting p99 response speeds:
```bash
npm run perf
```
*(Offline Mock database mode easily achieves >250 requests/second with a p99 latency <150ms).*
