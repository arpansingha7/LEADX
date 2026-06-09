import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Simulates a VOIZ agent telephony call stream.
 * Schedules a sequence of events to be POSTed to the webhook callback URL.
 * @param {string} tenantId Tenant ID.
 * @param {string} leadId Lead ID.
 * @param {string} phone Lead phone number.
 * @param {string} name Lead name.
 * @param {string} webhookUrl Webhook callback URL on the LEADX platform.
 */
export function startMockCallSession(tenantId, leadId, phone, name, webhookUrl) {
  const voizSessionId = 'voiz-sess-' + uuidv4().substring(0, 8);

  const events = [
    {
      event_type: 'call_started',
      payload: {
        voiz_session_id: voizSessionId,
        agent_id: 'VOIZ-01',
        agent_name: 'Kavita',
        status: 'in_progress',
        direction: 'outbound',
        timestamp: new Date().toISOString()
      }
    },
    {
      event_type: 'qualification_intent',
      payload: {
        voiz_session_id: voizSessionId,
        transcript: 'Yes, I am interested in your financial loan schemes, can you share details?',
        sentiment: 'positive',
        intent_detected: 'loan_interest',
        timestamp: new Date().toISOString()
      }
    },
    {
      event_type: 'objection_raised',
      payload: {
        voiz_session_id: voizSessionId,
        transcript: 'But what are the annual interest rates? I do not want high charges.',
        objection_type: 'pricing',
        timestamp: new Date().toISOString()
      }
    },
    {
      event_type: 'escalation_triggered',
      payload: {
        voiz_session_id: voizSessionId,
        transcript: 'I want to speak with a human supervisor to negotiate this further.',
        reason: 'human_negotiation_requested',
        escalation_priority: 'high',
        timestamp: new Date().toISOString()
      }
    },
    {
      event_type: 'call_ended',
      payload: {
        voiz_session_id: voizSessionId,
        disposition: 'qualified_escalated',
        call_duration_seconds: 45,
        summary: 'Lead expressed high interest but requested supervisor negotiation for custom rates.',
        timestamp: new Date().toISOString()
      }
    }
  ];

  // Dispatch events sequentially with a 2-second delay
  events.forEach((event, index) => {
    setTimeout(async () => {
      try {
        const payload = {
          tenant_id: tenantId,
          lead_id: leadId,
          phone: phone,
          name: name,
          ...event
        };
        
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          console.error(`Mock VOIZ Webhook failed to dispatch event ${event.event_type}: status ${response.status}`);
        }
      } catch (err) {
        console.error(`Error dispatching mock VOIZ event ${event.event_type}:`, err.message);
      }
    }, index * 2000);
  });

  return { voiz_session_id: voizSessionId, status: 'initiated' };
}

export default {
  startMockCallSession
};
