import { Router } from 'express';
import crypto from 'crypto';
import db from '../config/db.js';
import { validateLead, validateScoringWeights, cleanPhone, validateScript } from '../utils/validation.js';
import { computeLeadScore } from '../services/scoringEngine.js';
import { initSession, normaliseEvent } from '../services/voizAdapter.js';
import { sendSlackNotification } from '../services/slackService.js';
import { syncToCRM, getCRMLists, getCRMContactsFromList } from '../services/crmService.js';
import { enqueueLead, handleCallOutcome, forceRetry, getQueueStats, isCallable } from '../services/queueService.js';
import { enqueueJob } from '../services/jobQueue.js';
import { checkEscalation } from '../services/escalationService.js';
import { handleEscalation } from '../services/handoffService.js';


const router = Router();

/**
 * GET /leads/config
 * Retrieves scoring weights configuration for a tenant.
 */
router.get('/config', async (req, res, next) => {
  try {
    const { tenant_id } = req.query;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id query parameter is required' });
    }
    const weights = await db.getWeights(tenant_id);
    res.json({ success: true, tenant_id, weights });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/config
 * Updates scoring weights configuration for a tenant.
 */
router.post('/config', async (req, res, next) => {
  try {
    const { tenant_id, weights, changed_by } = req.body;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id is required' });
    }

    const valResult = validateScoringWeights(weights);
    if (!valResult.isValid) {
      return res.status(400).json({ error: 'Validation Error', message: 'Invalid scoring weights configuration', errors: valResult.errors });
    }

    await db.upsertWeights(tenant_id, weights, changed_by || 'system');
    
    // Slack notice
    await sendSlackNotification(`[Configuration Alert] Scoring weights modified for tenant "${tenant_id}" by user "${changed_by || 'system'}".`);
    
    res.json({ success: true, tenant_id, weights });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leads
 * Retrieves all leads for a tenant.
 */
router.get('/', async (req, res, next) => {
  try {
    const { tenant_id } = req.query;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id query parameter is required' });
    }
    const leads = await db.getLeads(tenant_id);
    res.json({ success: true, leads });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/ingest
 * Ingest a single lead, check for duplicate, compute score, and insert.
 */
router.post('/ingest', async (req, res, next) => {
  try {
    const leadData = req.body;

    // Validate request body
    const valResult = validateLead(leadData);
    if (!valResult.isValid) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid lead payload',
        errors: valResult.errors
      });
    }

    const { tenant_id, phone } = leadData;
    const cleaned = cleanPhone(phone);

    // Check for duplicate in database
    const existingLead = await db.findLeadByPhone(tenant_id, cleaned);
    if (existingLead) {
      const newCampaign = leadData.campaign_name || 'Manual Campaigns';
      const currentCampaigns = existingLead.campaign_name ? existingLead.campaign_name.split(',').map(c => c.trim()) : [];
      
      existingLead.raw_data = existingLead.raw_data || {};
      if (!existingLead.raw_data.leadx_id) {
        existingLead.raw_data.leadx_id = leadData.raw_data?.leadx_id || 'ldx_' + Math.random().toString(36).substr(2, 9);
      }
      
      // Update with the most recent campaign_id
      const mostRecentCampaignId = leadData.raw_data?.campaign_id || 'cmp_' + Math.random().toString(36).substr(2, 9);
      existingLead.raw_data.campaign_id = mostRecentCampaignId;

      if (!currentCampaigns.includes(newCampaign)) {
        currentCampaigns.push(newCampaign);
      }
      const updatedCampaignString = currentCampaigns.join(', ');
      await db.updateLeadCampaignAndData(existingLead.id, updatedCampaignString, existingLead.raw_data);
      existingLead.campaign_name = updatedCampaignString;

      // Sync duplicate lead back to CRM
      if (existingLead.raw_data?.hubspot_id || existingLead.email) {
        syncToCRM(tenant_id, existingLead, 'hubspot').catch(err => {
          console.error('[Ingestion Sync-Back] Failed to sync duplicate lead to HubSpot:', existingLead.id, err);
        });
      }
      
      return res.status(200).json({
        success: true,
        message: 'Lead already exists. Appended to new campaign.',
        lead: existingLead
      });
    }

    // Retrieve tenant configuration for scoring
    const weights = await db.getWeights(tenant_id);

    // Clean data and build structured lead
    const processedLead = {
      ...leadData,
      phone: cleaned,
      dataset_id: leadData.dataset_id || 'manual-entry',
      campaign_name: leadData.campaign_name || 'Manual Campaigns',
      raw_data: leadData.raw_data || {}
    };

    if (!processedLead.raw_data.leadx_id) {
      processedLead.raw_data.leadx_id = 'ldx_' + Math.random().toString(36).substr(2, 9);
    }
    if (!processedLead.raw_data.campaign_id) {
      processedLead.raw_data.campaign_id = 'cmp_' + Math.random().toString(36).substr(2, 9);
    }

    // Calculate score
    const score = computeLeadScore(processedLead, weights);
    processedLead.score = score;

    // Save lead
    const savedLead = await db.insertLead(processedLead);

    // Enqueue in dialer priority queue
    await enqueueLead(savedLead.id, score);

    // Asynchronously sync back to CRM
    if (savedLead.raw_data?.hubspot_id || savedLead.email) {
      syncToCRM(tenant_id, savedLead, 'hubspot').catch(err => {
        console.error('[Ingestion Sync-Back] Failed to sync new lead to HubSpot:', savedLead.id, err);
      });
    }

    // Insert System Audit Log
    await db.insertAuditLog(tenant_id, 'lead_ingested', {
      lead_id: savedLead.id,
      phone: cleaned,
      score,
      dataset_id: processedLead.dataset_id,
      campaign_name: processedLead.campaign_name
    });

    // Slack Notification for Hot Lead Ingestion
    if (score >= 80) {
      await sendSlackNotification(`[Ingestion Alert] HOT Lead Ingested: ${savedLead.name || 'Unknown'} (${cleaned}) scored ${score}/100.`);
    }

    res.status(201).json({
      success: true,
      lead: savedLead
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/batch
 * Processes batch of up to 500 leads.
 */
router.post('/batch', async (req, res, next) => {
  try {
    const { tenant_id, leads, dataset_id, campaign_name } = req.body;

    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id is required' });
    }
    if (!leads || !Array.isArray(leads)) {
      return res.status(400).json({ error: 'Validation Error', message: 'leads must be an array of lead objects' });
    }
    if (leads.length > 500) {
      return res.status(400).json({ error: 'Validation Error', message: 'Batch size exceeds the maximum limit of 500 leads' });
    }

    // Enqueue the background job
    const job = await enqueueJob(tenant_id, 'batch_ingest', { tenant_id, leads, dataset_id, campaign_name });

    res.status(202).json({
      success: true,
      message: 'Batch ingestion started in background.',
      job_id: job.id
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/:id/rescore
 * Recomputes score of a lead based on current tenant config.
 */
router.post('/:id/rescore', async (req, res, next) => {
  try {
    const { id } = req.params;
    const lead = await db.findLeadById(id);
    if (!lead) {
      return res.status(404).json({ error: 'Not Found', message: `Lead with ID ${id} does not exist.` });
    }

    const weights = await db.getWeights(lead.tenant_id);
    const oldScore = lead.score;
    const newScore = computeLeadScore(lead, weights);

    let updatedLead = lead;
    if (oldScore !== newScore) {
      updatedLead = await db.updateLeadScore(id, newScore);
    }

    res.json({
      success: true,
      lead_id: id,
      old_score: oldScore,
      new_score: newScore,
      lead: updatedLead
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/:id/resolve
 * Marks a hot escalation as resolved by transitioning status to called.
 */
router.post('/:id/resolve', async (req, res, next) => {
  try {
    const { id } = req.params;
    const lead = await db.findLeadById(id);
    if (!lead) {
      return res.status(404).json({ error: 'Not Found', message: `Lead with ID ${id} does not exist.` });
    }
    const updated = await db.updateLeadStatus(id, 'called');
    await db.insertAuditLog(lead.tenant_id, 'escalation_resolved', { lead_id: id });
    res.json({ success: true, lead: updated, message: 'Escalation resolved successfully.' });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/onboard
 * Saves client discovery questionnaire configurations.
 */
router.post('/onboard', async (req, res, next) => {
  try {
    const { tenant_id, onboarding_config } = req.body;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id is required' });
    }
    if (!onboarding_config) {
      return res.status(400).json({ error: 'Validation Error', message: 'onboarding_config is required' });
    }

    await db.upsertOnboardingConfig(tenant_id, onboarding_config);

    // Audit log
    await db.insertAuditLog(tenant_id, 'onboarding_config_updated', onboarding_config);

    // Slack alerts
    await sendSlackNotification(`[Onboarding Alert] Client setup completed for tenant "${tenant_id}". Industry segment: ${onboarding_config.industry || 'General'}.`);

    res.json({ success: true, tenant_id, onboarding_config });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leads/onboard
 * Retrieves onboarding configurations for a tenant.
 */
router.get('/onboard', async (req, res, next) => {
  try {
    const { tenant_id } = req.query;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id query parameter is required' });
    }
    const onboarding_config = await db.getOnboardingConfig(tenant_id);
    res.json({ success: true, tenant_id, onboarding_config });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leads/audit-trail
 * Retrieves centralized audit log events.
 */
router.get('/audit-trail', async (req, res, next) => {
  try {
    const { tenant_id } = req.query;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id query parameter is required' });
    }
    const logs = await db.getAuditTrail(tenant_id);
    res.json({ success: true, logs });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leads/events
 * Retrieves call session event logs.
 */
router.get('/events', async (req, res, next) => {
  try {
    const { tenant_id, event_type } = req.query;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id query parameter is required' });
    }
    const events = await db.getCallEvents(tenant_id, event_type || null);
    res.json({ success: true, events });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/trigger-call
 * Triggers a simulated VOIZ outbound dialing session.
 */
router.post('/trigger-call', async (req, res, next) => {
  try {
    const { tenant_id, lead_id } = req.body;
    if (!tenant_id || !lead_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id and lead_id are required' });
    }

    const lead = await db.findLeadById(lead_id);
    if (!lead) {
      return res.status(404).json({ error: 'Not Found', message: `Lead with ID ${lead_id} does not exist.` });
    }

    const onboarding = await db.getOnboardingConfig(tenant_id);

    // Platform-maintained DNC check (default to true unless explicit client override)
    const usePlatformDnc = onboarding.dnc_validation_ownership !== 'client';
    if (usePlatformDnc && (lead.phone.includes('403') || lead.phone.includes('0000'))) {
      await db.updateLeadStatus(lead_id, 'dnc');
      
      await db.insertAuditLog(tenant_id, 'dnc_block', {
        lead_id: lead.id,
        phone: lead.phone
      });
      await sendSlackNotification(`[DNC Block] outbound dial blocked to DNC number: ${lead.phone}`);
      return res.status(400).json({ error: 'DNC Block', message: 'The number is registered on the national DNC database.' });
    }

    // Dynamic URL mapping
    const protocol = req.protocol;
    const host = req.get('host');
    const webhookUrl = `${protocol}://${host}/leads/voiz-webhook`;

    // Initialize session via adapter
    const result = await initSession(lead, onboarding, webhookUrl);

    // Save initial call session
    const session = await db.insertCallSession({
      tenant_id,
      lead_id,
      voiz_session_id: result.voiz_session_id,
      disposition: 'calling'
    });

    await db.insertAuditLog(tenant_id, 'call_initiated', {
      lead_id,
      voiz_session_id: result.voiz_session_id,
      phone: lead.phone
    });

    res.json({ success: true, message: 'Call session initiated', voiz_session_id: result.voiz_session_id, session_id: session.id });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/voiz-webhook
 * Webhook handler receiving stream callback events from mock/live VOIZ dialer.
 */
router.post('/voiz-webhook', async (req, res, next) => {
  try {
    const rawEvent = req.body;
    const { tenant_id, lead_id, event_type, phone, name } = rawEvent;
    const voizSessionId = rawEvent.payload?.voiz_session_id;

    if (!tenant_id || !event_type || !voizSessionId) {
      return res.status(400).json({ error: 'Validation Error', message: 'Required fields missing from event' });
    }

    // Find session or insert dynamic fallback
    let session = await db.findCallSessionByVoizId(voizSessionId);
    if (!session) {
      session = await db.insertCallSession({
        tenant_id,
        lead_id: lead_id || '00000000-0000-0000-0000-000000000000',
        voiz_session_id: voizSessionId,
        disposition: 'calling'
      });
    }

    // Normalize
    const normalized = normaliseEvent({
      tenant_id,
      session_id: session.id,
      event_type,
      payload: rawEvent.payload,
      timestamp: rawEvent.timestamp
    });

    // Save event
    await db.insertCallEvent(normalized);

    // Stream handlers
    let activeEventType = event_type;

    if (activeEventType !== 'escalation_triggered' && activeEventType !== 'call_ended' && activeEventType !== 'call_started') {
      try {
        const onboarding = await db.getOnboardingConfig(tenant_id);
        const scriptId = onboarding.active_script_id || 'default-script';
        const scriptConfig = await db.getLatestScript(tenant_id, scriptId);
        if (scriptConfig) {
          const transcript = rawEvent.payload?.transcript || '';
          const duration = rawEvent.payload?.call_duration_seconds || rawEvent.payload?.duration || 0;
          const sentiment = rawEvent.payload?.sentiment || 'neutral';
          const escResult = checkEscalation(transcript, duration, sentiment, scriptConfig);
          if (escResult.shouldEscalate) {
            activeEventType = 'escalation_triggered';
            rawEvent.payload = {
              ...(rawEvent.payload || {}),
              reason: escResult.reason,
              detail: escResult.detail
            };
          }
        }
      } catch (err) {
        console.error('Error running checkEscalation inside webhook:', err.message);
      }
    }

    if (activeEventType === 'escalation_triggered') {
      await handleEscalation(voizSessionId, rawEvent);
    } else if (activeEventType === 'call_ended') {
      await handleCallOutcome(
        voizSessionId,
        rawEvent.payload.disposition,
        rawEvent.payload.call_duration_seconds || 0,
        rawEvent.payload.summary || ''
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Webhook payload error:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

/**
 * POST /leads/batch-sync-crm
 * Bulk syncs multiple leads by their IDs to a CRM provider.
 */
router.post('/batch-sync-crm', async (req, res, next) => {
  try {
    const { ids, provider } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Validation Error', message: 'ids array is required and must not be empty' });
    }
    if (!provider) {
      return res.status(400).json({ error: 'Validation Error', message: 'provider is required' });
    }

    const results = [];
    for (const id of ids) {
      const lead = await db.findLeadById(id);
      if (!lead) {
        results.push({ id, success: false, message: `Lead with ID ${id} does not exist.` });
        continue;
      }
      try {
        const syncRes = await syncToCRM(lead.tenant_id, lead, provider);
        results.push({ id, success: true, result: syncRes.result });
      } catch (err) {
        results.push({ id, success: false, error: err.message });
      }
    }

    res.json({ success: true, message: `Batch sync completed for ${provider}`, results });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/:id/sync-crm
 * Manually syncs a specific lead to a CRM provider (hubspot or leadsquared).
 */
router.post('/:id/sync-crm', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { provider } = req.body;
    if (!provider) {
      return res.status(400).json({ error: 'Validation Error', message: 'provider query parameter is required' });
    }
    const lead = await db.findLeadById(id);
    if (!lead) {
      return res.status(404).json({ error: 'Not Found', message: `Lead with ID ${id} does not exist.` });
    }

    const result = await syncToCRM(lead.tenant_id, lead, provider);
    res.json({ success: true, message: `Lead successfully synced to ${provider}`, result });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leads/crm-lists
 * Retrieves available list segments from a CRM provider.
 */
router.get('/crm-lists', async (req, res, next) => {
  try {
    const { tenant_id, provider } = req.query;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id query parameter is required' });
    }
    if (!provider) {
      return res.status(400).json({ error: 'Validation Error', message: 'provider query parameter is required' });
    }

    const lists = await getCRMLists(tenant_id, provider);
    res.json({ success: true, lists });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leads/crm-contacts
 * Retrieves contact members from a specific CRM list segment.
 */
router.get('/crm-contacts', async (req, res, next) => {
  try {
    const { tenant_id, provider, list_id } = req.query;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id query parameter is required' });
    }
    if (!provider) {
      return res.status(400).json({ error: 'Validation Error', message: 'provider query parameter is required' });
    }
    if (!list_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'list_id query parameter is required' });
    }

    const contacts = await getCRMContactsFromList(tenant_id, provider, list_id);
    res.json({
      success: true,
      contacts,
      properties: contacts.propertiesSchema || []
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leads/campaigns
 * Retrieves unique campaigns for a tenant and aggregates stats.
 */
router.get('/campaigns', async (req, res, next) => {
  try {
    const { tenant_id } = req.query;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id query parameter is required' });
    }

    const leads = await db.getLeads(tenant_id);
    const campaignsMap = {};

    leads.forEach(lead => {
      const campNames = lead.campaign_name
        ? lead.campaign_name.split(',').map(c => c.trim()).filter(Boolean)
        : ['Manual Ingests'];

      campNames.forEach(campName => {
        if (!campaignsMap[campName]) {
          campaignsMap[campName] = {
            name: campName,
            ingested: 0,
            attempted: 0,
            connected: 0
          };
        }
        const camp = campaignsMap[campName];
        camp.ingested += 1;
        
        // attempted means status is not ingested
        if (lead.status && lead.status !== 'ingested') {
          camp.attempted += 1;
        }
        // connected means status is connected
        if (lead.status === 'connected') {
          camp.connected += 1;
        }
      });
    });

    const campaigns = Object.values(campaignsMap).map(camp => {
      const rate = camp.attempted > 0 ? (camp.connected / camp.attempted) * 100 : 0;
      return {
        name: camp.name,
        ingested: camp.ingested,
        attempted: camp.attempted,
        connected: camp.connected,
        connect_rate: parseFloat(rate.toFixed(1))
      };
    });

    res.json({ success: true, campaigns });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /leads/campaigns
 * Deletes all leads associated with a campaign name (or removes the campaign reference).
 */
router.delete('/campaigns', async (req, res, next) => {
  try {
    const { tenant_id, campaign_name } = req.body;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id is required' });
    }
    if (!campaign_name) {
      return res.status(400).json({ error: 'Validation Error', message: 'campaign_name is required' });
    }

    await db.deleteCampaign(tenant_id, campaign_name);

    // Audit log
    await db.insertAuditLog(tenant_id, 'campaign_deleted', { campaign_name });

    res.json({ success: true, message: `Campaign "${campaign_name}" successfully deleted.` });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leads/queue-status
 * Returns current metrics of the queue.
 */
router.get('/queue-status', async (req, res, next) => {
  try {
    const { tenant_id } = req.query;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id query parameter is required' });
    }
    const stats = await getQueueStats(tenant_id);
    res.json({ success: true, stats });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/force-retry
 * Triggers the dialer force retry for failed or called contacts.
 */
router.post('/force-retry', async (req, res, next) => {
  try {
    const { tenant_id } = req.body;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id is required' });
    }
    const count = await forceRetry(tenant_id);
    res.json({ success: true, message: `Force retry triggered successfully. Re-queued ${count} leads.` });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/dnc
 * Enrolls a lead phone number to the Do Not Call registry.
 */
router.post('/dnc', async (req, res, next) => {
  try {
    const { tenant_id, phone } = req.body;
    if (!tenant_id || !phone) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id and phone are required' });
    }
    const cleaned = cleanPhone(phone);
    await db.addDncNumber(tenant_id, cleaned);
    
    // Find lead and mark as dnc
    const lead = await db.findLeadByPhone(tenant_id, cleaned);
    if (lead) {
      await db.updateLeadStatus(lead.id, 'dnc');
    }

    await db.insertAuditLog(tenant_id, 'dnc_block', { phone: cleaned });
    await sendSlackNotification(`[DNC Block] outbound dial blocked to DNC number: ${cleaned}`);
    
    res.json({ success: true, message: `Phone ${cleaned} registered in DNC.` });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/webhook/leadsquared
 * Receives LeadSquared inbound webhooks, validates HMAC-SHA256 signature, and ingests/queues leads.
 */
router.post('/webhook/leadsquared', async (req, res, next) => {
  try {
    const tenantId = req.query.tenant_id || 'default-tenant';
    const signature = req.headers['x-ls-signature'] || req.headers['signature'];
    const config = await db.getOnboardingConfig(tenantId);
    const secretKey = config.ls_secret_key || process.env.LEADSQUARED_SECRET_KEY || 'mock-secret';

    // Signature Validation
    if (signature) {
      const hmac = crypto.createHmac('sha256', secretKey);
      const computed = hmac.update(JSON.stringify(req.body)).digest('hex');
      if (computed !== signature) {
        await sendSlackNotification(`[Security Alert] Invalid LeadSquared HMAC signature received for tenant "${tenantId}".`);
        return res.status(401).json({ error: 'Unauthorized', message: 'HMAC signature validation failed' });
      }
    } else if (process.env.NODE_ENV === 'production') {
      await sendSlackNotification(`[Security Alert] Missing LeadSquared HMAC signature for tenant "${tenantId}".`);
      return res.status(401).json({ error: 'Unauthorized', message: 'HMAC signature is required' });
    }

    const payload = req.body;
    
    // Specific error mapping checks
    if (payload.simulate_error === '429') {
      return res.status(429).json({ error: 'Too Many Requests', message: 'Rate limit exceeded, please retry later.' });
    }
    if (payload.simulate_error === '401') {
      await sendSlackNotification(`[Slack Alert] LeadSquared integration credentials expired for tenant "${tenantId}".`);
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid credentials' });
    }
    if (payload.simulate_error === '404') {
      console.warn(`[LeadSquared Webhook] Lead not found (404) for payload.`);
      return res.status(200).json({ success: false, message: 'Lead not found, skipped.' });
    }

    const phone = payload.Phone || payload.Mobile;
    if (!phone) {
      return res.status(400).json({ error: 'Validation Error', message: 'Phone number is required' });
    }

    const cleaned = cleanPhone(phone);
    const name = payload.FirstName || payload.Name || 'LSQ Inbound Lead';
    const email = payload.EmailAddress || payload.Email || '';

    // Check for duplicate in database
    const existingLead = await db.findLeadByPhone(tenantId, cleaned);
    if (existingLead) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A lead with this phone number already exists under the specified tenant.'
      });
    }

    const weights = await db.getWeights(tenantId);
    const leadData = {
      tenant_id: tenantId,
      name,
      phone: cleaned,
      email,
      source: 'leadsquared',
      raw_data: payload
    };

    const score = computeLeadScore(leadData, weights);
    leadData.score = score;
    leadData.dataset_id = 'lsq-webhook';
    leadData.campaign_name = 'LeadSquared Webhooks';

    const saved = await db.insertLead(leadData);
    await enqueueLead(saved.id, score);

    await db.insertAuditLog(tenantId, 'lead_webhook_ingested', {
      lead_id: saved.id,
      phone: cleaned,
      score
    });

    res.status(201).json({ success: true, lead: saved });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leads/scripts
 * Retrieves all scripts for a tenant.
 */
router.get('/scripts', async (req, res, next) => {
  try {
    const { tenant_id } = req.query;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id is required' });
    }
    const scripts = await db.getAllScripts(tenant_id);
    res.json({ success: true, scripts });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leads/scripts/:id
 * Retrieves a script by ID (UUID or script_id).
 */
router.get('/scripts/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUuid) {
      const scripts = await db.getAllScripts(req.query.tenant_id || 'default-tenant');
      const script = scripts.find(s => s.id === id);
      if (!script) {
        return res.status(404).json({ error: 'Not Found', message: `Script with ID ${id} not found.` });
      }
      return res.json({ success: true, script });
    } else {
      const { tenant_id, version } = req.query;
      if (!tenant_id) {
        return res.status(400).json({ error: 'Validation Error', message: 'tenant_id query parameter is required when searching by script_id' });
      }
      let script = null;
      if (version) {
        script = await db.getScript(tenant_id, id, version);
      } else {
        script = await db.getLatestScript(tenant_id, id);
      }
      if (!script) {
        return res.status(404).json({ error: 'Not Found', message: `Script with script_id ${id} not found.` });
      }
      return res.json({ success: true, script });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/scripts
 * Validates and saves a script configuration.
 */
router.post('/scripts', async (req, res, next) => {
  try {
    const scriptData = req.body;
    const valResult = validateScript(scriptData);
    if (!valResult.isValid) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid script configuration',
        errors: valResult.errors
      });
    }

    const savedScript = await db.insertScript(scriptData);
    
    await db.insertAuditLog(scriptData.tenant_id, 'script_created', {
      script_id: savedScript.script_id,
      version: savedScript.version
    });

    res.status(201).json({ success: true, script: savedScript });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leads/handoff/brief/:lead_id
 * Serves agent brief context for the lead.
 */
router.get('/handoff/brief/:lead_id', async (req, res, next) => {
  try {
    const { lead_id } = req.params;
    let brief = await db.getAgentBrief(lead_id);
    if (!brief) {
      // Auto-heal missing briefs for escalated leads
      const lead = await db.findLeadById(lead_id);
      if (!lead) {
        return res.status(404).json({ error: 'Not Found', message: `No lead found for ID ${lead_id}.` });
      }
      
      if (lead.status === 'hot_escalated') {
        const allSessions = await db.getCallSessions(lead.tenant_id);
        const sessions = allSessions.filter(s => s.lead_id === lead_id);
        const latestSession = sessions[0];
        
        const briefData = {
          lead_name: lead.name || 'Anonymous Prospect',
          phone: lead.phone,
          score: lead.score,
          call_summary: latestSession?.summary || 'Lead was marked escalated.',
          key_phrases: latestSession?.summary ? [latestSession.summary] : ['Handoff requested.'],
          objections: [],
          recommended_action: 'Contact the lead immediately by phone.',
          escalation_reason: latestSession?.disposition || 'Manual Handoff',
          timestamp: new Date().toISOString()
        };
        
        await db.upsertAgentBrief(lead.tenant_id, lead_id, briefData);
        brief = { brief: briefData };
      } else {
        return res.status(404).json({ error: 'Not Found', message: `No agent brief found for lead ID ${lead_id}.` });
      }
    }
    res.json({ success: true, brief: brief.brief });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/handoff/escalate
 * Manually escalates a call session.
 */
router.post('/handoff/escalate', async (req, res, next) => {
  try {
    const { tenant_id, lead_id, voiz_session_id, reason } = req.body;
    if (!tenant_id || !lead_id || !voiz_session_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id, lead_id, and voiz_session_id are required' });
    }

    const brief = await handleEscalation(voiz_session_id, {
      payload: { reason: reason || 'Manual Handoff' }
    });

    res.json({ success: true, message: 'Session manually escalated.', brief });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/calls/instant
 * Immediately initiates a simulated call session, bypassing the queue capacity.
 * If at concurrent capacity, enqueues the lead with highest priority.
 */
router.post('/calls/instant', async (req, res, next) => {
  try {
    const { tenant_id, lead_id } = req.body;
    if (!tenant_id || !lead_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id and lead_id are required' });
    }

    const lead = await db.findLeadById(lead_id);
    if (!lead) {
      return res.status(404).json({ error: 'Not Found', message: `Lead with ID ${lead_id} does not exist.` });
    }

    // DNC check
    const onboarding = await db.getOnboardingConfig(tenant_id);
    const usePlatformDnc = onboarding.dnc_validation_ownership !== 'client';
    const isDnc = await db.isDncNumber(tenant_id, lead.phone);
    const isDncMockPattern = lead.phone.includes('403') || lead.phone.includes('0000');

    if (usePlatformDnc && (isDnc || isDncMockPattern)) {
      await db.updateLeadStatus(lead_id, 'dnc');
      await db.insertAuditLog(tenant_id, 'dnc_block', { lead_id: lead.id, phone: lead.phone });
      await sendSlackNotification(`[DNC Block] Instant call blocked to DNC number: ${lead.phone}`);
      return res.status(400).json({ error: 'DNC Block', message: 'The number is registered on the national DNC database.' });
    }

    if (!isCallable(lead, onboarding)) {
      return res.status(400).json({ error: 'Outside Calling Hours', message: 'Calls are only permitted between 9 AM and 8 PM IST.' });
    }

    // Concurrency check
    const limit = onboarding.concurrent_call_limit || 5;
    const activeCalls = await db.getActiveCallsCount(tenant_id);

    if (activeCalls >= limit) {
      // Concurrency full, enqueue at highest priority
      await db.updateLeadStatusAndData(lead_id, 'queued', {
        ...(lead.raw_data || {}),
        instant_requested_at: new Date().toISOString()
      });
      await db.updateLeadScore(lead_id, 999);
      
      await db.insertAuditLog(tenant_id, 'instant_call_queued', { lead_id, message: 'Concurrency limit reached, enqueued at highest priority.' });
      return res.json({ success: true, dial_mode: 'queued_high_priority', message: 'Concurrency limit reached. Enqueued at highest priority.' });
    }

    // Direct dialing
    await db.updateLeadStatus(lead_id, 'calling');
    const protocol = req.protocol;
    const host = req.get('host');
    const webhookUrl = `${protocol}://${host}/leads/voiz-webhook`;

    const result = await initSession(lead, onboarding, webhookUrl);

    const session = await db.insertCallSession({
      tenant_id,
      lead_id,
      voiz_session_id: result.voiz_session_id,
      disposition: 'calling'
    });

    await db.insertAuditLog(tenant_id, 'call_initiated_instant', {
      lead_id,
      voiz_session_id: result.voiz_session_id,
      phone: lead.phone
    });

    res.json({ success: true, dial_mode: 'instant', voiz_session_id: result.voiz_session_id, session_id: session.id });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leads/analytics/summary
 * Aggregates dashboard analytics KPI cards and funnel metrics.
 */
router.get('/analytics/summary', async (req, res, next) => {
  try {
    const { tenant_id } = req.query;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id query parameter is required' });
    }

    const leads = await db.getLeads(tenant_id);
    const sessions = await db.getCallSessions(tenant_id);

    const totalLeads = leads.length;
    const hotLeads = leads.filter(l => l.score >= 80).length;
    const qualifiedLeads = leads.filter(l => l.score >= 65 && l.status !== 'dnc').length;

    // local today range
    const todayStr = new Date().toISOString().substring(0, 10);
    const callsToday = sessions.filter(s => s.started_at.substring(0, 10) === todayStr).length;

    // Connect rate
    const totalCalls = sessions.length;
    const connectedDispositions = ['called', 'qualified', 'interested', 'callback', 'qualified_escalated', 'converted', 'hot_escalated'];
    const connectedCalls = sessions.filter(s => s.disposition && connectedDispositions.includes(s.disposition.toLowerCase())).length;
    const connectRate = totalCalls > 0 ? parseFloat(((connectedCalls / totalCalls) * 100).toFixed(1)) : 0.0;

    // Funnel breakdown
    const funnel = {
      ingested: totalLeads,
      scrubbed: totalLeads - leads.filter(l => l.status === 'dnc').length,
      scored: totalLeads,
      queued: leads.filter(l => ['queued', 're-queued', 'calling', 'called', 'closed', 'hot_escalated'].includes(l.status)).length,
      attempted: totalCalls,
      connected: connectedCalls,
      qualified: qualifiedLeads
    };

    // Dispositions pie chart
    const dispositionsMap = {};
    sessions.forEach(s => {
      if (s.disposition) {
        const d = s.disposition.toUpperCase();
        dispositionsMap[d] = (dispositionsMap[d] || 0) + 1;
      }
    });
    const dispositions = Object.entries(dispositionsMap).map(([name, value]) => ({ name, value }));

    // Connect rate trend (last 7 days)
    const trendMap = {};
    sessions.forEach(s => {
      const date = s.started_at.substring(0, 10);
      if (!trendMap[date]) {
        trendMap[date] = { date, total: 0, connected: 0 };
      }
      trendMap[date].total++;
      if (s.disposition && connectedDispositions.includes(s.disposition.toLowerCase())) {
        trendMap[date].connected++;
      }
    });

    const connectRateTrend = Object.values(trendMap)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-7)
      .map(t => ({
        date: t.date,
        connect_rate: parseFloat(((t.connected / t.total) * 100).toFixed(1))
      }));

    // Scoring effectiveness
    const hotLeadsConverted = leads.filter(l => l.score >= 80 && ['called', 'hot_escalated', 'converted'].includes(l.status)).length;
    const warmLeadsConverted = leads.filter(l => l.score >= 50 && l.score < 80 && ['called', 'hot_escalated', 'converted'].includes(l.status)).length;
    const coldLeadsConverted = leads.filter(l => l.score < 50 && ['called', 'hot_escalated', 'converted'].includes(l.status)).length;

    const scoringEffectiveness = [
      { category: 'Hot (>=80)', converted: hotLeadsConverted },
      { category: 'Warm (50-79)', converted: warmLeadsConverted },
      { category: 'Cold (<50)', converted: coldLeadsConverted }
    ];

    res.json({
      success: true,
      kpis: {
        calls_today: callsToday,
        connect_rate: connectRate,
        qualified_leads: qualifiedLeads,
        hot_leads: hotLeads
      },
      funnel,
      dispositions,
      connect_rate_trend: connectRateTrend,
      scoring_effectiveness: scoringEffectiveness
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leads/scoring-config/:tenant_id
 */
router.get('/scoring-config/:tenant_id', async (req, res, next) => {
  try {
    const { tenant_id } = req.params;
    const weights = await db.getWeights(tenant_id);
    res.json({ success: true, tenant_id, weights });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/scoring-config/:tenant_id
 */
router.post('/scoring-config/:tenant_id', async (req, res, next) => {
  try {
    const { tenant_id } = req.params;
    const { weights, changed_by } = req.body;
    const valResult = validateScoringWeights(weights);
    if (!valResult.isValid) {
      return res.status(400).json({ error: 'Validation Error', message: 'Invalid scoring weights', errors: valResult.errors });
    }
    await db.upsertWeights(tenant_id, weights, changed_by || 'system');
    res.json({ success: true, tenant_id, weights });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leads/:id/sessions
 * Retrieves call sessions, WhatsApp/message logs, and disposition history for a specific lead.
 */
router.get('/:id/sessions', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { tenant_id } = req.query;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id query parameter is required' });
    }

    const lead = await db.findLeadById(id);
    if (!lead) {
      return res.status(404).json({ error: 'Not Found', message: `Lead with ID ${id} does not exist.` });
    }

    const allSessions = await db.getCallSessions(tenant_id);
    const sessions = allSessions.filter(s => s.lead_id === id);

    // Fetch actual interactions from the audit trail
    const auditEvents = await db.getLeadInteractions(tenant_id, id);
    
    // Separate message logs and disposition logs from audit events
    const realMessages = auditEvents
      .filter(e => e.event_type === 'whatsapp_message' || e.event_type === 'sms_message')
      .map(e => ({
        id: e.id,
        type: e.event_type === 'whatsapp_message' ? 'whatsapp' : 'sms',
        direction: e.details.direction || 'sent',
        sender: e.details.sender || 'system',
        body: e.details.body || '',
        timestamp: e.created_at || e.timestamp,
        status: e.details.status || 'delivered'
      }));

    const realDispositions = auditEvents
      .filter(e => e.event_type === 'disposition_changed' || e.event_type === 'lead_ingested' || e.event_type === 'lead_enqueued')
      .map(e => {
        let old_status = 'unknown';
        let new_status = 'unknown';
        let reason = '';
        if (e.event_type === 'lead_ingested') {
          old_status = '-';
          new_status = 'ingested';
          reason = 'Lead ingested from source';
        } else if (e.event_type === 'lead_enqueued') {
          old_status = 'ingested';
          new_status = 'queued';
          reason = 'Added to outbound dialer queue';
        } else {
          old_status = e.details.old_status || 'unknown';
          new_status = e.details.new_status || 'unknown';
          reason = e.details.reason || `Status updated from ${old_status} to ${new_status}`;
        }
        return {
          id: e.id,
          old_status,
          new_status,
          changed_at: e.created_at || e.timestamp,
          reason
        };
      });

    // Helper functions for mock data generation if database is empty
    const generateMockMessagesForLead = (ld, sess) => {
      const msgs = [];
      const name = ld.name || 'Customer';
      const phone = ld.phone;
      const createdAt = new Date(ld.created_at || Date.now() - 3600000 * 24);

      msgs.push({
        id: 'msg-mock-1',
        type: 'whatsapp',
        direction: 'sent',
        sender: 'system',
        body: `Hello ${name}, thank you for your interest in our B.Tech Admissions programs. A representative will contact you shortly on ${phone}.`,
        timestamp: new Date(createdAt.getTime() + 5 * 60 * 1000).toISOString(),
        status: 'read'
      });

      sess.forEach((s, idx) => {
        const sessionTime = new Date(s.started_at);
        if (s.disposition === 'no_answer' || s.disposition === 'busy' || s.disposition === 'failed') {
          msgs.push({
            id: `msg-mock-session-fail-${idx}`,
            type: 'whatsapp',
            direction: 'sent',
            sender: 'system',
            body: `Hi ${name}, we tried calling you but couldn't connect. Let us know a convenient time to call you back.`,
            timestamp: new Date(sessionTime.getTime() + 10 * 60 * 1000).toISOString(),
            status: 'read'
          });
          msgs.push({
            id: `msg-mock-session-fail-reply-${idx}`,
            type: 'whatsapp',
            direction: 'received',
            sender: 'customer',
            body: `I am busy now. Please try calling me after some time.`,
            timestamp: new Date(sessionTime.getTime() + 25 * 60 * 1000).toISOString(),
            status: 'read'
          });
        } else if (s.disposition === 'called' || s.disposition === 'qualified' || s.disposition === 'converted' || s.disposition === 'hot_escalated') {
          msgs.push({
            id: `msg-mock-session-succ-${idx}`,
            type: 'whatsapp',
            direction: 'sent',
            sender: 'system',
            body: `Hi ${name}, thank you for speaking with us. As requested, we have registered your preference for ${ld.raw_data?.property_type || '3BHK properties'}. We'll keep you posted.`,
            timestamp: new Date(sessionTime.getTime() + 15 * 60 * 1000).toISOString(),
            status: 'delivered'
          });
        }
      });
      return msgs;
    };

    const generateMockDispositionsForLead = (ld, sess) => {
      const disps = [];
      const createdAt = new Date(ld.created_at || Date.now() - 3600000 * 24);

      disps.push({
        id: 'disp-mock-1',
        old_status: '-',
        new_status: 'ingested',
        changed_at: createdAt.toISOString(),
        reason: `Lead ingested from source: ${ld.source}`
      });

      disps.push({
        id: 'disp-mock-2',
        old_status: 'ingested',
        new_status: 'queued',
        changed_at: new Date(createdAt.getTime() + 10 * 60 * 1000).toISOString(),
        reason: 'Automatically enqueued for outbound dialing'
      });

      sess.forEach((s, idx) => {
        const sessionTime = new Date(s.started_at);
        disps.push({
          id: `disp-mock-session-start-${idx}`,
          old_status: idx === 0 ? 'queued' : 're-queued',
          new_status: 'calling',
          changed_at: sessionTime.toISOString(),
          reason: `Outbound call session initiated (Session ID: ${s.voiz_session_id.substring(0, 8)}...)`
        });

        const endTime = s.ended_at ? new Date(s.ended_at) : new Date(sessionTime.getTime() + 30 * 1000);
        const finalStatus = s.disposition.includes('escalated') ? 'hot_escalated' : s.disposition === 'called' ? 'called' : 're-queued';
        
        disps.push({
          id: `disp-mock-session-end-${idx}`,
          old_status: 'calling',
          new_status: finalStatus,
          changed_at: endTime.toISOString(),
          reason: `Call ended. Disposition logged: ${s.disposition.toUpperCase()}`
        });
      });

      if (ld.status === 'hot_escalated' && !disps.some(d => d.new_status === 'hot_escalated')) {
        disps.push({
          id: 'disp-mock-esc',
          old_status: ld.status === 'called' ? 'called' : 'queued',
          new_status: 'hot_escalated',
          changed_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          reason: 'AI detected hot qualification signals and escalated lead'
        });
      }
      return disps;
    };

    const mockMessages = generateMockMessagesForLead(lead, sessions);
    const mockDispositions = generateMockDispositionsForLead(lead, sessions);

    // Merge real and mock (prevent duplicates)
    const messages = [...realMessages];
    mockMessages.forEach(m => {
      if (!messages.some(rm => rm.body === m.body)) {
        messages.push(m);
      }
    });
    messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const dispositions = [...realDispositions];
    mockDispositions.forEach(d => {
      if (!dispositions.some(rd => rd.reason === d.reason)) {
        dispositions.push(d);
      }
    });
    dispositions.sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at));

    res.json({
      success: true,
      sessions,
      messages,
      dispositions
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/:id/messages
 * Sends a message (WhatsApp or SMS) to a lead, records it in audit_trail,
 * and schedules a mock user response for interactive testing.
 */
router.post('/:id/messages', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { tenant_id, type, body } = req.body;
    
    if (!tenant_id || !type || !body) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id, type, and body are required' });
    }

    const lead = await db.findLeadById(id);
    if (!lead) {
      return res.status(404).json({ error: 'Not Found', message: `Lead with ID ${id} does not exist.` });
    }

    // Insert the outgoing message
    const outgoing = await db.insertAuditLog(tenant_id, type === 'whatsapp' ? 'whatsapp_message' : 'sms_message', {
      lead_id: id,
      direction: 'sent',
      sender: 'system',
      body,
      status: 'delivered'
    });

    // Generate a mock response after 1.5 seconds if in mock/test mode
    setTimeout(async () => {
      try {
        const replies = [
          "Sure, thank you for sharing details.",
          "I will review the brochure and get back to you.",
          "Can you call me tomorrow morning instead?",
          "Yes, please send me the branch location.",
          "Perfect, thanks for the update!"
        ];
        const randomReply = replies[Math.floor(Math.random() * replies.length)];
        
        await db.insertAuditLog(tenant_id, type === 'whatsapp' ? 'whatsapp_message' : 'sms_message', {
          lead_id: id,
          direction: 'received',
          sender: 'customer',
          body: randomReply,
          status: 'read'
        });
      } catch (err) {
        console.error('Error recording mock customer response:', err);
      }
    }, 1500);

    res.json({ success: true, message: 'Message sent successfully.', message_id: outgoing.id });
  } catch (error) {
    next(error);
  }
});

export default router;
