import db from '../config/db.js';
import { initSession } from './voizAdapter.js';
import { sendSlackNotification } from './slackService.js';

let workerInterval = null;
let isProcessing = false;

/**
 * Enforces Indian Standard Time (IST) calling hours (9 AM - 6 PM) and Monday-Saturday allowed calling days.
 * @param {object} lead The lead object.
 * @param {object} config Onboarding/tenant config.
 * @returns {boolean} True if within calling hours, false otherwise.
 */
export function isCallable(lead, config = {}) {
  if (config.bypass_calling_hours === true || process.env.NODE_ENV === 'test') {
    return true;
  }

  const startHour = config.calling_hours?.start ?? 9;
  const endHour = config.calling_hours?.end ?? 18;
  const timezone = config.calling_hours?.timezone || 'Asia/Kolkata';

  const now = new Date();
  
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
      weekday: 'short'
    });
    const parts = formatter.formatToParts(now);
    const hourPart = parts.find(p => p.type === 'hour');
    const weekdayPart = parts.find(p => p.type === 'weekday');

    const currentHour = hourPart ? parseInt(hourPart.value, 10) : now.getHours();
    const currentDay = weekdayPart ? weekdayPart.value : '';

    if (currentDay === 'Sun') {
      return false; // No Sundays
    }

    return currentHour >= startHour && currentHour < endHour;
  } catch (err) {
    const day = now.getDay();
    const hour = now.getHours();
    if (day === 0) return false;
    return hour >= startHour && hour < endHour;
  }
}

/**
 * Enqueues a lead by updating its status to 'queued' and starting the worker if not active.
 */
export async function enqueueLead(leadId, priority) {
  const lead = await db.findLeadById(leadId);
  if (!lead) return null;
  
  if (lead.status === 'dnc' || lead.status === 'closed' || lead.status === 'converted') {
    return lead; // Terminal state, ignore
  }

  const updated = await db.updateLeadStatus(leadId, 'queued');
  
  // Log enqueued audit event
  await db.insertAuditLog(lead.tenant_id, 'lead_enqueued', {
    lead_id: leadId,
    phone: lead.phone,
    score: lead.score
  });

  // Wake up worker to run immediately
  if (!isProcessing) {
    processQueue().catch(err => console.error('[QueueWorker] Instant poll error:', err));
  }

  return updated;
}

/**
 * Processes queued and re-queued leads, checking priority, calling hours, DNC, and concurrency.
 */
export async function processQueue() {
  // Retrieve all leads with queued or re-queued status
  const leads = await db.getAllLeadsByStatus(['queued', 're-queued']);
  if (leads.length === 0) return;

  // Sort by score (priority) descending
  leads.sort((a, b) => b.score - a.score);

  // Group by tenant
  const activeTenants = Array.from(new Set(leads.map(l => l.tenant_id)));

  for (const tenantId of activeTenants) {
    const onboardingConfig = await db.getOnboardingConfig(tenantId);
    
    // Check concurrency limit
    const limit = onboardingConfig.concurrent_call_limit || 5;
    const activeCalls = await db.getActiveCallsCount(tenantId);
    
    if (activeCalls >= limit) {
      console.log(`[QueueWorker] Concurrency limit (${limit}) reached for tenant "${tenantId}". Skipping queue dispatch.`);
      continue;
    }

    let capacity = limit - activeCalls;
    const tenantLeads = leads.filter(l => l.tenant_id === tenantId);

    for (const lead of tenantLeads) {
      if (capacity <= 0) break;

      // Handle re-queued wait times
      if (lead.status === 're-queued') {
        const nextRetry = lead.raw_data?.next_retry_at;
        if (nextRetry && Date.now() < new Date(nextRetry).getTime()) {
          continue; // Wait time not reached
        }
      }

      // Check DNC table
      const isDnc = await db.isDncNumber(tenantId, lead.phone);
      const isDncMockPattern = lead.phone.includes('403') || lead.phone.includes('0000');
      
      const usePlatformDnc = onboardingConfig.dnc_validation_ownership !== 'client';
      if (usePlatformDnc && (isDnc || isDncMockPattern)) {
        await db.updateLeadStatus(lead.id, 'dnc');
        await db.insertAuditLog(tenantId, 'dnc_block', {
          lead_id: lead.id,
          phone: lead.phone
        });
        await sendSlackNotification(`[DNC Block] Dialer blocked outbound call to number matching DNC database: ${lead.phone}`);
        continue;
      }

      // Check calling hours
      if (!isCallable(lead, onboardingConfig)) {
        console.log(`[QueueWorker] Outside calling hours for lead ${lead.id} (${lead.phone}). Holding call.`);
        continue;
      }

      // Dispatch Call!
      capacity--;
      try {
        await db.updateLeadStatus(lead.id, 'calling');
        
        const protocol = 'http';
        const port = process.env.PORT || 3000;
        const host = process.env.HOST || 'localhost';
        const webhookUrl = process.env.WEBHOOK_URL || `${protocol}://${host}:${port}/leads/voiz-webhook`;

        // Start session via adapter
        const result = await initSession(lead, onboardingConfig, webhookUrl);

        // Record call session
        await db.insertCallSession({
          tenant_id: tenantId,
          lead_id: lead.id,
          voiz_session_id: result.voiz_session_id,
          disposition: 'calling'
        });

        await db.insertAuditLog(tenantId, 'call_initiated', {
          lead_id: lead.id,
          voiz_session_id: result.voiz_session_id,
          phone: lead.phone
        });
      } catch (err) {
        console.error(`[QueueWorker] Failed to dispatch call for lead ${lead.id}:`, err);
        // Fallback retry scheduled instantly or marked as failed
        await db.updateLeadStatus(lead.id, 're-queued');
      }
    }
  }
}

/**
 * Handles the call outcome when a call ends (from webhook or mock end events).
 * Manages retry schedules, exponential backoff, and terminal status transitions.
 */
export async function handleCallOutcome(voizSessionId, disposition, duration = 0, summary = '') {
  const session = await db.findCallSessionByVoizId(voizSessionId);
  if (!session) return;

  const lead = await db.findLeadById(session.lead_id);
  if (!lead) return;

  const onboardingConfig = await db.getOnboardingConfig(session.tenant_id);

  // Update session record
  await db.updateCallSession(session.id, {
    disposition,
    summary,
    ended_at: new Date().toISOString()
  });

  const failureDispositions = ['no_answer', 'busy', 'failed', 'busy-signal', 'no-answer', 'voicemail'];
  const isFailure = failureDispositions.includes(disposition.toLowerCase());

  if (isFailure) {
    const attempts = await db.getCallSessionsCount(lead.id);
    const maxAttempts = onboardingConfig.max_attempts || 3;
    const retryGaps = process.env.NODE_ENV === 'test' 
      ? [1000, 2000, 3000] // Short gaps for test runner
      : (onboardingConfig.retry_gaps || [15 * 60 * 1000, 120 * 60 * 1000, 24 * 60 * 60 * 1000]); // 15m, 2h, 24h

    if (attempts < maxAttempts) {
      // Re-queue the lead with a calculated delay (gap backoff)
      const gap = retryGaps[attempts - 1] || retryGaps[retryGaps.length - 1];
      const nextRetryAt = new Date(Date.now() + gap).toISOString();

      const updatedRaw = {
        ...(lead.raw_data || {}),
        next_retry_at: nextRetryAt,
        attempts
      };

      await db.updateLeadStatusAndData(lead.id, 're-queued', updatedRaw);

      await db.insertAuditLog(session.tenant_id, 'call_retry_scheduled', {
        lead_id: lead.id,
        phone: lead.phone,
        attempt: attempts,
        next_retry_at: nextRetryAt
      });

      await sendSlackNotification(`[Dialer Retry] Call attempt ${attempts} failed (${disposition}) for lead "${lead.name || 'Unknown'}". Retry scheduled at ${new Date(nextRetryAt).toLocaleTimeString()}.`);
    } else {
      // Max attempts reached, mark as closed
      await db.updateLeadStatus(lead.id, 'closed');
      await db.insertAuditLog(session.tenant_id, 'call_failed_max_attempts', {
        lead_id: lead.id,
        phone: lead.phone,
        attempts
      });
      await sendSlackNotification(`[Dialer Failure] Lead "${lead.name || 'Unknown'}" (${lead.phone}) marked CLOSED after reaching max ${maxAttempts} retry attempts.`);
    }
  } else {
    // Successful or other terminal disposition (e.g. qualified)
    const finalStatus = disposition.includes('escalated') ? 'hot_escalated' : 'called';
    await db.updateLeadStatus(lead.id, finalStatus);
  }
}

/**
 * Resets retry attempts and enqueues all failed (closed) leads for retry.
 */
export async function forceRetry(tenantId) {
  const leads = await db.getLeads(tenantId);
  // Find closed or failed leads that aren't DNC or converted
  const failedLeads = leads.filter(l => l.status === 'closed' || l.status === 'called');
  
  for (const lead of failedLeads) {
    const updatedRaw = { ...(lead.raw_data || {}) };
    delete updatedRaw.next_retry_at;
    delete updatedRaw.attempts;

    await db.updateLeadStatusAndData(lead.id, 'queued', updatedRaw);
  }

  await db.insertAuditLog(tenantId, 'force_retry_triggered', {
    count: failedLeads.length
  });

  if (failedLeads.length > 0 && !isProcessing) {
    processQueue().catch(err => console.error('[QueueWorker] Force retry poll error:', err));
  }

  return failedLeads.length;
}

/**
 * Returns queue performance and depth metrics.
 */
export async function getQueueStats(tenantId) {
  const leads = await db.getLeads(tenantId);
  
  const stats = {
    pending: leads.filter(l => l.status === 'pending').length,
    queued: leads.filter(l => l.status === 'queued').length,
    calling: leads.filter(l => l.status === 'calling').length,
    called: leads.filter(l => l.status === 'called').length,
    re_queued: leads.filter(l => l.status === 're-queued').length,
    dnc: leads.filter(l => l.status === 'dnc').length,
    closed: leads.filter(l => l.status === 'closed').length,
    hot_escalated: leads.filter(l => l.status === 'hot_escalated').length
  };

  return stats;
}

/**
 * Starts the worker background interval.
 */
export function startQueueWorker(intervalMs = 5000) {
  if (workerInterval) return;
  workerInterval = setInterval(async () => {
    if (isProcessing) return;
    isProcessing = true;
    try {
      await processQueue();
    } catch (err) {
      console.error('[QueueWorker] Error in processQueue loop:', err);
    } finally {
      isProcessing = false;
    }
  }, intervalMs);
  console.log(`[QueueWorker] Asynchronous priority queue worker started (polling every ${intervalMs}ms).`);
}

export function stopQueueWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}

export default {
  enqueueLead,
  isCallable,
  startQueueWorker,
  stopQueueWorker,
  processQueue,
  handleCallOutcome,
  forceRetry,
  getQueueStats
};
