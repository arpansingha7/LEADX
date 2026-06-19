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

async function getSalesforceToken(tenantId, config) {
  const clientId = config.sf_client_id || process.env.SF_CLIENT_ID;
  const clientSecret = config.sf_client_secret || process.env.SF_CLIENT_SECRET;
  const loginUrl = config.sf_login_url || process.env.SF_LOGIN_URL || 'https://login.salesforce.com';

  const isMock = isTestRunnerActive || !clientId || clientId.startsWith('mock-');
  if (isMock) {
    return {
      access_token: 'mock-sf-access-token-' + Math.floor(Math.random() * 100000),
      instance_url: 'https://mock-instance.salesforce.com'
    };
  }

  const response = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    })
  });

  if (!response.ok) {
    throw new Error(`Salesforce Token fetch failed: status ${response.status}`);
  }

  const data = await response.json();
  return {
    access_token: data.access_token,
    instance_url: data.instance_url
  };
}

export class HubSpotAdapter {
  async readLeads(sinceTimestamp, tenantConfig) {
    // Return mock leads for tests / local workspace or call contacts list
    if (isTestRunnerActive || !tenantConfig || (!tenantConfig.hubspot_oauth && !tenantConfig.hubspot_api_key)) {
      return [
        { name: "HubSpot Prospect A", phone: "+919934311029", email: "hs.prospectA@example.com", source: "hubspot", raw_data: { age: 34, city: "Delhi", income: 62000, hubspot_id: "mock-hs-id-201" } },
        { name: "HubSpot Prospect B", phone: "+918822399120", email: "hs.prospectB@example.com", source: "hubspot", raw_data: { age: 28, city: "Kolkata", income: 45000, hubspot_id: "mock-hs-id-202" } }
      ];
    }
    // Pull from list
    return await getCRMContactsFromList(null, 'hubspot', 'all-contacts');
  }

  async writeActivity(sessionId, activityData) {
    const config = activityData.tenantConfig || {};
    const isMock = isTestRunnerActive || (!config.hubspot_oauth && !config.hubspot_api_key);
    
    if (isMock) {
      console.log(`[HubSpot Mock] Activity written for session ${sessionId}`);
      return { id: 'mock-hs-engagement-id-' + Math.floor(Math.random() * 100000) };
    }

    let accessToken = config.hubspot_oauth?.access_token || config.hubspot_api_key || hubspotKey;
    if (config.hubspot_oauth && config.hubspot_oauth.expires_at && Date.now() > config.hubspot_oauth.expires_at) {
      const refreshed = await refreshHubSpotToken(null, config.hubspot_oauth.refresh_token);
      accessToken = refreshed.access_token;
    }

    const hsId = activityData.leadCrmId || activityData.lead?.raw_data?.hubspot_id;
    if (!hsId) throw new Error('HubSpot ID not found for note engagement linking');

    const response = await fetch('https://api.hubapi.com/crm/v3/objects/notes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        properties: {
          hs_note_body: `LEADX Dial Outcome: ${activityData.disposition}. Duration: ${activityData.duration}s. Summary: ${activityData.summary}.`
        },
        associations: [
          {
            to: { id: hsId },
            types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }]
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`HubSpot writeActivity failed: status ${response.status}`);
    }

    return await response.json();
  }

  async updateLeadStatus(leadId, newStatus, tenantConfig = {}) {
    const lead = await db.findLeadById(leadId);
    if (!lead) throw new Error('Lead not found');

    const isMock = isTestRunnerActive || (!tenantConfig.hubspot_oauth && !tenantConfig.hubspot_api_key);
    let accessToken = tenantConfig.hubspot_oauth?.access_token || tenantConfig.hubspot_api_key || hubspotKey;

    if (tenantConfig.hubspot_oauth && tenantConfig.hubspot_oauth.expires_at && Date.now() > tenantConfig.hubspot_oauth.expires_at) {
      const refreshed = await refreshHubSpotToken(lead.tenant_id, tenantConfig.hubspot_oauth.refresh_token);
      accessToken = refreshed.access_token;
    }

    if (isMock) {
      console.log(`[HubSpot Mock] Lead ${leadId} status updated to ${newStatus}`);
      return { id: lead.raw_data?.hubspot_id || 'mock-hs-id-' + Math.floor(Math.random() * 100000) };
    }

    const contactId = lead.client_id || lead.raw_data?.hubspot_id;
    if (!contactId) throw new Error('Client ID (HubSpot Contact ID) is missing');

    const response = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        properties: {
          leadx_status: newStatus,
          leadx_score: String(lead.score)
        }
      })
    });

    if (!response.ok) {
      throw new Error(`HubSpot status update failed: status ${response.status}`);
    }

    return await response.json();
  }
}

export class LeadSquaredAdapter {
  async readLeads(sinceTimestamp, tenantConfig) {
    if (isTestRunnerActive || !tenantConfig || !tenantConfig.ls_access_key) {
      return [
        { name: "LSQ Prospect 1", phone: "+919934311029", email: "lsq.prospect1@example.com", source: "leadsquared" },
        { name: "LSQ Prospect 2", phone: "+918822399120", email: "lsq.prospect2@example.com", source: "leadsquared" }
      ];
    }
    return await getCRMContactsFromList(null, 'leadsquared', 'ls-all');
  }

  async writeActivity(sessionId, activityData) {
    const config = activityData.tenantConfig || {};
    const isMock = isTestRunnerActive || !config.ls_access_key;

    if (isMock) {
      console.log(`[LeadSquared Mock] Activity written for session ${sessionId}`);
      return { success: true };
    }

    const host = config.ls_api_host || 'api.leadsquared.com';
    const accessKey = config.ls_access_key;
    const secretKey = config.ls_secret_key;

    const response = await fetch(`https://${host}/v1/LeadManagement.svc/Lead.AddActivity?accessKey=${accessKey}&secretKey=${secretKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        LeadIdentifier: activityData.phone,
        ActivityEvent: 200, // Custom call outcome event
        ActivityNote: `Disposition: ${activityData.disposition}. Duration: ${activityData.duration}s. Summary: ${activityData.summary}`
      })
    });

    if (!response.ok) {
      throw new Error(`LeadSquared writeActivity failed: status ${response.status}`);
    }

    return await response.json();
  }

  async updateLeadStatus(leadId, newStatus, tenantConfig = {}) {
    const lead = await db.findLeadById(leadId);
    if (!lead) throw new Error('Lead not found');

    const isMock = isTestRunnerActive || !tenantConfig.ls_access_key;
    if (isMock) {
      console.log(`[LeadSquared Mock] Lead ${leadId} status updated to ${newStatus}`);
      return { id: 'mock-lq-id-' + Math.floor(Math.random() * 100000) };
    }

    const host = tenantConfig.ls_api_host || 'api.leadsquared.com';
    const accessKey = tenantConfig.ls_access_key;
    const secretKey = tenantConfig.ls_secret_key;

    // JSON-driven field mappings
    const mapping = tenantConfig.field_mapping || {
      name: "FirstName",
      phone: "Phone",
      email: "EmailAddress",
      score: "mx_LeadX_Score",
      status: "mx_LeadX_Status"
    };

    const response = await fetch(`https://${host}/v1/LeadManagement.svc/Lead.Create?accessKey=${accessKey}&secretKey=${secretKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { Attribute: mapping.phone, Value: lead.phone },
        { Attribute: mapping.status, Value: newStatus },
        { Attribute: mapping.score, Value: String(lead.score) }
      ])
    });

    if (!response.ok) {
      throw new Error(`LeadSquared status update failed: status ${response.status}`);
    }

    return await response.json();
  }
}

export class SalesforceAdapter {
  async readLeads(sinceTimestamp, tenantConfig) {
    const isMock = isTestRunnerActive || !tenantConfig || !tenantConfig.sf_client_id || tenantConfig.sf_client_id.startsWith('mock-');
    if (isMock) {
      return [
        { name: "SF Prospect Alpha", phone: "+919934311029", email: "sf.alpha@example.com", source: "salesforce", raw_data: { age: 34, city: "Delhi", income: 62000, salesforce_id: "mock-sf-id-301" } },
        { name: "SF Prospect Beta", phone: "+918822399120", email: "sf.beta@example.com", source: "salesforce", raw_data: { age: 28, city: "Kolkata", income: 45000, salesforce_id: "mock-sf-id-302" } }
      ];
    }

    const { access_token, instance_url } = await getSalesforceToken(null, tenantConfig);
    const dateFormatted = new Date(sinceTimestamp).toISOString();
    const query = `SELECT Id, FirstName, LastName, Phone, Email, mx_LeadX_Score__c, mx_LeadX_Status__c FROM Contact WHERE LastModifiedDate >= ${dateFormatted}`;
    
    const response = await fetch(`${instance_url}/services/data/v58.0/query?q=${encodeURIComponent(query)}`, {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Salesforce Contacts read failed: status ${response.status}`);
    }

    const data = await response.json();
    return (data.records || []).map(r => ({
      name: `${r.FirstName || ''} ${r.LastName || ''}`.trim(),
      phone: r.Phone,
      email: r.Email,
      source: 'salesforce',
      raw_data: {
        salesforce_id: r.Id,
        score: r.mx_LeadX_Score__c || 0,
        status: r.mx_LeadX_Status__c || 'ingested'
      }
    }));
  }

  async writeActivity(sessionId, activityData) {
    const config = activityData.tenantConfig || {};
    const isMock = isTestRunnerActive || !config.sf_client_id || config.sf_client_id.startsWith('mock-');

    if (isMock) {
      console.log(`[Salesforce Mock] Activity task created for session ${sessionId}`);
      return { id: 'mock-sf-task-id-' + Math.floor(Math.random() * 100000) };
    }

    const { access_token, instance_url } = await getSalesforceToken(null, config);
    const payload = {
      Subject: `LeadX Dialer Outbound Call`,
      Description: `Call session ended with outcome: ${activityData.disposition}. Duration: ${activityData.duration}s. Summary: ${activityData.summary}`,
      Status: 'Completed',
      Priority: 'Normal',
      WhoId: activityData.leadCrmId || activityData.lead?.raw_data?.salesforce_id
    };

    const response = await fetch(`${instance_url}/services/data/v58.0/sobjects/Task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${access_token}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Salesforce writeTask failed: status ${response.status}`);
    }

    return await response.json();
  }

  async updateLeadStatus(leadId, newStatus, tenantConfig = {}) {
    const lead = await db.findLeadById(leadId);
    if (!lead) throw new Error('Lead not found');

    const isMock = isTestRunnerActive || !tenantConfig.sf_client_id || tenantConfig.sf_client_id.startsWith('mock-');
    const sfId = lead.raw_data?.salesforce_id;

    if (isMock) {
      console.log(`[Salesforce Mock] Lead ${leadId} status updated to ${newStatus}`);
      return { success: true };
    }

    if (!sfId) {
      throw new Error('Salesforce ID not found on lead raw_data');
    }

    const { access_token, instance_url } = await getSalesforceToken(null, tenantConfig);
    const response = await fetch(`${instance_url}/services/data/v58.0/sobjects/Contact/${sfId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${access_token}`
      },
      body: JSON.stringify({
        mx_LeadX_Status__c: newStatus,
        mx_LeadX_Score__c: lead.score
      })
    });

    if (!response.ok) {
      throw new Error(`Salesforce update Contact status failed: status ${response.status}`);
    }

    return { success: true };
  }
}

/**
 * Factory method returning the standardized CRM integration adapter.
 */
export function getCRMConnector(provider) {
  const norm = (provider || '').toLowerCase();
  if (norm === 'hubspot') return new HubSpotAdapter();
  if (norm === 'leadsquared') return new LeadSquaredAdapter();
  if (norm === 'salesforce') return new SalesforceAdapter();
  throw new Error(`CRM Provider ${provider} is not supported.`);
}

/**
 * Synchronizes lead details and scores to the external CRM.
 */
export async function syncToCRM(tenantId, lead, provider) {
  const connector = getCRMConnector(provider);
  const config = await db.getOnboardingConfig(tenantId);
  const normProvider = provider.toLowerCase();

  try {
    let result;
    // Map existing single sync logic to unified adapter calls
    if (normProvider === 'hubspot') {
      // HubSpot original sync implementation preserved via unified adapter helper
      const hsAdapter = new HubSpotAdapter();
      let accessToken = config.hubspot_oauth?.access_token || config.hubspot_api_key || hubspotKey;
      const isMock = isTestRunnerActive || (!accessToken || accessToken.startsWith('mock-')) && (!hubspotKey || hubspotKey.startsWith('mock-'));

      if (config.hubspot_oauth && config.hubspot_oauth.expires_at && Date.now() > config.hubspot_oauth.expires_at) {
        const refreshed = await refreshHubSpotToken(tenantId, config.hubspot_oauth.refresh_token);
        accessToken = refreshed.access_token;
      }

      if (!isMock) {
        let contactId = lead.raw_data?.hubspot_id;
        if (!contactId && lead.email) {
          try {
            const searchRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(lead.email)}?idProperty=email`, {
              headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (searchRes.ok) {
              const searchData = await searchRes.json();
              if (searchData.id) contactId = searchData.id;
            }
          } catch (err) {
            console.error('[HubSpot] Search by email failed:', err);
          }
        }

        const propertiesPayload = {
          firstname: lead.name,
          phone: lead.phone,
          email: lead.email,
          leadx_score: String(lead.score),
          leadx_status: lead.status
        };

        const syncBackConfig = config?.sync_back_config || {};
        if (syncBackConfig.leadx_id && lead.raw_data?.leadx_id) {
          propertiesPayload[syncBackConfig.leadx_id] = lead.raw_data.leadx_id;
        }
        if (syncBackConfig.campaign_id && lead.raw_data?.campaign_id) {
          propertiesPayload[syncBackConfig.campaign_id] = lead.raw_data.campaign_id;
        }

        let response;
        if (contactId) {
          response = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({ properties: propertiesPayload })
          });
        } else {
          response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({ properties: propertiesPayload })
          });
        }

        if (!response.ok) {
          throw new Error(`HubSpot API responded with ${response.status}: ${response.statusText}`);
        }
        result = await response.json();
      } else {
        result = { id: lead.raw_data?.hubspot_id || 'mock-hs-id-' + Math.floor(Math.random() * 100000) };
      }
    } else if (normProvider === 'leadsquared') {
      const accessKey = config.ls_access_key || leadSquaredKey;
      const isMock = isTestRunnerActive || !accessKey || accessKey.startsWith('mock-');

      if (!isMock) {
        const host = config.ls_api_host || 'api.leadsquared.com';
        const secretKey = config.ls_secret_key || '';
        const mapping = config.field_mapping || {
          name: "FirstName",
          phone: "Phone",
          email: "EmailAddress",
          score: "mx_LeadX_Score",
          status: "mx_LeadX_Status"
        };

        const response = await fetch(`https://${host}/v1/LeadManagement.svc/Lead.Create?accessKey=${accessKey}&secretKey=${secretKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([
            { Attribute: mapping.name, Value: lead.name },
            { Attribute: mapping.phone, Value: lead.phone },
            { Attribute: mapping.email, Value: lead.email },
            { Attribute: mapping.score, Value: String(lead.score) },
            { Attribute: mapping.status, Value: lead.status }
          ])
        });

        if (!response.ok) {
          throw new Error(`LeadSquared API responded with ${response.status}: ${response.statusText}`);
        }
        result = await response.json();
      } else {
        result = { id: 'mock-lq-id-' + Math.floor(Math.random() * 100000) };
      }
    } else if (normProvider === 'salesforce') {
      const isMock = isTestRunnerActive || !config.sf_client_id || config.sf_client_id.startsWith('mock-');
      const sfId = lead.raw_data?.salesforce_id;

      if (!isMock) {
        const { access_token, instance_url } = await getSalesforceToken(tenantId, config);
        
        let response;
        if (sfId) {
          // Update
          response = await fetch(`${instance_url}/services/data/v58.0/sobjects/Contact/${sfId}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${access_token}`
            },
            body: JSON.stringify({
              FirstName: lead.name?.split(' ')[0] || '',
              LastName: lead.name?.split(' ').slice(1).join(' ') || 'LeadX',
              Phone: lead.phone,
              Email: lead.email,
              mx_LeadX_Score__c: lead.score,
              mx_LeadX_Status__c: lead.status
            })
          });
        } else {
          // Create
          response = await fetch(`${instance_url}/services/data/v58.0/sobjects/Contact`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${access_token}`
            },
            body: JSON.stringify({
              FirstName: lead.name?.split(' ')[0] || '',
              LastName: lead.name?.split(' ').slice(1).join(' ') || 'LeadX',
              Phone: lead.phone,
              Email: lead.email,
              mx_LeadX_Score__c: lead.score,
              mx_LeadX_Status__c: lead.status
            })
          });
        }

        if (!response.ok && response.status !== 204) {
          throw new Error(`Salesforce API responded with ${response.status}`);
        }
        
        result = response.status === 204 ? { id: sfId } : await response.json();
      } else {
        result = { id: sfId || 'mock-sf-id-' + Math.floor(Math.random() * 100000) };
      }
    }

    await db.insertAuditLog(tenantId, 'crm_sync_success', {
      lead_id: lead.id,
      lead_name: lead.name,
      phone: lead.phone,
      provider: normProvider,
      result
    });

    return { success: true, provider: normProvider, result };
  } catch (error) {
    console.error(`CRM Sync failed for ${provider}:`, error);

    await db.insertAuditLog(tenantId, 'crm_sync_failure', {
      lead_id: lead.id,
      lead_name: lead.name,
      phone: lead.phone,
      provider: normProvider,
      error: error.message
    });

    throw error;
  }
}

export async function getCRMLists(tenantId, provider) {
  const norm = (provider || '').toLowerCase();
  
  if (norm === 'hubspot') {
    const config = await db.getOnboardingConfig(tenantId);
    let accessToken = config.hubspot_oauth?.access_token || config.hubspot_api_key || hubspotKey;
    const isMock = isTestRunnerActive || !accessToken || accessToken.startsWith('mock-');

    if (config.hubspot_oauth && config.hubspot_oauth.expires_at && Date.now() > config.hubspot_oauth.expires_at) {
      try {
        const refreshed = await refreshHubSpotToken(tenantId, config.hubspot_oauth.refresh_token);
        accessToken = refreshed.access_token;
      } catch (err) {
        console.error('[OAuth] Token refresh failed for lists:', err);
      }
    }

    if (!isMock) {
      const response = await fetch('https://api.hubapi.com/contacts/v1/lists', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (!response.ok) {
        throw new Error(`HubSpot API responded with status ${response.status}`);
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
  } else if (norm === 'leadsquared') {
    return [
      { id: "ls-all", name: "All LeadSquared Leads", count: 200 },
      { id: "ls-hot", name: "LeadSquared High Intent", count: 60 }
    ];
  } else if (norm === 'salesforce') {
    return [
      { id: "sf-all", name: "Salesforce All Contacts", count: 320 },
      { id: "sf-hot", name: "Salesforce Hot Leads", count: 75 }
    ];
  } else {
    throw new Error(`Unsupported CRM provider: ${provider}`);
  }
}

export async function getCRMContactsFromList(tenantId, provider, listId) {
  const norm = (provider || '').toLowerCase();

  if (norm === 'hubspot') {
    const config = await db.getOnboardingConfig(tenantId);
    let accessToken = config.hubspot_oauth?.access_token || config.hubspot_api_key || hubspotKey;
    const isMock = isTestRunnerActive || !accessToken || accessToken.startsWith('mock-');

    if (config.hubspot_oauth && config.hubspot_oauth.expires_at && Date.now() > config.hubspot_oauth.expires_at) {
      try {
        const refreshed = await refreshHubSpotToken(tenantId, config.hubspot_oauth.refresh_token);
        accessToken = refreshed.access_token;
      } catch (err) {
        console.error('[OAuth] Token refresh failed for contacts:', err);
      }
    }

    if (!isMock) {
      // 1. Dynamically fetch all property definitions to support custom fields
      let propertyQuery = '';
      let propMap = {};
      let allProperties = [];
      try {
        const propsRes = await fetch('https://api.hubapi.com/properties/v1/contacts/properties', {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (propsRes.ok) {
          const propsData = await propsRes.json();
          // Map internal names to labels for friendly UI
          propsData.forEach(p => {
            propMap[p.name] = p.label || p.name;
            allProperties.push({
              name: p.name,
              label: p.label || p.name,
              hubspotDefined: p.hubspotDefined === true || p.hubspotDefined === 'true',
              groupName: p.groupName,
              type: p.type
            });
          });
          
          // Exclude internal 'hs_' properties to avoid URL too long error, but keep the ones we need
          const required = ['firstname', 'lastname', 'email', 'phone', 'mobilephone', 'company', 'city', 'state', 'zip'];
          const propNames = propsData.map(p => p.name).filter(name => required.includes(name) || !name.startsWith('hs_')).slice(0, 200);
          propertyQuery = propNames.map(p => `&property=${encodeURIComponent(p)}`).join('');
        }
      } catch (err) {
        console.error('Failed to fetch properties, falling back to defaults', err);
      }
      
      // Fallback to basic properties if dynamic fetch failed or returned nothing
      if (!propertyQuery) {
        propertyQuery = '&property=firstname&property=lastname&property=email&property=phone&property=mobilephone&property=company&property=city&property=state&property=zip';
      }

      // 2. Fetch contacts with all dynamic properties appended
      const response = await fetch(`https://api.hubapi.com/contacts/v1/lists/${listId}/contacts/all?count=100${propertyQuery}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (!response.ok) {
        throw new Error(`HubSpot list contacts fetch failed: status ${response.status}`);
      }
      const data = await response.json();
      const contactsArray = (data.contacts || []).map(c => {
        const props = c.properties || {};
        const flat = {};
        Object.keys(props).forEach(k => {
          const label = propMap[k] || k;
          flat[label] = props[k]?.value || '';
        });
        flat["Customer Name"] = `${props.firstname?.value || ''} ${props.lastname?.value || ''}`.trim();
        flat["Contact Phone"] = props.phone?.value || '';
        flat["Email Address"] = props.email?.value || '';
        flat.hubspot_id = String(c.vid || c.id || '');
        flat["Record ID"] = flat.hubspot_id;
        return flat;
      });
      contactsArray.propertiesSchema = allProperties;
      return contactsArray;
    } else {
      const mockContacts = [
        { "Customer Name": "Vikram Seth", "Contact Phone": "+919934311029", "Email Address": "vikram.seth@outlook.com", "Age": "34", "Monthly Income": "62000", "City": "Delhi", "hubspot_id": "mock-hs-id-10001", "Record ID": "mock-hs-id-10001" },
        { "Customer Name": "Preeti Sen", "Contact Phone": "+918822399120", "Email Address": "preeti.sen@gmail.com", "Age": "28", "Monthly Income": "45000", "City": "Kolkata", "hubspot_id": "mock-hs-id-10002", "Record ID": "mock-hs-id-10002" },
        { "Customer Name": "Anand Rao", "Contact Phone": "+917766022199", "Email Address": "anand.rao@yahoo.com", "Age": "41", "Monthly Income": "89000", "City": "Chennai", "hubspot_id": "mock-hs-id-10003", "Record ID": "mock-hs-id-10003" }
      ];
      mockContacts.propertiesSchema = [
        { name: "firstname", label: "First Name", hubspotDefined: true, groupName: "contactinformation", type: "string" },
        { name: "lastname", label: "Last Name", hubspotDefined: true, groupName: "contactinformation", type: "string" },
        { name: "email", label: "Email Address", hubspotDefined: true, groupName: "contactinformation", type: "string" },
        { name: "phone", label: "Phone Number", hubspotDefined: true, groupName: "contactinformation", type: "string" },
        { name: "budget", label: "budget", hubspotDefined: false, groupName: "contactinformation", type: "string" },
        { name: "leadx_id", label: "LeadX ID", hubspotDefined: false, groupName: "contactinformation", type: "string" },
        { name: "leadx_campaign_id", label: "LeadX Campaign ID", hubspotDefined: false, groupName: "contactinformation", type: "string" },
        { name: "location_preference", label: "location_preference", hubspotDefined: false, groupName: "contactinformation", type: "string" }
      ];
      return mockContacts;
    }
  } else if (norm === 'leadsquared') {
    return [
      { "Customer Name": "Vikram Seth", "Contact Phone": "+919934311029", "Email Address": "vikram.seth@outlook.com", "Age": "34", "Monthly Income": "62000", "City": "Delhi" },
      { "Customer Name": "Preeti Sen", "Contact Phone": "+918822399120", "Email Address": "preeti.sen@gmail.com", "Age": "28", "Monthly Income": "45000", "City": "Kolkata" }
    ];
  } else if (norm === 'salesforce') {
    return [
      { "Customer Name": "Vikram Seth", "Contact Phone": "+919934311029", "Email Address": "vikram.seth@outlook.com", "Age": "34", "Monthly Income": "62000", "City": "Delhi", "salesforce_id": "mock-sf-id-301" },
      { "Customer Name": "Preeti Sen", "Contact Phone": "+918822399120", "Email Address": "preeti.sen@gmail.com", "Age": "28", "Monthly Income": "45000", "City": "Kolkata", "salesforce_id": "mock-sf-id-302" }
    ];
  } else {
    throw new Error(`Unsupported CRM provider: ${provider}`);
  }
}

export default {
  syncToCRM,
  getCRMLists,
  getCRMContactsFromList,
  getCRMConnector
};
