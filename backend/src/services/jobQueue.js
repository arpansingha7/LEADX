import db from '../config/db.js';
import { validateLead, cleanPhone } from '../utils/validation.js';
import { computeLeadScore } from './scoringEngine.js';
import { syncToCRM } from './crmService.js';
import { enqueueLead } from './queueService.js';
import { sendSlackNotification } from './slackService.js';

let workerInterval = null;
let isProcessing = false;

/**
 * Process a batch ingestion job.
 */
async function processBatchIngest(job) {
  const { tenant_id, leads, dataset_id, campaign_name, campaign_id } = job.payload;
  
  const weights = await db.getWeights(tenant_id);

  // Pre-validation pass (All-or-nothing)
  const validationErrors = [];
  const batchPhones = new Set();
  const leadsToProcess = [];

  for (let i = 0; i < leads.length; i++) {
    const item = leads[i];
    const leadPayload = { ...item, tenant_id };

    if (!item.client_id) {
      validationErrors.push({ index: i, errors: ["Missing required column/mapping: client_id"] });
      continue;
    }

    const val = validateLead(leadPayload);
    if (!val.isValid) {
      validationErrors.push({ index: i, errors: val.errors });
      continue;
    }

    const cleaned = cleanPhone(item.phone);
    if (batchPhones.has(cleaned)) {
      validationErrors.push({ index: i, errors: ["Duplicate phone number within the batch"] });
      continue;
    }
    batchPhones.add(cleaned);

    leadPayload.phone = cleaned;
    leadPayload.dataset_id = dataset_id || 'batch-upload';
    leadPayload.campaign_name = campaign_name || 'Batch Campaigns';
    leadPayload.client_id = item.client_id;
    
    leadsToProcess.push({ index: i, payload: leadPayload });
  }

  if (validationErrors.length > 0) {
    return {
      success: false,
      error: 'Batch Validation Failed',
      details: validationErrors
    };
  }

  let accepted = 0;
  let appended = 0;
  const details = [];

  for (const { index, payload } of leadsToProcess) {
    try {
      const existing = await db.findLeadByPhone(tenant_id, payload.phone);
      if (existing) {
        const newCampaign = campaign_name || 'Batch Campaigns';
        const currentCampaigns = existing.campaign_name ? existing.campaign_name.split(',').map(c => c.trim()) : [];
        
        existing.raw_data = existing.raw_data || {};
        if (!existing.raw_data.leadx_id) {
          existing.raw_data.leadx_id = payload.raw_data?.leadx_id || 'ldx_' + Math.random().toString(36).substr(2, 9);
        }
        
        const mostRecentCampaignId = payload.raw_data?.campaign_id || 'cmp_' + Math.random().toString(36).substr(2, 9);
        existing.raw_data.campaign_id = mostRecentCampaignId;

        if (!currentCampaigns.includes(newCampaign)) {
          currentCampaigns.push(newCampaign);
          await db.updateLeadCampaignAndData(existing.id, currentCampaigns.join(', '), existing.raw_data);
          appended++;
          details.push({ index, phone: payload.phone, status: 'appended', lead_id: existing.id });
        } else {
          await db.updateLeadCampaignAndData(existing.id, currentCampaigns.join(', '), existing.raw_data);
          details.push({ index, phone: payload.phone, status: 'duplicate_skipped' });
        }

        if (existing.raw_data?.hubspot_id || existing.email) {
          syncToCRM(tenant_id, existing, 'hubspot').catch(err => {
            console.error('[Ingestion Sync-Back] Failed to sync duplicate lead to HubSpot:', existing.id, err);
          });
        }
        continue;
      }

      const score = computeLeadScore(payload, weights);
      payload.score = score;

      payload.raw_data = payload.raw_data || {};
      if (!payload.raw_data.leadx_id) {
        payload.raw_data.leadx_id = 'ldx_' + Math.random().toString(36).substr(2, 9);
      }
      if (!payload.raw_data.campaign_id) {
        payload.raw_data.campaign_id = 'cmp_' + Math.random().toString(36).substr(2, 9);
      }

      const saved = await db.insertLead(payload);
      
      await enqueueLead(saved.id, score);

      if (saved.raw_data?.hubspot_id || saved.email) {
        syncToCRM(tenant_id, saved, 'hubspot').catch(err => {
          console.error('[Ingestion Sync-Back] Failed to sync to HubSpot for lead', saved.id, err);
        });
      }

      accepted++;
      details.push({ index, phone: payload.phone, status: 'accepted', lead_id: saved.id, score: saved.score });
    } catch (dbError) {
      console.error('Database error in batch processing:', dbError);
    }
  }

  await db.insertAuditLog(tenant_id, 'batch_leads_ingested', {
    dataset_id: dataset_id || 'batch-upload',
    campaign_name: campaign_name || 'Batch Campaigns',
    accepted,
    appended
  });

  await sendSlackNotification(`[Ingestion Alert] Bulk leads uploaded: ${accepted} ingested, ${appended} appended for campaign "${campaign_name || 'Batch Campaigns'}".`);

  if (campaign_id) {
    await db.updateCampaign(campaign_id, {
      status: 'active',
      ingested: accepted,
      connected: 0
    });
  }

  return {
    success: true,
    summary: { accepted, appended, total: leads.length },
    details
  };
}

/**
 * Fetch and process the next pending job.
 */
export async function processNextJob() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const job = await db.fetchNextPendingJob();
    if (!job) {
      isProcessing = false;
      return;
    }

    console.log(`[JobQueue] Starting job ${job.id} of type ${job.job_type}`);
    await db.updateJobStatus(job.id, 'processing');

    let result = null;
    try {
      if (job.job_type === 'batch_ingest') {
        result = await processBatchIngest(job);
      } else {
        throw new Error(`Unknown job type: ${job.job_type}`);
      }
      
      await db.updateJobStatus(job.id, result.success ? 'completed' : 'failed', result);
      console.log(`[JobQueue] Completed job ${job.id}`);
    } catch (err) {
      console.error(`[JobQueue] Error processing job ${job.id}:`, err);
      await db.updateJobStatus(job.id, 'failed', { error: err.message });
    }
  } catch (err) {
    console.error('[JobQueue] Error fetching job:', err);
  } finally {
    isProcessing = false;
  }
}

/**
 * Enqueue a new background job.
 */
export async function enqueueJob(tenant_id, type, payload) {
  return await db.insertJob(tenant_id, type, payload);
}

/**
 * Start the background worker polling.
 */
export function startWorker(intervalMs = 5000) {
  if (workerInterval) return;
  console.log(`[JobQueue] Starting background worker (interval: ${intervalMs}ms)`);
  workerInterval = setInterval(processNextJob, intervalMs);
}

export function stopWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log('[JobQueue] Stopped background worker');
  }
}
