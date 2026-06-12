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

    const hasRealApiKey = config && config.hubspot_api_key && !config.hubspot_api_key.startsWith('mock-');
    const hasMockOAuth = config && config.hubspot_oauth && config.hubspot_oauth.access_token && config.hubspot_oauth.access_token.startsWith('mock-oauth-access-token-');

    if (config && config.hubspot_oauth && config.hubspot_oauth.access_token && !(hasMockOAuth && hasRealApiKey)) {
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

    if ((!accessToken || accessToken.startsWith('mock-')) && hubspotKey && !hubspotKey.startsWith('mock-') && !isMock) {
      accessToken = hubspotKey;
    }

    if (accessToken && accessToken !== 'mock-hubspot-api-key' && !accessToken.startsWith('mock-oauth-access-token-') && !isMock) {
      let contactId = lead.raw_data?.hubspot_id;

      // 1. If we don't have hubspot_id, try finding the contact by email
      if (!contactId && lead.email) {
        try {
          const searchRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(lead.email)}?idProperty=email`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          });
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            if (searchData.id) {
              contactId = searchData.id;
            }
          }
        } catch (err) {
          console.error('[HubSpot] Search by email failed:', err);
        }
      }

      // 2. If we still don't have contactId, try search by phone
      if (!contactId && lead.phone) {
        try {
          const searchRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({
              filterGroups: [
                {
                  filters: [
                    {
                      propertyName: 'phone',
                      operator: 'EQ',
                      value: lead.phone
                    }
                  ]
                }
              ]
            })
          });
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            if (searchData.results && searchData.results.length > 0) {
              contactId = searchData.results[0].id;
            }
          }
        } catch (err) {
          console.error('[HubSpot] Search by phone failed:', err);
        }
      }

      let response;
      if (contactId) {
        // Update existing contact
        response = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
          method: 'PATCH',
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
      } else {
        // Create new contact
        response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
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
      }

      if (!response.ok) {
        throw new Error(`HubSpot API responded with ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } else {
      console.log(`[CRM Integration Mock] HubSpot sync complete for contact: ${lead.name} (${lead.phone})`);
      return { id: lead.raw_data?.hubspot_id || 'mock-hs-id-' + Math.floor(Math.random() * 100000) };
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

export async function getCRMLists(tenantId, provider) {
  const normalizedProvider = (provider || '').toLowerCase();
  
  if (normalizedProvider === 'hubspot') {
    const config = await db.getOnboardingConfig(tenantId);
    let accessToken = hubspotKey;
    let isMock = isTestRunnerActive;

    const hasRealApiKey = config && config.hubspot_api_key && !config.hubspot_api_key.startsWith('mock-');
    const hasMockOAuth = config && config.hubspot_oauth && config.hubspot_oauth.access_token && config.hubspot_oauth.access_token.startsWith('mock-oauth-access-token-');

    if (config && config.hubspot_oauth && config.hubspot_oauth.access_token && !(hasMockOAuth && hasRealApiKey)) {
      accessToken = config.hubspot_oauth.access_token;
      if (config.hubspot_oauth.expires_at && Date.now() > config.hubspot_oauth.expires_at) {
        try {
          const refreshed = await refreshHubSpotToken(tenantId, config.hubspot_oauth.refresh_token);
          accessToken = refreshed.access_token;
        } catch (err) {
          console.error('[OAuth] Token refresh failed for lists:', err);
        }
      }
    } else if (config && config.hubspot_api_key) {
      accessToken = config.hubspot_api_key;
    }

    if ((!accessToken || accessToken.startsWith('mock-')) && hubspotKey && !hubspotKey.startsWith('mock-') && !isMock) {
      accessToken = hubspotKey;
    }

    if (accessToken && accessToken !== 'mock-hubspot-api-key' && !accessToken.startsWith('mock-oauth-access-token-') && !isMock) {
      const response = await fetch('https://api.hubapi.com/contacts/v1/lists', {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      if (!response.ok) {
        throw new Error(`HubSpot API responded with ${response.status} when fetching lists.`);
      }
      const data = await response.json();
      return (data.lists || []).map(l => ({
        id: String(l.listId),
        name: l.name,
        count: l.metaData ? l.metaData.size : 0
      }));
    } else {
      return [
        { id: "all-contacts", name: "Muthoot Inbound Leads Q3", count: 150 },
        { id: "hot-leads", name: "High Intent Callbacks", count: 45 },
        { id: "website-enquiries", name: "Website Enquiries", count: 85 }
      ];
    }
  } else if (normalizedProvider === 'leadsquared') {
    return [
      { id: "ls-all", name: "All LeadSquared Leads", count: 200 },
      { id: "ls-hot", name: "LeadSquared High Intent", count: 60 }
    ];
  } else {
    throw new Error(`Unsupported CRM provider: ${provider}`);
  }
}

export async function getCRMContactsFromList(tenantId, provider, listId) {
  const normalizedProvider = (provider || '').toLowerCase();

  if (normalizedProvider === 'hubspot') {
    const config = await db.getOnboardingConfig(tenantId);
    let accessToken = hubspotKey;
    let isMock = isTestRunnerActive;

    const hasRealApiKey = config && config.hubspot_api_key && !config.hubspot_api_key.startsWith('mock-');
    const hasMockOAuth = config && config.hubspot_oauth && config.hubspot_oauth.access_token && config.hubspot_oauth.access_token.startsWith('mock-oauth-access-token-');

    if (config && config.hubspot_oauth && config.hubspot_oauth.access_token && !(hasMockOAuth && hasRealApiKey)) {
      accessToken = config.hubspot_oauth.access_token;
      if (config.hubspot_oauth.expires_at && Date.now() > config.hubspot_oauth.expires_at) {
        try {
          const refreshed = await refreshHubSpotToken(tenantId, config.hubspot_oauth.refresh_token);
          accessToken = refreshed.access_token;
        } catch (err) {
          console.error('[OAuth] Token refresh failed for contacts:', err);
        }
      }
    } else if (config && config.hubspot_api_key) {
      accessToken = config.hubspot_api_key;
    }

    if ((!accessToken || accessToken.startsWith('mock-')) && hubspotKey && !hubspotKey.startsWith('mock-') && !isMock) {
      accessToken = hubspotKey;
    }

    if (accessToken && accessToken !== 'mock-hubspot-api-key' && !accessToken.startsWith('mock-oauth-access-token-') && !isMock) {
      let propertyParams = '';
      try {
        const propsResponse = await fetch('https://api.hubapi.com/crm/v3/properties/contacts', {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        });
        if (propsResponse.ok) {
          const propsData = await propsResponse.json();
          const priority = ['firstname', 'lastname', 'email', 'phone', 'mobilephone', 'company', 'address', 'city', 'state', 'zip', 'country'];
          const custom = (propsData.results || [])
            .filter(p => p.hubspotDefined !== true && p.hubspotDefined !== 'true')
            .map(p => p.name);
          const usefulStandard = (propsData.results || [])
            .filter(p => (p.hubspotDefined === true || p.hubspotDefined === 'true') && !p.name.startsWith('hs_') && !priority.includes(p.name))
            .map(p => p.name);

          const toFetch = priority.concat(custom).concat(usefulStandard).slice(0, 150);
          propertyParams = toFetch.map(n => `&property=${encodeURIComponent(n)}`).join('');
        }
      } catch (propsErr) {
        console.error('[HubSpot] Failed to fetch properties metadata:', propsErr);
      }

      if (!propertyParams) {
        propertyParams = '&property=firstname&property=lastname&property=email&property=phone&property=mobilephone&property=company';
      }

      const response = await fetch(`https://api.hubapi.com/contacts/v1/lists/${listId}/contacts/all?count=100${propertyParams}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      if (!response.ok) {
        throw new Error(`HubSpot API responded with ${response.status} when fetching list contacts.`);
      }
      const data = await response.json();
      return (data.contacts || []).map(c => {
        const props = c.properties || {};
        const flat = {};
        Object.keys(props).forEach(k => {
          flat[k] = props[k]?.value || '';
        });
        if (flat.firstname || flat.lastname) {
          flat["Customer Name"] = `${flat.firstname || ''} ${flat.lastname || ''}`.trim();
        }
        if (flat.phone) {
          flat["Contact Phone"] = flat.phone;
        }
        if (flat.email) {
          flat["Email Address"] = flat.email;
        }
        flat.hubspot_id = String(c.vid || c.id || '');
        return flat;
      });
    } else {
      return [
        { "Customer Name": "Vikram Seth", "Contact Phone": "+919934311029", "Email Address": "vikram.seth@outlook.com", "Age": "34", "Monthly Income": "62000", "City": "Delhi", "hubspot_id": "mock-hs-id-10001" },
        { "Customer Name": "Preeti Sen", "Contact Phone": "+918822399120", "Email Address": "preeti.sen@gmail.com", "Age": "28", "Monthly Income": "45000", "City": "Kolkata", "hubspot_id": "mock-hs-id-10002" },
        { "Customer Name": "Anand Rao", "Contact Phone": "+917766022199", "Email Address": "anand.rao@yahoo.com", "Age": "41", "Monthly Income": "89000", "City": "Chennai", "hubspot_id": "mock-hs-id-10003" },
        { "Customer Name": "Sunita Das", "Contact Phone": "+919830111222", "Email Address": "sunita.das@zoho.com", "Age": "31", "Monthly Income": "55000", "City": "Bangalore", "hubspot_id": "mock-hs-id-10004" },
        { "Customer Name": "Rajesh Nair", "Contact Phone": "+919908123456", "Email Address": "rajesh.nair@gmail.com", "Age": "39", "Monthly Income": "71000", "City": "Mumbai", "hubspot_id": "mock-hs-id-10005" }
      ];
    }
  } else if (normalizedProvider === 'leadsquared') {
    return [
      { "Customer Name": "Vikram Seth", "Contact Phone": "+919934311029", "Email Address": "vikram.seth@outlook.com", "Age": "34", "Monthly Income": "62000", "City": "Delhi" },
      { "Customer Name": "Preeti Sen", "Contact Phone": "+918822399120", "Email Address": "preeti.sen@gmail.com", "Age": "28", "Monthly Income": "45000", "City": "Kolkata" }
    ];
  } else {
    throw new Error(`Unsupported CRM provider: ${provider}`);
  }
}

export default {
  syncToCRM,
  getCRMLists,
  getCRMContactsFromList
};
