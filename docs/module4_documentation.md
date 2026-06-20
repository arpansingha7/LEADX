# LEADX Module 4 — CRM Connectors & Webhooks Educational Guide

Welcome, Intern / Junior Software Engineer! This guide explains the technical details and business value behind unified CRM integration adapters, the Adapter Pattern, Salesforce OAuth credentials, and HMAC webhook signature validations on the LEADX Platform.

---

## 1. The Business Purpose (Why we built this)

Once our voice agents complete a call, they capture valuable information (e.g. *customer is interested, budget is 50 Lacs, scheduled follow-up*). 
To make this information useful, we must sync it back to the client's internal sales platform (CRM) immediately:
1.  **Multiple CRM Integration Support:** Different clients use different CRMs. *upGrad School of Technology* might use Salesforce, while another client uses HubSpot or LeadSquared.
    *   *Our Solution:* We build a unified interface using the **Adapter Pattern** so our core application can interact with any CRM in the exact same way.
2.  **Real-Time Lead Ingestion (Webhooks):** Instead of clients manually uploading CSV files every morning, they want leads to flow into LEADX instantly as soon as a customer registers on their website.
    *   *Our Solution:* We build a webhook receiver endpoint that accepts lead payloads in real time.
3.  **Security & API Spam Protection:** Since webhooks are public endpoints, anyone could discover the URL and spam it with fake leads.
    *   *Our Solution:* We enforce **HMAC signature validation** using a shared secret key. If a request is modified or fake, it is rejected before processing.

---

## 2. Technical Design & Logic (How it works)

### 💡 Concept 1: The Adapter Design Pattern
If we write custom code for HubSpot, Salesforce, and LeadSquared directly in our routes, the codebase becomes bloated and difficult to maintain. 
Instead, we define a standard interface:
*   `readLeads()`
*   `writeActivity()`
*   `updateLeadStatus()`

Each CRM provider has its own adapter class implementing these methods. The main application imports `getCRMConnector(provider)` and calls these methods without needing to know *how* each CRM handles its APIs.

### 💡 Concept 2: HMAC Webhook Signature Validation
To verify that inbound webhooks actually originate from LeadSquared and not a hacker, we use Hash-based Message Authentication Codes (HMAC) with SHA-256:
```
[Client Webhook Request] ──► Passes Body + Signature Header
                                    │
                         Server computes HMAC (Body, SecretKey)
                                    │
                         Matches computed vs signature header?
                                    ├──► YES: Ingest lead (201)
                                    └──► NO: Reject request (401)
```
1.  Both LeadSquared and LEADX share a secret key.
2.  When LeadSquared sends a payload, it hashes the JSON body using the secret key and attaches the result in the headers as `x-ls-signature`.
3.  LEADX receives the request, computes the hash of the body using the same secret key, and compares the hashes. If they match, we process the request.

### 💡 Concept 3: Salesforce OAuth Client Credentials Flow
For enterprise security, Salesforce uses the **Client Credentials Grant Type** flow:
1.  The adapter makes a POST request to Salesforce (`https://login.salesforce.com/services/oauth2/token`) containing the `client_id` (Consumer Key) and `client_secret` (Consumer Secret).
2.  Salesforce validates the credentials and returns a temporary `access_token` and `instance_url`.
3.  The adapter attaches this access token in the headers of all subsequent API calls.

---

## 3. Step-by-Step Junior Developer Implementation Guide

Check out these files to see the implementation:

1.  **Unified Adapters:** [crmService.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/services/crmService.js)
    *   Defines `HubSpotAdapter`, `LeadSquaredAdapter`, `SalesforceAdapter`, and the `getCRMConnector()` factory.
2.  **Webhook Ingestion Endpoint:** [leads.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/backend/src/routes/leads.js)
    *   Read the endpoint `/webhook/leadsquared` to see the crypto-hash matching and rate-limiting exception handlers.
3.  **CRM Cards UI:** [index.html](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/frontend/index.html) and [app.js](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/frontend/app.js)
    *   Implements the 3-column configuration forms, toggle enablers, and test connection action listeners.

---

## 4. Client & Business FAQ (Answer Client Questions)

### Q: "How do we know if our Salesforce credentials expire?"
*   **Answer:** If the credentials expire, Salesforce returns a `401 Unauthorized` response. The adapter catches this exception, logs a credential failure event in the database, and dispatches a Slack alert warning administrators to refresh their keys.

### Q: "Can we sync custom call summaries to our CRM tasks?"
*   **Answer:** Yes! The adapters write task logs (e.g. Salesforce `Task` object) containing the call duration, agent summaries, and final outcome status.

---

## 5. Manual Sandbox Verification Steps (How to use)

1.  Open the **CRM Sync** control panel.
2.  Observe the 3-column grid containing **HubSpot**, **LeadSquared**, and **Salesforce** panels.
3.  Toggle the Salesforce enabler. Enter credentials (or leave the default mock credentials) and click **Test Connection**. Verify the status updates to `CONNECTED`.
4.  Run the test suite to verify signature validation:
    ```powershell
    npm test
    ```
    Confirm that the tests `Valid HMAC signature` and `Invalid HMAC signature` pass successfully, demonstrating that unauthorized webhook payloads are rejected.

---

## 🔗 Related Documentation & Navigation
*   To learn how to configure client onboarding configurations and map column mappings, refer to the [Module 2 Onboarding & Column Mapper Guide (docs/module2_documentation.md)](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/module2_documentation.md).
*   For the technical setup parameters, redirect URLs, and webhooks configuration keys, check the [CRM Sync Connector Setup Guide (docs/crm-connector-setup.md)](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/crm-connector-setup.md).
*   For a complete end-to-end platform usage walkthrough, refer to the [LEADX Platform User Guide (docs/platform-user-guide.md)](file:///c:/Users/arpan/OneDrive/Desktop/LEADX/docs/platform-user-guide.md).

