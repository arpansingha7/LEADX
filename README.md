# LEADX — AI-Powered Lead Qualification & Conversion Platform

LEADX is a standalone AI-powered lead qualification and conversion platform built on top of VOIZ, Predixion AI's voice agent infrastructure. While VOIZ handles all telephony, speech, and agent execution, LEADX owns the entire lead lifecycle: ingestion, scoring, retry scheduling, script mapping, objection handling, human handoff, and CRM synchronization.

This repository hosts the backend and frontend configurations built as part of the 8-week engineering handbook.

---

## 🚀 Module 1 (Week 1): Ingestion, Scoring Engine & Interactive Dashboard Mockup

We have successfully completed and validated **Module 1 (Week 1) — Lead Ingestion API + Scoring Engine v1** along with the **Comprehensive Premium LeadX Dashboard Control Center** on the `arpan/lead-ingestion-scoring` branch.

### Key Features Implemented:
1.  **Lead Ingestion REST API**:
    *   `POST /leads/ingest`: Validates, sanitizes, and normalizes incoming leads, computes dynamic scores, and inserts them. Exposes HTTP 409 Conflict for duplicate phone numbers under the same tenant.
    *   `POST /leads/batch`: Accepts up to 500 leads, parsing valid entries, duplicates, and malformed inputs in a single batch pass.
    *   `POST /leads/:id/rescore`: Triggers dynamic lead scoring calculations when weight configurations are modified.
2.  **Scoring Engine v1**:
    *   Dynamic formulaic calculator: Evaluates demographic fit, source quality, recency, behavioral signals (pages visited, video watch duration), and prior outcomes.
    *   Validates weights to ensure they sum to exactly `1.0 ± 0.001` and rejects negative values.
3.  **Hybrid Database Resilience**:
    *   Exposes a unified database adapter supporting live Supabase (PostgreSQL) and a fully seeded offline in-memory mock database fallback.
4.  **Premium Glassmorphic Multi-View Dashboard**:
    *   **Dashboard (Home)**: Features a live KPI performance strip (Total Calls, Connect Rate, Qualified Leads, Hot Leads, Active Agents), a 7-stage campaign funnel visualization, real-time activity feeds, and a Hot Leads intent section showing score indicators as SVG ring gauges.
    *   **Campaign Manager**: Separates Real-Time, Non-RT, and Scheduled campaign lists with progress trackers and rosters. Features interactive toggle panels for dialing rules, windows, and concurrency limits.
    *   **VOIZ Roster**: Roster cards with active state indicator headers (On Call, Idle, Offline), language configurations, today's call counts, and a side-by-side performance comparison comparison grid.
    *   **Lead Intelligence**: Unifies single lead ingestion, batch JSON uploads, and weights configuration sliders. Shows the Leads Feed table with masked phone numbers, intent scores, last active stamps, and quick actions.
    *   **Live Monitor**: Real-time monitor tracking active connections with animated audio waveforms, highlighting warm human handoffs (teal), and showing the FIFO priority queue table.
    *   **Client Dashboard**: A shareable co-branded report view for Muthoot Finance featuring KPI rollups, weekly WoW trend charts, platform SLA rates, and mock PDF report generation.
5.  **Interactive Outbound dialer Simulations**:
    *   *Call Now*: Simulates dialing lead, moving to Live Monitor, animating voice waves, updating timers, updating timeline logs, and auto-dispositioning.
    *   *Warm Handoff*: Routes high-priority leads from VOIZ agent directly to human specialists.
    *   *DNC Registry*: Instantly blocks numbers, warning user, purging lead rows, and logging blocks.

---

## 🛠️ Tech Stack Used

*   **API / Backend:** Node.js + Express (ESM)
*   **Database:** Supabase (PostgreSQL) / In-memory Fallback
*   **Testing:** Node.js Native Test Runner (`node:test`)
*   **Frontend Config UI:** HTML5 / CSS3 (Vanilla Glassmorphism UI)
*   **Normalizer:** UUID v4

---

## ⚡ Quick Start

### 1. Installation
Install dependencies:
```bash
npm install
```

### 2. Run Locally (Offline Mock DB Mode)
Start the server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Run Automated Tests
```bash
npm test
```
To run the performance stress-test benchmark:
```bash
npm run perf
```

For a comprehensive guide on database setup, API routes, scoring subscore details, a step-by-step Saturday mentor demo checklist, and business/technical interview Q&A prep sheets, see:
*   [LEADX Module 1 Technical Guide (docs/module1_documentation.md)](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/module1_documentation.md)
