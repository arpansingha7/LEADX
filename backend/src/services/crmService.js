import dotenv from 'dotenv';
import db from '../config/db.js';

dotenv.config();

const isTestRunnerActive = process.env.NODE_ENV === 'test' || process.argv.some(arg => arg.includes('test') || arg.includes('--test'));
const hubspotKey = isTestRunnerActive ? 'mock-hubspot-api-key' : process.env.HUBSPOT_API_KEY;
const leadSquaredKey = isTestRunnerActive ? 'mock-leadsquared-api-key' : process.env.LEADSQUARED_API_KEY;

async function refreshHubSpotToken(tenantId, refreshToken) {
  const CLIENT_ID = process.env.HUBSPOT_CLIENT_ID;
  const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET;

  if (!CLIENT_ID || !CLIENT_SECRET || refreshToken.startsWith('mock-oauth-')) {
    // Mock refresh
    const mockRefreshed = {
      access_token: 'mock-oauth-access-token-' + Math.floor(Math.random() * 100000),
      refresh_token: refreshToken,
      expires_in: 18000,
      expires_at: Date.now() + 18000 * 1000
    };
    const currentConfig = await db.getOnboardingConfig(tenantId);
    await db.upsertOnboardingConfig(tenantId, {
      ...currentConfig,
      hubspot_oauth: mockRefreshed
    });
    return mockRefreshed;
  }

  // Live refresh
  const response = await fetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.statusText}`);
  }

  const data = await response.json();
  const refreshed = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires_in: data.expires_in,
    expires_at: Date.now() + data.expires_in * 1000
  };

  const currentConfig = await db.getOnboardingConfig(tenantId);
  await db.upsertOnboardingConfig(tenantId, {
    ...currentConfig,
    hubspot_oauth: refreshed
  });

  return refreshed;
}

class HubSpotAdapter {
  async sync(lead) {
    // Check for token in DB
    const config = await db.getOnboardingConfig(lead.tenant_id);
    let accessToken = hubspotKey;
    let isMock = isTestRunnerActive;

    if (config && config.hubspot_oauth && config.hubspot_oauth.access_token) {
      accessToken = config.hubspot_oauth.access_token;
      // Refresh token if expired
      if (config.hubspot_oauth.expires_at && Date.now() > config.hubspot_oauth.expires_at) {
        try {
          const refreshed = await refreshHubSpotToken(lead.tenant_id, config.hubspot_oauth.refresh_token);
          accessToken = refreshed.access_token;
        } catch (err) {
          console.error('[OAuth] Token refresh failed:', err);
        }
      }
    } else if (config && config.hubspot_api_key) {
      accessToken = config.hubspot_api_key;
    }

    if (accessToken && accessToken !== 'mock-hubspot-api-key' && !accessToken.startsWith('mock-oauth-access-token-') && !isMock) {
      const response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          properties: {
            firstname: lead.name,
            phone: lead.phone,
            email: lead.email,
            leadx_score: String(lead.score),
            leadx_status: lead.status
          }
        })
      });
      if (!response.ok) {
        throw new Error(`HubSpot API responded with ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } else {
      console.log(`[CRM Integration Mock] HubSpot sync complete for contact: ${lead.name} (${lead.phone})`);
      return { id: 'mock-hs-id-' + Math.floor(Math.random() * 100000) };
    }
  }
}

class LeadSquaredAdapter {
  async sync(lead) {
    const config = await db.getOnboardingConfig(lead.tenant_id);
    const accessKey = (config && config.ls_access_key) ? config.ls_access_key : leadSquaredKey;

    if (accessKey && accessKey !== 'mock-leadsquared-api-key') {
      const response = await fetch('https://api.leadsquared.com/v1/LeadManagement.svc/Lead.Create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessKey}`
        },
        body: JSON.stringify([
          { Attribute: 'FirstName', Value: lead.name },
          { Attribute: 'Phone', Value: lead.phone },
          { Attribute: 'EmailAddress', Value: lead.email },
          { Attribute: 'mx_LeadX_Score', Value: String(lead.score) },
          { Attribute: 'mx_LeadX_Status', Value: lead.status }
        ])
      });
      if (!response.ok) {
        throw new Error(`LeadSquared API responded with ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } else {
      console.log(`[CRM Integration Mock] LeadSquared sync complete for lead: ${lead.name} (${lead.phone})`);
      return { id: 'mock-lq-id-' + Math.floor(Math.random() * 100000) };
    }
  }
}

/**
 * Synchronizes lead details and scores to the external CRM.
 * @param {string} tenantId The ID of the tenant.
 * @param {object} lead The lead record database object.
 * @param {string} provider The CRM provider ('hubspot' or 'leadsquared').
 */
export async function syncToCRM(tenantId, lead, provider) {
  const normalizedProvider = (provider || '').toLowerCase();
  
  let adapter;
  if (normalizedProvider === 'hubspot') {
    adapter = new HubSpotAdapter();
  } else if (normalizedProvider === 'leadsquared') {
    adapter = new LeadSquaredAdapter();
  } else {
    throw new Error(`Unsupported CRM provider: ${provider}`);
  }

  try {
    const result = await adapter.sync(lead);
    
    // Log in database audit log
    await db.insertAuditLog(tenantId, 'crm_sync_success', {
      lead_id: lead.id,
      phone: lead.phone,
      provider: normalizedProvider,
      result
    });

    return { success: true, provider: normalizedProvider, result };
  } catch (error) {
    console.error(`CRM Sync failed for ${provider}:`, error);

    await db.insertAuditLog(tenantId, 'crm_sync_failure', {
      lead_id: lead.id,
      phone: lead.phone,
      provider: normalizedProvider,
      error: error.message
    });

    throw error;
  }
}

export default {
  syncToCRM
};
