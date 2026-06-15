# LEADX Platform — CRM Connector Setup Guide

This document explains how to set up, authenticate, and configure the synchronization connectors for the three supported CRM platforms: **HubSpot**, **LeadSquared**, and **Salesforce**.

---

## 1. HubSpot Integration

LEADX supports both **OAuth 2.0 Flow** and **Private App Access Tokens** for HubSpot integration.

### Authentication Setup
1. **OAuth 2.0 Flow (Recommended):**
   - Click the **Connect HubSpot CRM** button in the CRM Sync control center.
   - You will be redirected to a mock consent screen (simulating HubSpot's consent screen).
   - Click "Approve Access". The portal exchanges the authorization code for an Access Token and saves it to the tenant onboarding configuration.
2. **Private App Access Token:**
   - In HubSpot, go to **Settings &rarr; Integrations &rarr; Private Apps**.
   - Create a new Private App with scopes: `crm.objects.contacts.read`, `crm.objects.contacts.write`.
   - Copy the Access Token and paste it into the **Private App Access Token** field in the LEADX CRM page.
   - Enter your **HubSpot Portal ID (Hub ID)**.

### Field Mappings
By default, the HubSpot connector maps the following fields:
- `FirstName` &rarr; Contact Name
- `Phone` &rarr; Mobile Phone Number
- `Email` &rarr; Email Address
- `mx_LeadX_Score` &rarr; Intent Score
- `mx_LeadX_Status` &rarr; Lead status (e.g. `called`, `dnc`, `hot_escalated`)

---

## 2. LeadSquared Integration

LEADX integrates with LeadSquared using API Access Keys and handles inbound webhook ingestion with HMAC-SHA256 signature verification.

### Authentication Setup
1. In LeadSquared, navigate to **Settings &rarr; API and Webhooks**.
2. Retrieve your **Access Key**, **Secret Key**, and **API Host Region** (e.g., `api-in21.leadsquared.com`).
3. Paste these keys into the LeadSquared integration card in the LEADX CRM configuration page.

### Inbound Ingestion Webhooks
To push leads dynamically from LeadSquared to LEADX:
1. In LeadSquared, go to **Settings &rarr; API and Webhooks &rarr; Webhooks**.
2. Create a new webhook pointing to your LEADX callback URL:
   `https://<your-leadx-domain>/leads/webhook/leadsquared?tenant_id=<your-tenant-id>`
3. Configure the webhook to trigger on **Lead Creation** or **Lead Field Update**.
4. LEADX will validate the inbound payload using the HMAC-SHA256 signature sent in the `x-ls-signature` header. If signature validation fails, LEADX logs a security alert on Slack and rejects the request with a `401 Unauthorized` status.

---

## 3. Salesforce Integration

The Salesforce connector synchronizes qualified contacts and creates completed Task actions for outbound call sessions.

### Authentication Setup
1. Log in to Salesforce Developer/Sandbox portal.
2. Create a new **Connected App**:
   - Go to **Setup &rarr; App Manager &rarr; New Connected App**.
   - Enable OAuth settings. Set Callback URL to: `https://<your-leadx-domain>/oauth/salesforce/callback`.
   - Add scopes: `Manage user data via APIs (api)`, `Perform requests at any time (refresh_token, offline_access)`.
3. Retrieve the **Consumer Key (Client ID)** and **Consumer Secret (Client Secret)**.
4. Input these credentials into the Salesforce card in LEADX. Select the **Salesforce Login URL** (Production or Sandbox).

### Call Activity Sync
When a call is finalized or escalated:
- LEADX uses the API token to check for an existing Contact by phone number.
- If not found, a new Contact is created.
- An **Activity Task** is created under that Contact containing details of the dial:
  - **Subject:** Outbound Dialer Call: [Disposition]
  - **Description:** Call duration: Xs. Summary: [AI Summary / Objections / Intent details]
  - **Status:** Completed

---

## 4. Troubleshooting and Connection Verification

Use the **Test Connection** button on any of the CRM cards to execute a mock API handshake.
- A connection verification event will be pushed to the **CRM Lead Sync Console & Audit Logs** table at the bottom of the CRM Sync page.
- Success log entry: `CRM Sync: Successfully synced contact with HubSpot (External ID: mock-123)`
- Failure log entry: `CRM Sync Error: Failed to sync contact to LeadSquared (Error: HMAC signature validation failed)`
