import { Router } from 'express';
import db from '../config/db.js';

const router = Router();

const CLIENT_ID = process.env.HUBSPOT_CLIENT_ID;
const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET;
const REDIRECT_URI = process.env.HUBSPOT_REDIRECT_URI || 'http://localhost:3000/oauth/hubspot/callback';

/**
 * GET /oauth/hubspot/authorize
 * Redirects the user to HubSpot OAuth consent screen or a mock consent screen.
 */
router.get('/hubspot/authorize', (req, res) => {
  const { tenant_id } = req.query;
  if (!tenant_id) {
    return res.status(400).send('tenant_id parameter is required');
  }

  // If Client ID is set, use live HubSpot OAuth flow
  if (CLIENT_ID && CLIENT_ID !== 'mock-client-id') {
    const scope = 'contacts';
    const state = tenant_id;
    const authorizeUrl = `https://app.hubspot.com/oauth/authorize?client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}`;
    return res.redirect(authorizeUrl);
  }

  // Otherwise, render a beautiful Mock OAuth Consent Screen
  const mockConsentHtml = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>HubSpot Authorization Request</title>
      <style>
        :root {
          --lx-bg: #0b0f19;
          --lx-card: #151b2d;
          --lx-border: rgba(255, 255, 255, 0.08);
          --lx-text: #f3f4f6;
          --lx-muted: #9ca3af;
          --lx-orange: #ff7a59;
          --lx-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        body {
          margin: 0;
          padding: 0;
          background: var(--lx-bg);
          color: var(--lx-text);
          font-family: var(--lx-font);
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
        }
        .container {
          background: var(--lx-card);
          border: 1px solid var(--lx-border);
          border-radius: 12px;
          padding: 30px;
          width: 420px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
          text-align: center;
        }
        h2 {
          color: var(--lx-orange);
          margin-top: 0;
          font-size: 22px;
        }
        p {
          font-size: 13.5px;
          line-height: 1.5;
          color: var(--lx-muted);
          margin-bottom: 24px;
        }
        .permission-list {
          text-align: left;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--lx-border);
          border-radius: 6px;
          padding: 12px;
          margin-bottom: 24px;
        }
        .permission-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          margin-bottom: 8px;
        }
        .permission-item:last-child {
          margin-bottom: 0;
        }
        .btn-group {
          display: flex;
          gap: 12px;
        }
        .btn {
          flex: 1;
          padding: 10px 16px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 13.5px;
          cursor: pointer;
          border: 1px solid var(--lx-border);
          transition: all 0.2s ease;
        }
        .btn-cancel {
          background: transparent;
          color: var(--lx-text);
        }
        .btn-cancel:hover {
          background: rgba(255, 255, 255, 0.05);
        }
        .btn-approve {
          background: var(--lx-orange);
          color: white;
          border-color: var(--lx-orange);
        }
        .btn-approve:hover {
          background: #e56340;
          border-color: #e56340;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>LeadX Integration App</h2>
        <p>LeadX is requesting permission to connect to your HubSpot Account.</p>
        
        <div class="permission-list">
          <div class="permission-item">
            <span style="color: var(--lx-orange);">✓</span>
            <span>Read and write CRM Contacts</span>
          </div>
          <div class="permission-item">
            <span style="color: var(--lx-orange);">✓</span>
            <span>Read CRM Contact Properties</span>
          </div>
        </div>

        <div class="btn-group">
          <button class="btn btn-cancel" onclick="window.close()">Deny</button>
          <button class="btn btn-approve" onclick="approve()">Approve Connection</button>
        </div>
      </div>

      <script>
        function approve() {
          const callbackUrl = '${REDIRECT_URI}?code=mock-oauth-code-12345State&state=${tenant_id}';
          window.location.href = callbackUrl;
        }
      </script>
    </body>
    </html>
  `;
  res.send(mockConsentHtml);
});

/**
 * GET /oauth/hubspot/callback
 * Receives redirect code, exchanges it for tokens, saves them, and notifies parent dashboard.
 */
router.get('/hubspot/callback', async (req, res) => {
  const { code, state: tenantId } = req.query;

  if (!code) {
    return res.status(400).send('Authorization code is missing.');
  }

  const isMock = code.startsWith('mock-oauth-code-');
  let oauthResult;

  try {
    if (isMock) {
      oauthResult = {
        access_token: 'mock-oauth-access-token-' + Math.floor(Math.random() * 100000),
        refresh_token: 'mock-oauth-refresh-token-' + Math.floor(Math.random() * 100000),
        expires_in: 18000,
        expires_at: Date.now() + 18000 * 1000
      };
    } else {
      // Live exchange
      const response = await fetch('https://api.hubapi.com/oauth/v1/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          code
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Token exchange failed: ${response.statusText} - ${errText}`);
      }

      const data = await response.json();
      oauthResult = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        expires_at: Date.now() + data.expires_in * 1000
      };
    }

    // Save tokens inside database under tenant onboarding config JSONB
    const currentConfig = await db.getOnboardingConfig(tenantId || 'default-tenant');
    const updatedConfig = {
      ...currentConfig,
      hubspot_oauth: oauthResult
    };
    await db.upsertOnboardingConfig(tenantId || 'default-tenant', updatedConfig);

    // Log the event to audit log
    await db.insertAuditLog(tenantId || 'default-tenant', 'onboarding_config_updated', {
      message: 'HubSpot OAuth 2.0 connection successfully established.',
      oauth: {
        access_token_masked: oauthResult.access_token.substring(0, 15) + '...',
        expires_in: oauthResult.expires_in
      }
    });

    // Render beautiful success popup html to notify parent window
    const successHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Connection Successful</title>
        <style>
          body {
            background: #0b0f19;
            color: white;
            font-family: sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            text-align: center;
          }
          h2 { color: #2ecc71; }
          p { color: #9ca3af; }
        </style>
      </head>
      <body>
        <div>
          <h2>✓ Connection Successful</h2>
          <p>LeadX is now connected with your HubSpot account.</p>
          <p>This window will close automatically...</p>
        </div>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'hubspot-oauth-success' }, '*');
            setTimeout(() => {
              window.close();
            }, 1500);
          } else {
            document.body.innerHTML += '<p style="color:red">No opener window found.</p>';
          }
        </script>
      </body>
      </html>
    `;
    res.send(successHtml);
  } catch (error) {
    console.error('OAuth Callback Error:', error);
    res.status(500).send(`Authentication failed: ${error.message}`);
  }
});

export default router;
