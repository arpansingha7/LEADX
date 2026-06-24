# LEADX Module 2 — Client Onboarding & Spreadsheet Mapper Educational Guide

Welcome, Intern / Junior Software Engineer! This guide explains the technical details and business value behind client onboarding setups, self-serve CSV spreadsheet parsing, and HubSpot OAuth integrations on the LEADX Platform.

---

## 1. The Business Purpose (Why we built this)

When a new business client (for example, *upGrad School of Technology*) joins LEADX to qualify their leads, they face two major friction points:
1.  **Non-Standard Lead Formats:** Every business stores lead spreadsheets differently. One client might name columns `First Name`, `Phone`, and `Monthly Income`. Another might name them `cust_name`, `mobile_no`, and `income_pm`.
    *   *Old Way:* An engineer has to write a custom script to parse every new client sheet. This is slow and doesn't scale.
    *   *LEADX Way:* We build a **Self-Serve Column Mapper** that lets clients upload their spreadsheet and map their custom headers to our database keys in 30 seconds.
2.  **CRM Disconnect:** Qualified leads must sync automatically with the client's internal sales system (CRM) like HubSpot.
    *   *Old Way:* Clients give us private API tokens. If the token expires or is stolen, it creates a massive security leak.
    *   *LEADX Way:* We implement **HubSpot OAuth 2.0**. Clients authorize connection with a single click, granting us temporary tokens that we rotate securely.

---

## 2. Technical Design & Logic (How it works)

### 💡 Concept 1: Browser-Side CSV Parsing
To keep our server fast, we offload CSV parsing to the user's web browser:
1.  The browser reads the uploaded CSV file.
2.  It extracts the first row containing the headers (e.g. `mobile_no`, `name_cust`).
3.  The frontend displays dropdowns mapping these client headers to our system keys (`phone`, `name`).
4.  Once mapped, the browser transforms the raw file rows into normalized JSON records and submits them to the backend `/leads/batch` endpoint.

### 💡 Concept 2: OAuth 2.0 Handshake & Server Refresh
To sync contacts securely to HubSpot without storing passwords, we use OAuth 2.0:
```
[Client Browser] ──► Redirects to HubSpot Login ──► Enters Credentials
      ▲                                                    │
      │                                                    ▼
   Gets Tokens ◄── Server exchanges Authorization Code ◄── Redirects back
```
1.  **Consent:** The user clicks "Connect HubSpot" and approves the integration.
2.  **Authorization Code Exchange:** HubSpot redirects back to our server callback with a temporary `code`. We swap this code for a short-lived `access_token` (expires in 30 minutes) and a long-lived `refresh_token` (persists indefinitely).
3.  **JSONB Storage:** We store these tokens in a Postgres JSONB field `hubspot_oauth` inside the `tenant_configs` table.
4.  **Automatic Token Refresh:** Before pushing data, our HubSpot adapter checks if the access token has expired. If it has, it automatically submits a background request to HubSpot to refresh the access token using the stored refresh token, saving the updated token in the database without disrupting the user.

---

## 3. Step-by-Step Junior Developer Implementation Guide

Check out these files to see the implementation:

1.  **OAuth Callback Endpoint:** [oauth.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/routes/oauth.js)
    *   Implements the exchange endpoint where HubSpot redirects users after approval.
2.  **HubSpot Adapter & Refresh Logic:** [crmService.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/services/crmService.js)
    *   Take a look at `refreshHubSpotToken` and how it handles token refreshing server-to-server.
3.  **Spreadsheet Ingestion Controller:** [app.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/frontend/app.js)
    *   Find the column mapping UI handlers that populate the CSV mapper dropdowns and build batch payloads.

---

## 4. Client & Business FAQ (Answer Client Questions)

### Q: "Is our CRM data secure? Do you store our passwords?"
*   **Answer:** No, we do not store your credentials. We use HubSpot OAuth 2.0. This grants us a restricted access token that you can revoke at any time from your HubSpot account settings.

### Q: "What happens if our sales team edits the spreadsheet columns?"
*   **Answer:** The self-serve mapper handles it. If your columns change, simply re-upload the spreadsheet, adjust the column dropdown matches, and finalize the ingestion.

### Q: "How does the system warn us if CRM sync fails?"
*   **Answer:** If the CRM API returns an error (e.g. invalid permissions or expired credentials), the event is logged in the `audit_trail` table, and an instant notification is sent to the configured Slack alert channel.

---

## 5. Manual Sandbox Verification Steps (How to use)

1.  Click the **Onboarding** tab in the sidebar.
2.  Select the **Scholarships** template and proceed.
3.  Click **Load Scholarships CSV Sample**. The system parses the headers and displays the column mapper dropdowns.
4.  Map the columns (e.g. `Client Name` to Name, `Mobile` to Phone) and click **Finalize & Ingest**.
5.  Go to the **CRM Sync** page. Click **Connect HubSpot CRM**.
6.  Click **Approve Connection** in the mock popup window. Notice the HubSpot node status updates to `CONNECTED`.
7.  Open the **Manual Sync** drawer at the bottom, select leads, and click **Bulk Sync** to push them to the mock HubSpot database. Check the CRM log below to confirm success.

---

## 🔗 Related Documentation & Navigation
*   To understand the core E.164 lead normalizer and lead scoring calculations, refer to the [Module 1 Ingestion & Scoring Engine Guide (docs/module1_documentation.md)](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/module1_documentation.md).
*   To learn how to manage and authenticate external systems (such as HubSpot OAuth or LeadSquared webhook integrations), refer to the [Module 4 CRM Connectors Guide (docs/module4_documentation.md)](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/module4_documentation.md) and the [CRM Sync Connector Setup Guide (docs/crm-connector-setup.md)](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/crm-connector-setup.md).
*   For a complete end-to-end platform usage walkthrough, refer to the [LEADX Platform User Guide (docs/platform-user-guide.md)](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/platform-user-guide.md).

