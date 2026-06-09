import dotenv from 'dotenv';
import db from '../config/db.js';

dotenv.config();

const hubspotKey = process.env.HUBSPOT_API_KEY;
const leadSquaredKey = process.env.LEADSQUARED_API_KEY;

class HubSpotAdapter {
  async sync(lead) {
    if (hubspotKey && hubspotKey !== 'mock-hubspot-api-key') {
      const response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${hubspotKey}`
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
    if (leadSquaredKey && leadSquaredKey !== 'mock-leadsquared-api-key') {
      const response = await fetch('https://api.leadsquared.com/v1/LeadManagement.svc/Lead.Create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${leadSquaredKey}`
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
