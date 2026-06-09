import { startMockCallSession } from './voizMockServer.js';

/**
 * Normalizes a raw event from VOIZ into a standardized LEADX event.
 * @param {object} rawEvent Raw webhook payload from VOIZ.
 * @returns {object} Standardized event object.
 */
export function normaliseEvent(rawEvent) {
  return {
    tenant_id: rawEvent.tenant_id,
    session_id: rawEvent.session_id, // Resolved in controller
    event_type: rawEvent.event_type,
    payload: rawEvent.payload || {},
    timestamp: rawEvent.timestamp || new Date().toISOString()
  };
}

/**
 * Initializes a new call session with VOIZ.
 * @param {object} lead The lead record from the database.
 * @param {object} scriptContext Conversational scripts and configurations.
 * @param {string} webhookUrl Webhook callback URL for event stream.
 */
export function initSession(lead, scriptContext, webhookUrl) {
  // Call the mock VOIZ session initiator
  return startMockCallSession(
    lead.tenant_id,
    lead.id,
    lead.phone,
    lead.name || 'Unknown User',
    webhookUrl
  );
}

export default {
  normaliseEvent,
  initSession
};
