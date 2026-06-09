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
  auditTrail: []
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
      status: lead.status || 'pending',
      dataset_id: lead.dataset_id || null,
      campaign_name: lead.campaign_name || null,
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
    if (supabase) {
      const { data, error } = await supabase
        .from('leads')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const lead = mockDb.leads.find(l => l.id === id);
      if (!lead) throw new Error('Lead not found');
      lead.status = status;
      lead.updated_at = new Date().toISOString();
      return lead;
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

  async clearDb() {
    if (supabase) {
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
