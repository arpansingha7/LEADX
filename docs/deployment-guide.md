# LEADX Platform — Deployment Guide

This guide provides step-by-step instructions for deploying the LEADX platform to Azure, including setting up Azure App Services, configuring the production Supabase project, and configuring continuous deployment.

---

## 1. Production Architecture Overview

The production architecture for LEADX consists of:
1. **Frontend & Backend Orchestrator:** Deployed as a single Node.js application container on **Azure App Service** (Linux runtime).
2. **Database Layer:** A hosted **Supabase** instance providing Postgres, realtime subscriptions, and connection pooling.
3. **External Integrations:**
   - **VOIZ Dialer WebSocket/REST API:** Configured via webhook callback endpoints.
   - **CRM APIs:** Secure REST sync pipelines to LeadSquared, Salesforce, and HubSpot.

---

## 2. Environment Variables & Secret Management

Create a production `.env` file or configure these keys in the **Azure App Service Configuration Settings**:

| Variable Name | Description | Example / Recommended Value |
|---|---|---|
| `PORT` | Running port for the Node process | `8080` (Azure App Service defaults to routing to this port) |
| `NODE_ENV` | Running mode | `production` |
| `SUPABASE_URL` | Endpoint of production Supabase instance | `https://xxxx.supabase.co` |
| `SUPABASE_KEY` | Supabase service_role key (bypasses RLS) | `eyJhbGciOiJIUzI1NiIsInR5c...` |
| `SLACK_WEBHOOK_URL` | Slack channel incoming webhook url | `https://hooks.slack.com/services/...` |
| `LEADSQUARED_ACCESS_KEY` | Global fallback LSQ Access key | `uqk839284293849...` |
| `LEADSQUARED_SECRET_KEY` | Global fallback LSQ Secret key for HMAC | `8f828a1c9b32c...` |
| `SALESFORCE_CLIENT_ID` | Salesforce OAuth application consumer key | `3MVG9...` |
| `SALESFORCE_CLIENT_SECRET` | Salesforce OAuth consumer secret | `842938...` |

---

## 3. Step-by-Step Azure Deployment Workflow

### Step 3.1: Create Azure Resources
You can use the Azure Portal or Azure CLI. Using the Azure CLI:

```bash
# 1. Login to Azure
az login

# 2. Create a Resource Group
az group create --name leadx-prod-rg --location eastus

# 3. Create an App Service Plan (B1 basic plan for production testing)
az appservice plan create --name leadx-plan --resource-group leadx-prod-rg --sku B1 --is-linux

# 4. Create the Web App
az webapp create --name leadx-orchestrator --resource-group leadx-prod-rg --plan leadx-plan --runtime "NODE:20-lts"
```

### Step 3.2: Configure Web App Settings
Set the environment variables in Azure:

```bash
az webapp config appsettings set --name leadx-orchestrator --resource-group leadx-prod-rg --settings \
  PORT=8080 \
  NODE_ENV=production \
  SUPABASE_URL="https://xxxx.supabase.co" \
  SUPABASE_KEY="service_role_key_here" \
  SLACK_WEBHOOK_URL="slack_webhook_here"
```

### Step 3.3: Set Up Continuous Deployment (GitHub Actions)
Configure your repository for GitHub Actions:
1. Navigate to the Azure Portal &rarr; **leadx-orchestrator** App Service.
2. Under **Deployment Center**, select **GitHub** as the source.
3. Authenticate with your GitHub account, select your repository, and choose the `main` branch.
4. Azure will automatically commit a workflow file (e.g., `.github/workflows/main_leadx-orchestrator.yml`) to your repository.

The workflow file looks like this:
```yaml
name: Build and deploy Node.js app to Azure Web App - leadx-orchestrator

on:
  push:
    branches:
      - main
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js version
        uses: actions/setup-node@v4
        with:
          node-version: '20.x'
          cache: 'npm'

      - name: Install dependencies, build, and test
        run: |
          npm ci
          npm run test --if-present

      - name: Zip artifact for deployment
        run: zip release.zip ./* -r

      - name: Upload artifact for deployment job
        uses: actions/upload-artifact@v4
        with:
          name: node-app
          path: release.zip

  deploy:
    runs-on: ubuntu-latest
    needs: build
    environment:
      name: 'Production'
      url: ${{ steps.deploy-to-webapp.outputs.webapp-url }}

    steps:
      - name: Download artifact from build job
        uses: actions/download-artifact@v4
        with:
          name: node-app

      - name: Unzip artifact
        run: unzip release.zip

      - name: 'Deploy to Azure Web App'
        id: deploy-to-webapp
        uses: azure/webapps-deploy@v3
        with:
          app-name: 'leadx-orchestrator'
          slot-name: 'Production'
          publish-profile: ${{ secrets.AZUREAPPSERVICE_PUBLISHPROFILE_XXXX }}
          package: .
```

---

## 4. Production Database setup

1. Run the database initialization script `database/schema.sql` inside the Supabase SQL Editor to prepare all tables and constraints.
2. In production, ensure Postgres connection pooler (`pgbouncer` port 6543) is used instead of direct connection (port 5432) to avoid running out of active connections under concurrent webhooks load.
3. Keep Row-Level Security (RLS) disabled initially or configure appropriate SELECT/INSERT policy rules for the backend server role:
   ```sql
   CREATE POLICY "Allow service_role access only" ON leads FOR ALL USING (auth.role() = 'service_role');
   ```

---

## 5. Verification & Health Monitoring

Once deployment is complete, verify the application health by hitting the following URL:
`https://leadx-orchestrator.azurewebsites.net/leads/queue-status?tenant_id=default-tenant`

Expected Response:
```json
{
  "success": true,
  "stats": {
    "queued": 0,
    "calling": 0,
    "re_queued": 0,
    "dnc": 0
  }
}
```

Use the **Azure Log Stream** or `az webapp log tail --name leadx-orchestrator --resource-group leadx-prod-rg` to monitor live application server stdout logs.
