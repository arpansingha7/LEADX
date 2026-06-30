import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const isTestRunnerActive = process.env.NODE_ENV === 'test' || process.argv.some(arg => arg.includes('test') || arg.includes('--test'));
const isSupabaseConfigured = !!(supabaseUrl && supabaseKey) && !isTestRunnerActive;

let supabase = null;
if (isSupabaseConfigured) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('Successfully initialized live Supabase client.');
  } catch (error) {
    console.error('Failed to initialize Supabase client:', error);
  }
} else {
  console.log('Supabase credentials not set. Running in offline MOCK database mode.');
}

// In-Memory Database for Mock Mode
const mockDb = {
  leads: [],
  tenantConfigs: {},
  configAuditLog: [],
  callSessions: [],
  callEvents: [],
  auditTrail: [],
  dncRegistry: [],
  scripts: [],
  agentBriefs: [],
  jobs: []
};

// Seed default configs for tenant 'default-tenant' and 'test-tenant'
const DEFAULT_WEIGHTS = {
  demographic_fit: 0.25,
  source_quality: 0.25,
  recency: 0.20,
  behavioural_signals: 0.15,
  prior_interaction: 0.15
};

mockDb.tenantConfigs['default-tenant'] = {
  tenant_id: 'default-tenant',
  scoring_weights: { ...DEFAULT_WEIGHTS },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

mockDb.tenantConfigs['test-tenant'] = {
  tenant_id: 'test-tenant',
  scoring_weights: { ...DEFAULT_WEIGHTS },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

const db = {
  isMock: !supabase,

  async getWeights(tenantId) {
    if (supabase) {
      const { data, error } = await supabase
        .from('tenant_configs')
        .select('scoring_weights')
        .eq('tenant_id', tenantId)
        .single();
      
      if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows returned"
        throw error;
      }
      return data ? data.scoring_weights : DEFAULT_WEIGHTS;
    } else {
      const config = mockDb.tenantConfigs[tenantId];
      return config ? config.scoring_weights : DEFAULT_WEIGHTS;
    }
  },

  async upsertWeights(tenantId, weights, changedBy = 'system') {
    const oldWeights = await this.getWeights(tenantId);
    if (supabase) {
      // Upsert weights
      const { error: upsertError } = await supabase
        .from('tenant_configs')
        .upsert({
          tenant_id: tenantId,
          scoring_weights: weights,
          updated_at: new Date().toISOString()
        }, { onConflict: 'tenant_id' });
      if (upsertError) throw upsertError;

      // Log config change
      const { error: logError } = await supabase
        .from('config_audit_log')
        .insert({
          tenant_id: tenantId,
          changed_by: changedBy,
          config_type: 'scoring_weights',
          old_value: oldWeights,
          new_value: weights
        });
      if (logError) throw logError;
    } else {
      mockDb.tenantConfigs[tenantId] = {
        tenant_id: tenantId,
        scoring_weights: weights,
        created_at: mockDb.tenantConfigs[tenantId]?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      mockDb.configAuditLog.push({
        id: uuidv4(),
        tenant_id: tenantId,
        changed_by: changedBy,
        config_type: 'scoring_weights',
        old_value: oldWeights,
        new_value: weights,
        changed_at: new Date().toISOString()
      });
    }
  },

  async findLeadByPhone(tenantId, phone) {
    if (supabase) {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('phone', phone)
        .maybeSingle();
      if (error) throw error;
      return data;
    } else {
      return mockDb.leads.find(l => l.tenant_id === tenantId && l.phone === phone) || null;
    }
  },

  async findLeadById(id) {
    if (supabase) {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data;
    } else {
      return mockDb.leads.find(l => l.id === id) || null;
    }
  },

  async insertLead(lead) {
    const leadId = lead.id || uuidv4();
    const newLead = {
      id: leadId,
      tenant_id: lead.tenant_id,
      name: lead.name || null,
      phone: lead.phone,
      email: lead.email || null,
      source: lead.source,
      raw_data: lead.raw_data || {},
      score: lead.score || 0,
      status: lead.status || 'ingested',
      dataset_id: lead.dataset_id || null,
      campaign_name: lead.campaign_name || null,
      client_id: lead.client_id || null,
      created_at: lead.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (supabase) {
      const { data, error } = await supabase
        .from('leads')
        .insert(newLead)
        .select()
        .single();
      if (error) {
        if (error.code === '23505' || error.message?.includes('duplicate key value violates unique constraint')) {
          const err = new Error('Duplicate lead found');
          err.code = '23505';
          throw err;
        }
        throw error;
      }
      return data;
    } else {
      // Check duplicate
      const duplicate = mockDb.leads.find(
        l => l.tenant_id === newLead.tenant_id && l.phone === newLead.phone
      );
      if (duplicate) {
        const err = new Error('Duplicate lead found');
        err.code = '23505';
        throw err;
      }
      mockDb.leads.push(newLead);
      return newLead;
    }
  },

  async updateLeadScore(id, score) {
    if (supabase) {
      const { data, error } = await supabase
        .from('leads')
        .update({ score, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const lead = mockDb.leads.find(l => l.id === id);
      if (!lead) throw new Error('Lead not found');
      lead.score = score;
      lead.updated_at = new Date().toISOString();
      return lead;
    }
  },

  async updateLeadStatus(id, status) {
    let oldStatus = 'unknown';
    let tenantId = null;
    try {
      const lead = await this.findLeadById(id);
      if (lead) {
        oldStatus = lead.status;
        tenantId = lead.tenant_id;
      }
    } catch (err) {
      console.error('Error finding lead for status update audit:', err);
    }

    let result;
    if (supabase) {
      const { data, error } = await supabase
        .from('leads')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      result = data;
    } else {
      const lead = mockDb.leads.find(l => l.id === id);
      if (!lead) throw new Error('Lead not found');
      lead.status = status;
      lead.updated_at = new Date().toISOString();
      result = lead;
    }

    if (tenantId && oldStatus !== status) {
      try {
        let reason = `Status transitioned from ${oldStatus} to ${status}`;
        if (status === 'queued') reason = 'Lead enqueued for dialing';
        else if (status === 'calling') reason = 'Call initiated by outbound system';
        else if (status === 'called') reason = 'Call completed';
        else if (status === 'dnc') reason = 'DNC registration matched and blocked';
        else if (status === 'closed') reason = 'Lead closed (max dial attempts reached)';
        else if (status === 'hot_escalated') reason = 'AI detected high intent and escalated lead';

        await this.insertAuditLog(tenantId, 'disposition_changed', {
          lead_id: id,
          old_status: oldStatus,
          new_status: status,
          reason,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        console.error('Failed to insert disposition_changed audit log:', err);
      }
    }

    return result;
  },

  async updateLeadStatusAndData(id, status, rawData) {
    let oldStatus = 'unknown';
    let tenantId = null;
    try {
      const lead = await this.findLeadById(id);
      if (lead) {
        oldStatus = lead.status;
        tenantId = lead.tenant_id;
      }
    } catch (err) {
      console.error('Error finding lead for status update audit:', err);
    }

    let result;
    if (supabase) {
      const { data, error } = await supabase
        .from('leads')
        .update({ status, raw_data: rawData, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      result = data;
    } else {
      const lead = mockDb.leads.find(l => l.id === id);
      if (!lead) throw new Error('Lead not found');
      lead.status = status;
      lead.raw_data = rawData;
      lead.updated_at = new Date().toISOString();
      result = lead;
    }

    if (tenantId && oldStatus !== status) {
      try {
        let reason = `Status transitioned from ${oldStatus} to ${status}`;
        if (status === 're-queued') reason = `Call failed or busy. Re-queued for retry (Attempt: ${rawData.attempts || 1})`;
        
        await this.insertAuditLog(tenantId, 'disposition_changed', {
          lead_id: id,
          old_status: oldStatus,
          new_status: status,
          reason,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        console.error('Failed to insert disposition_changed audit log:', err);
      }
    }

    return result;
  },

  async getLeadInteractions(tenantId, leadId) {
    if (supabase) {
      const { data, error } = await supabase
        .from('audit_trail')
        .select('*')
        .eq('tenant_id', tenantId)
        .filter('details->>lead_id', 'eq', leadId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    } else {
      return mockDb.auditTrail
        .filter(a => a.tenant_id === tenantId && a.details && a.details.lead_id === leadId)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    }
  },

  async updateLeadCampaign(id, campaign_name) {
    if (supabase) {
      const { data, error } = await supabase
        .from('leads')
        .update({ campaign_name, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const lead = mockDb.leads.find(l => l.id === id);
      if (!lead) throw new Error('Lead not found');
      lead.campaign_name = campaign_name;
      lead.updated_at = new Date().toISOString();
      return lead;
    }
  },

  async updateLeadCampaignAndData(id, campaign_name, raw_data) {
    if (supabase) {
      const { data, error } = await supabase
        .from('leads')
        .update({ campaign_name, raw_data, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const lead = mockDb.leads.find(l => l.id === id);
      if (!lead) throw new Error('Lead not found');
      lead.campaign_name = campaign_name;
      lead.raw_data = raw_data;
      lead.updated_at = new Date().toISOString();
      return lead;
    }
  },

  async getAllLeadsByStatus(statuses) {
    if (supabase) {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .in('status', statuses);
      if (error) throw error;
      return data;
    } else {
      return mockDb.leads.filter(l => statuses.includes(l.status));
    }
  },

  async getActiveCallsCount(tenantId) {
    if (supabase) {
      const { count, error } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'calling');
      if (error) throw error;
      return count || 0;
    } else {
      return mockDb.leads.filter(l => l.tenant_id === tenantId && l.status === 'calling').length;
    }
  },

  async getCallSessionsCount(leadId) {
    if (supabase) {
      const { count, error } = await supabase
        .from('call_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('lead_id', leadId);
      if (error) throw error;
      return count || 0;
    } else {
      return mockDb.callSessions.filter(s => s.lead_id === leadId).length;
    }
  },
  async getLeads(tenantId) {
    if (supabase) {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    } else {
      return mockDb.leads
        .filter(l => l.tenant_id === tenantId)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  },

  async getOnboardingConfig(tenantId) {
    if (supabase) {
      const { data, error } = await supabase
        .from('tenant_configs')
        .select('onboarding_config')
        .eq('tenant_id', tenantId)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return data ? data.onboarding_config : {};
    } else {
      const config = mockDb.tenantConfigs[tenantId];
      return config ? config.onboarding_config || {} : {};
    }
  },

  async upsertOnboardingConfig(tenantId, config) {
    if (supabase) {
      const { error } = await supabase
        .from('tenant_configs')
        .upsert({
          tenant_id: tenantId,
          onboarding_config: config,
          updated_at: new Date().toISOString()
        }, { onConflict: 'tenant_id' });
      if (error) throw error;
    } else {
      if (!mockDb.tenantConfigs[tenantId]) {
        mockDb.tenantConfigs[tenantId] = {
          tenant_id: tenantId,
          scoring_weights: { ...DEFAULT_WEIGHTS },
          created_at: new Date().toISOString()
        };
      }
      mockDb.tenantConfigs[tenantId].onboarding_config = config;
      mockDb.tenantConfigs[tenantId].updated_at = new Date().toISOString();
    }
  },

  async insertAuditLog(tenantId, eventType, details = {}) {
    const logEntry = {
      id: uuidv4(),
      tenant_id: tenantId,
      event_type: eventType,
      details,
      created_at: new Date().toISOString()
    };
    if (supabase) {
      const { error } = await supabase
        .from('audit_trail')
        .insert(logEntry);
      if (error) console.error('Failed to write to audit_trail in Supabase:', error);
    } else {
      mockDb.auditTrail.push(logEntry);
    }
    return logEntry;
  },

  async getAuditTrail(tenantId) {
    if (supabase) {
      const { data, error } = await supabase
        .from('audit_trail')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    } else {
      return mockDb.auditTrail
        .filter(l => l.tenant_id === tenantId)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  },

  async insertCallSession(session) {
    const sessionVal = {
      id: session.id || uuidv4(),
      tenant_id: session.tenant_id,
      lead_id: session.lead_id,
      voiz_session_id: session.voiz_session_id || null,
      script_version: session.script_version || 'v1.0',
      started_at: session.started_at || new Date().toISOString(),
      ended_at: session.ended_at || null,
      disposition: session.disposition || 'queued',
      summary: session.summary || null,
      created_at: new Date().toISOString()
    };
    if (supabase) {
      const { data, error } = await supabase
        .from('call_sessions')
        .insert(sessionVal)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      mockDb.callSessions.push(sessionVal);
      return sessionVal;
    }
  },

  async updateCallSession(sessionId, updates) {
    if (supabase) {
      const { data, error } = await supabase
        .from('call_sessions')
        .update({
          ...updates,
          ended_at: updates.ended_at || (updates.disposition && updates.disposition !== 'queued' && updates.disposition !== 'calling' ? new Date().toISOString() : null)
        })
        .eq('id', sessionId)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const session = mockDb.callSessions.find(s => s.id === sessionId);
      if (!session) throw new Error('Session not found');
      Object.assign(session, updates);
      if (updates.disposition && updates.disposition !== 'queued' && updates.disposition !== 'calling' && !session.ended_at) {
        session.ended_at = new Date().toISOString();
      }
      return session;
    }
  },

  async findCallSessionByVoizId(voizSessionId) {
    if (supabase) {
      const { data, error } = await supabase
        .from('call_sessions')
        .select('*')
        .eq('voiz_session_id', voizSessionId)
        .maybeSingle();
      if (error) throw error;
      return data;
    } else {
      return mockDb.callSessions.find(s => s.voiz_session_id === voizSessionId) || null;
    }
  },

  async getCallSessions(tenantId) {
    if (supabase) {
      const { data, error } = await supabase
        .from('call_sessions')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('started_at', { ascending: false });
      if (error) throw error;
      return data;
    } else {
      return mockDb.callSessions
        .filter(s => s.tenant_id === tenantId)
        .sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
    }
  },

  async insertCallEvent(event) {
    const eventVal = {
      id: event.id || uuidv4(),
      tenant_id: event.tenant_id,
      session_id: event.session_id,
      event_type: event.event_type,
      payload: event.payload || {},
      timestamp: event.timestamp || new Date().toISOString()
    };
    if (supabase) {
      const { data, error } = await supabase
        .from('call_events')
        .insert(eventVal)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      mockDb.callEvents.push(eventVal);
      return eventVal;
    }
  },

  async getCallEvents(tenantId, eventType = null) {
    if (supabase) {
      let query = supabase
        .from('call_events')
        .select('*')
        .eq('tenant_id', tenantId);
      
      if (eventType) {
        query = query.eq('event_type', eventType);
      }
      
      const { data, error } = await query.order('timestamp', { ascending: false });
      if (error) throw error;
      return data;
    } else {
      let events = mockDb.callEvents.filter(e => e.tenant_id === tenantId);
      if (eventType) {
        events = events.filter(e => e.event_type === eventType);
      }
      return events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }
  },

  async addDncNumber(tenantId, phone) {
    const cleaned = phone.replace(/[^0-9+]/g, '');
    if (supabase) {
      const { data, error } = await supabase
        .from('dnc_registry')
        .upsert({ tenant_id: tenantId, phone: cleaned }, { onConflict: 'tenant_id,phone' })
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const exists = mockDb.dncRegistry.some(d => d.tenant_id === tenantId && d.phone === cleaned);
      if (!exists) {
        mockDb.dncRegistry.push({
          id: uuidv4(),
          tenant_id: tenantId,
          phone: cleaned,
          created_at: new Date().toISOString()
        });
      }
      return { tenant_id: tenantId, phone: cleaned };
    }
  },

  async isDncNumber(tenantId, phone) {
    const cleaned = phone.replace(/[^0-9+]/g, '');
    if (supabase) {
      const { data, error } = await supabase
        .from('dnc_registry')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('phone', cleaned)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    } else {
      return mockDb.dncRegistry.some(d => d.tenant_id === tenantId && d.phone === cleaned);
    }
  },

  async getDncList(tenantId) {
    if (supabase) {
      const { data, error } = await supabase
        .from('dnc_registry')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    } else {
      return mockDb.dncRegistry.filter(d => d.tenant_id === tenantId);
    }
  },

  async getLeadsByStatus(tenantId, statuses) {
    if (supabase) {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('tenant_id', tenantId)
        .in('status', statuses)
        .order('score', { ascending: false });
      if (error) throw error;
      return data;
    } else {
      return mockDb.leads
        .filter(l => l.tenant_id === tenantId && statuses.includes(l.status))
        .sort((a, b) => b.score - a.score);
    }
  },

  async insertScript(script) {
    const scriptVal = {
      id: script.id || uuidv4(),
      tenant_id: script.tenant_id,
      script_id: script.script_id,
      version: script.version || '1.0',
      language: script.language || 'en',
      nodes: script.nodes || [],
      escalation_triggers: script.escalation_triggers || [],
      max_duration_seconds: script.max_duration_seconds || 300,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (supabase) {
      const { data, error } = await supabase
        .from('scripts')
        .insert(scriptVal)
        .select()
        .single();
      if (error) {
        if (error.code === '23505' || error.message?.includes('duplicate key value violates unique constraint')) {
          const err = new Error('Duplicate script version found');
          err.code = '23505';
          throw err;
        }
        throw error;
      }
      return data;
    } else {
      const exists = mockDb.scripts.some(
        s => s.tenant_id === scriptVal.tenant_id && s.script_id === scriptVal.script_id && s.version === scriptVal.version
      );
      if (exists) {
        const err = new Error('Duplicate script version found');
        err.code = '23505';
        throw err;
      }
      mockDb.scripts.push(scriptVal);
      return scriptVal;
    }
  },

  async getScript(tenantId, scriptId, version) {
    if (supabase) {
      const { data, error } = await supabase
        .from('scripts')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('script_id', scriptId)
        .eq('version', version)
        .maybeSingle();
      if (error) throw error;
      return data;
    } else {
      return mockDb.scripts.find(
        s => s.tenant_id === tenantId && s.script_id === scriptId && s.version === version
      ) || null;
    }
  },

  async getLatestScript(tenantId, scriptId) {
    if (supabase) {
      const { data, error } = await supabase
        .from('scripts')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('script_id', scriptId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    } else {
      const tenantScripts = mockDb.scripts.filter(s => s.tenant_id === tenantId && s.script_id === scriptId);
      if (tenantScripts.length === 0) return null;
      tenantScripts.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
      return tenantScripts[0];
    }
  },

  async getAllScripts(tenantId) {
    if (supabase) {
      const { data, error } = await supabase
        .from('scripts')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data;
    } else {
      return mockDb.scripts
        .filter(s => s.tenant_id === tenantId)
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    }
  },

  async upsertAgentBrief(tenantId, leadId, brief) {
    const briefVal = {
      tenant_id: tenantId,
      lead_id: leadId,
      brief: brief || {},
      updated_at: new Date().toISOString()
    };
    if (supabase) {
      const { data, error } = await supabase
        .from('agent_briefs')
        .upsert(briefVal, { onConflict: 'lead_id' })
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      let existing = mockDb.agentBriefs.find(b => b.lead_id === leadId);
      if (existing) {
        existing.brief = brief;
        existing.updated_at = new Date().toISOString();
        return existing;
      } else {
        const newBrief = {
          id: uuidv4(),
          ...briefVal,
          created_at: new Date().toISOString()
        };
        mockDb.agentBriefs.push(newBrief);
        return newBrief;
      }
    }
  },

  async getAgentBrief(leadId) {
    if (supabase) {
      const { data, error } = await supabase
        .from('agent_briefs')
        .select('*')
        .eq('lead_id', leadId)
        .maybeSingle();
      if (error) throw error;
      return data;
    } else {
      return mockDb.agentBriefs.find(b => b.lead_id === leadId) || null;
    }
  },

  async deleteCampaign(tenantId, campaignName) {
    if (supabase) {
      // Find all leads for this tenant
      const { data: allLeads, error: fetchErr } = await supabase
        .from('leads')
        .select('*')
        .eq('tenant_id', tenantId);
      if (fetchErr) throw fetchErr;

      const leadsToDelete = [];
      const leadsToUpdate = [];

      (allLeads || []).forEach(lead => {
        const campaigns = lead.campaign_name ? lead.campaign_name.split(',').map(c => c.trim()) : [];
        if (campaigns.includes(campaignName)) {
          if (campaigns.length === 1) {
            leadsToDelete.push(lead.id);
          } else {
            const updatedCampaigns = campaigns.filter(c => c !== campaignName).join(', ');
            leadsToUpdate.push({ id: lead.id, campaign_name: updatedCampaigns });
          }
        }
      });

      if (leadsToDelete.length > 0) {
        await supabase.from('agent_briefs').delete().in('lead_id', leadsToDelete);
        await supabase.from('call_events').delete().in('lead_id', leadsToDelete);
        await supabase.from('call_sessions').delete().in('lead_id', leadsToDelete);
        const { error: deleteErr } = await supabase
          .from('leads')
          .delete()
          .in('id', leadsToDelete);
        if (deleteErr) throw deleteErr;
      }

      for (const leadUpdate of leadsToUpdate) {
        await supabase
          .from('leads')
          .update({ campaign_name: leadUpdate.campaign_name, updated_at: new Date().toISOString() })
          .eq('id', leadUpdate.id);
      }
    } else {
      const leadsToDelete = [];
      const leadsToUpdate = [];

      mockDb.leads.forEach(lead => {
        if (lead.tenant_id === tenantId) {
          const campaigns = lead.campaign_name ? lead.campaign_name.split(',').map(c => c.trim()) : [];
          if (campaigns.includes(campaignName)) {
            if (campaigns.length === 1) {
              leadsToDelete.push(lead.id);
            } else {
              const updatedCampaigns = campaigns.filter(c => c !== campaignName).join(', ');
              leadsToUpdate.push({ id: lead.id, campaign_name: updatedCampaigns });
            }
          }
        }
      });

      if (leadsToDelete.length > 0) {
        mockDb.leads = mockDb.leads.filter(l => !leadsToDelete.includes(l.id));
        mockDb.agentBriefs = mockDb.agentBriefs.filter(b => !leadsToDelete.includes(b.lead_id));
        
        // Find sessions to delete and their event references
        const sessionIds = mockDb.callSessions.filter(s => leadsToDelete.includes(s.lead_id)).map(s => s.id);
        mockDb.callSessions = mockDb.callSessions.filter(s => !leadsToDelete.includes(s.lead_id));
        mockDb.callEvents = mockDb.callEvents.filter(e => !sessionIds.includes(e.session_id) && !leadsToDelete.includes(e.lead_id));
      }

      leadsToUpdate.forEach(u => {
        const lead = mockDb.leads.find(l => l.id === u.id);
        if (lead) {
          lead.campaign_name = u.campaign_name;
          lead.updated_at = new Date().toISOString();
        }
      });
    }
  },

  async insertJob(tenant_id, type, payload) {
    const job = {
      id: uuidv4(),
      tenant_id,
      job_type: type,
      status: 'pending',
      payload,
      result: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (supabase) {
      const { data, error } = await supabase.from('background_jobs').insert([job]).select().single();
      if (error) {
        if (error.code === '42P01') {
           // relation does not exist, use mock as fallback
           console.warn('background_jobs table not found in Supabase. Falling back to mock jobs.');
           mockDb.jobs.push(job);
           return job;
        }
        throw error;
      }
      return data;
    } else {
      mockDb.jobs.push(job);
      return job;
    }
  },

  async fetchNextPendingJob() {
    if (supabase) {
      // Find oldest pending job
      const { data, error } = await supabase
        .from('background_jobs')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1)
        .single();
      
      if (error) {
        if (error.code === 'PGRST116') return null; // No rows found
        if (error.code === '42P01') {
           // Fallback to mock
           const job = mockDb.jobs.find(j => j.status === 'pending');
           return job || null;
        }
        console.error('Error fetching next pending job:', error);
        return null;
      }
      return data;
    } else {
      const job = mockDb.jobs.find(j => j.status === 'pending');
      return job || null;
    }
  },

  async updateJobStatus(job_id, status, result = null) {
    const updateData = {
      status,
      result,
      updated_at: new Date().toISOString()
    };
    if (supabase) {
      const { data, error } = await supabase
        .from('background_jobs')
        .update(updateData)
        .eq('id', job_id)
        .select()
        .single();
      
      if (error) {
         if (error.code === '42P01') {
            const index = mockDb.jobs.findIndex(j => j.id === job_id);
            if (index !== -1) {
              mockDb.jobs[index] = { ...mockDb.jobs[index], ...updateData };
              return mockDb.jobs[index];
            }
         }
         console.error('Error updating job status:', error);
         return null;
      }
      return data;
    } else {
      const index = mockDb.jobs.findIndex(j => j.id === job_id);
      if (index !== -1) {
        mockDb.jobs[index] = { ...mockDb.jobs[index], ...updateData };
        return mockDb.jobs[index];
      }
      return null;
    }
  },


  async clearDb() {
    if (supabase) {
      await supabase.from('agent_briefs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('scripts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('dnc_registry').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('call_events').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('call_sessions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('audit_trail').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('config_audit_log').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('tenant_configs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('leads').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    } else {
      mockDb.leads = [];
      mockDb.configAuditLog = [];
      mockDb.callSessions = [];
      mockDb.callEvents = [];
      mockDb.auditTrail = [];
      mockDb.dncRegistry = [];
      mockDb.scripts = [];
      mockDb.agentBriefs = [];
      mockDb.jobs = [];
      // Re-seed defaults
      mockDb.tenantConfigs = {};
      mockDb.tenantConfigs['default-tenant'] = {
        tenant_id: 'default-tenant',
        scoring_weights: { ...DEFAULT_WEIGHTS },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      mockDb.tenantConfigs['test-tenant'] = {
        tenant_id: 'test-tenant',
        scoring_weights: { ...DEFAULT_WEIGHTS },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    }
  }
};

export default db;
