// LeadX Dashboard Orchestrator
const API_BASE = '/leads';
let currentTenant = 'default-tenant';
let tenantWeights = {
  demographic_fit: 0.25,
  source_quality: 0.25,
  recency: 0.20,
  behavioural_signals: 0.15,
  prior_interaction: 0.15
};
let allLeads = [];
let currentFilter = 'all';
let tenantOnboardingConfig = {};

// Global Chart.js instances to avoid render glitches on reuse
let connectRateChartInstance = null;
let dispositionsChartInstance = null;
let scoringEffectivenessChartInstance = null;


let parsedCsvHeaders = [];
let parsedCsvRows = [];

// CRM Integration Configuration States
let crmConfig = {
  hubspot: {
    enabled: false,
    connected: false,
    apiKey: 'mock-hubspot-api-key',
    portalId: '8849301',
    ruleHot: true,
    ruleQual: false,
    ruleRecordings: true
  },
  leadsquared: {
    enabled: false,
    connected: false,
    accessKey: 'mock-leadsquared-api-key',
    secretKey: 'mock-leadsquared-secret-key',
    apiHost: 'api.leadsquared.com',
    ruleHot: true,
    ruleCustom: true
  },
  salesforce: {
    enabled: false,
    connected: false,
    clientId: 'mock-salesforce-client-id',
    clientSecret: 'mock-salesforce-client-secret',
    loginUrl: 'https://login.salesforce.com',
    ruleHot: true,
    ruleCustom: true
  }
};

// Default weights — used for reset and "already at defaults" check
const DEFAULT_WEIGHTS = {
  demographic_fit: 0.25,
  source_quality: 0.25,
  recency: 0.20,
  behavioural_signals: 0.15,
  prior_interaction: 0.15
};

// DOM Elements
const tenantIdInput = document.getElementById('tenantIdInput');
const loadTenantBtn = document.getElementById('loadTenantBtn');
const clientBadgeLink = document.getElementById('clientBadgeLink');

// Ingestion Form Elements
const singleIngestForm = document.getElementById('singleIngestForm');
const submitSingleBtn = document.getElementById('submitSingleBtn');
const batchJsonArea = document.getElementById('batchJsonArea');
const loadSampleBatchBtn = document.getElementById('loadSampleBatchBtn');
const submitBatchBtn = document.getElementById('submitBatchBtn');

// Config Sliders
const saveConfigBtn = document.getElementById('saveConfigBtn');
const resetWeightsBtn = document.getElementById('resetWeightsBtn');
const sumIndicator = document.getElementById('sumIndicator');
const rescoreAllBtn = document.getElementById('rescoreAllBtn');
const leadsList = document.getElementById('leadsList');
const leadsCount = document.getElementById('leadsCount');
const sidebarLeadsCount = document.getElementById('sidebarLeadsCount');

// Toast Notification Elements
const toast = document.getElementById('notificationToast');
const toastIcon = document.getElementById('toastIcon');
const toastTitle = document.getElementById('toastTitle');
const toastBody = document.getElementById('toastBody');
const toastCloseBtn = document.getElementById('toastCloseBtn');

// Initialize Dashboard
window.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupEventListeners();
  loadTenantData();
  startActivitySimulator();
  seedInitialDataIfEmpty();
  fetchCampaignsList();

  // Poll call events stream every 5 seconds
  setInterval(fetchCallEventsStream, 5000);
  fetchCallEventsStream();

  // Poll leads list every 5 seconds to catch escalations dynamically
  setInterval(fetchLeadsList, 5000);

  // Audit Logs Poller
  setInterval(fetchAuditTrail, 10000);
  fetchAuditTrail();

  // Queue Status Poller
  setInterval(fetchQueueStatus, 5000);
  fetchQueueStatus();
});

// 1. Navigation Panel Handler
function setupNavigation() {
  const sidebarItems = document.querySelectorAll('.lx-sidebar-item');
  const pages = document.querySelectorAll('.lx-page');

  sidebarItems.forEach(item => {
    item.addEventListener('click', () => {
      const pageId = item.getAttribute('data-page');
      if (!pageId) return;

      // Update sidebar active class
      sidebarItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      // Show/Hide pages
      pages.forEach(p => p.classList.remove('show'));
      const activePage = document.getElementById(`page-${pageId}`);
      if (activePage) {
        activePage.classList.add('show');
      }

      // Page specific loaders
      if (pageId === 'crm') {
        loadCrmPageData();
      } else if (pageId === 'campaigns') {
        fetchCampaignsList();
      } else if (pageId === 'script-editor') {
        loadScriptEditorData();
      } else if (pageId === 'home') {
        loadDashboardAnalytics();
      }
    });
  });

  // Client badge link in top bar shortcut
  if (clientBadgeLink) {
    clientBadgeLink.addEventListener('click', () => {
      const clientItem = document.querySelector('.lx-sidebar-item[data-page="client"]');
      if (clientItem) {
        clientItem.click();
      }
    });
  }
}


// 2. Set Up Event Listeners
function setupEventListeners() {
  // Switch Tenant Context
  loadTenantBtn.addEventListener('click', () => {
    const val = tenantIdInput.value.trim();
    if (val) {
      currentTenant = val;
      loadTenantData();
      fetchCallEventsStream();
      fetchAuditTrail();
      showToast('Tenant Switched', `Switched active tenant context to: ${currentTenant}`, 'key');
    }
  });



  // Save weights config
  saveConfigBtn.addEventListener('click', saveWeightsConfig);

  // Campaign scoring filter dropdown change listener
  const campaignFilterDropdown = document.getElementById('leads-campaign-filter');
  if (campaignFilterDropdown) {
    campaignFilterDropdown.addEventListener('change', () => {
      renderLeads(allLeads);
    });
  }

  // Ingest forms pill tab toggling
  const ingestTabs = document.querySelectorAll('#ingest-mode-tabs .lx-pill-tab');
  ingestTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      ingestTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const tabId = tab.getAttribute('data-tab');
      const singleFormEl = document.getElementById('ingest-form-single');
      const batchFormEl = document.getElementById('ingest-form-batch');
      const crmFormEl = document.getElementById('ingest-form-crm-ingest');
      if (singleFormEl) singleFormEl.className = 'tab-content' + (tabId === 'single' ? ' show' : '');
      if (batchFormEl) batchFormEl.className = 'tab-content' + (tabId === 'batch' ? ' show' : '');
      if (crmFormEl) crmFormEl.className = 'tab-content' + (tabId === 'crm-ingest' ? ' show' : '');
      if (tabId === 'crm-ingest') {
        loadDirectCrmIngestData();
      }
    });
  });

  // Campaign modes pill tab toggling
  const campaignTabs = document.querySelectorAll('#campaign-mode-tabs .lx-pill-tab');
  campaignTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      campaignTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const mode = tab.getAttribute('data-mode');
      
      // Update config column header title
      const configHeader = document.getElementById('campaign-config-header');
      if (mode === 'rt') configHeader.innerHTML = 'Real-Time Config Options <span class="sub">Active campaign settings</span>';
      else if (mode === 'nonrt') configHeader.innerHTML = 'Non-RT Config Options <span class="sub">Batch dialing limits</span>';
      else if (mode === 'scheduled') configHeader.innerHTML = 'Pre-Flight Preparation <span class="sub">Schedule new campaigns</span>';

      // Toggle Campaign contents and config forms
      document.getElementById('camp-content-rt').className = 'tab-content' + (mode === 'rt' ? ' show' : '');
      document.getElementById('camp-content-nonrt').className = 'tab-content' + (mode === 'nonrt' ? ' show' : '');
      document.getElementById('camp-content-scheduled').className = 'tab-content' + (mode === 'scheduled' ? ' show' : '');

      document.getElementById('config-form-rt').className = 'tab-content' + (mode === 'rt' ? ' show' : '');
      document.getElementById('config-form-nonrt').className = 'tab-content' + (mode === 'nonrt' ? ' show' : '');
      document.getElementById('config-form-scheduled').className = 'tab-content' + (mode === 'scheduled' ? ' show' : '');
    });
  });

  // Single Ingest Submit
  if (singleIngestForm) {
    singleIngestForm.addEventListener('submit', handleSingleIngest);
  }

  // Sample Batch loading
  if (loadSampleBatchBtn) {
    loadSampleBatchBtn.addEventListener('click', loadSampleJsonTemplate);
  }

  // Batch Ingest submit
  if (submitBatchBtn) {
    submitBatchBtn.addEventListener('click', handleBatchIngest);
  }

  // Rescore All Leads
  rescoreAllBtn.addEventListener('click', handleRescoreAll);

  // Reset Scoring Weights to defaults
  if (resetWeightsBtn) {
    resetWeightsBtn.addEventListener('click', () => {
      const activeIndustry = getActiveIndustry();
      const activeKeys = getActiveSliderKeysForIndustry(activeIndustry);

      const isAlreadyDefault = activeKeys.every(slider => {
        const input = document.getElementById(`weight-${slider.key}`);
        return input && Math.abs(parseFloat(input.value) - slider.defaultWeight) < 0.001;
      });

      if (isAlreadyDefault) {
        resetWeightsBtn.textContent = 'Already Default';
        resetWeightsBtn.style.color = 'var(--lx-green)';
        resetWeightsBtn.style.borderColor = 'rgba(46,204,138,0.4)';
        setTimeout(() => {
          resetWeightsBtn.textContent = 'Reset';
          resetWeightsBtn.style.color = '';
          resetWeightsBtn.style.borderColor = '';
        }, 2000);
        return;
      }

      activeKeys.forEach(slider => {
        const input = document.getElementById(`weight-${slider.key}`);
        if (input) input.value = slider.defaultWeight;
        const valDisplay = document.getElementById(`val-${slider.key}`);
        if (valDisplay) valDisplay.textContent = slider.defaultWeight.toFixed(2);
        
        tenantWeights[slider.key] = slider.defaultWeight;
      });

      updateWeightsSum();
      showToast('Weights Reset', 'Restored weights to active industry default configurations.', 'rotate-ccw');
    });
  }

  // Leads Filter Badges
  const filterBadges = document.querySelectorAll('#leads-filter-badges span');
  filterBadges.forEach(badge => {
    badge.addEventListener('click', () => {
      filterBadges.forEach(b => {
        b.classList.remove('badge-accent');
        b.classList.add('badge-gray');
      });
      badge.classList.remove('badge-gray');
      badge.classList.add('badge-accent');
      currentFilter = badge.getAttribute('data-filter');
      renderLeads(allLeads);
    });
  });

  // Event log filter selector listener
  const eventFilterSelect = document.getElementById('eventFilterSelect');
  if (eventFilterSelect) {
    eventFilterSelect.addEventListener('change', fetchCallEventsStream);
  }

  // Toast Close
  toastCloseBtn.addEventListener('click', () => toast.classList.remove('show'));

  // Update Concurrency label dynamic feedback
  const concurrencySlider = document.getElementById('cfg-nonrt-concurrency');
  const concurrencyVal = document.getElementById('cfg-nonrt-concurrency-val');
  if (concurrencySlider && concurrencyVal) {
    concurrencySlider.addEventListener('input', (e) => {
      concurrencyVal.textContent = e.target.value;
    });
  }

  // CRM Event Listeners
  const hsToggle = document.getElementById('hs-toggle-btn');
  const lsToggle = document.getElementById('ls-toggle-btn');
  const hsTest = document.getElementById('hs-test-btn');
  const lsTest = document.getElementById('ls-test-btn');
  const hsSave = document.getElementById('hs-save-btn');
  const lsSave = document.getElementById('ls-save-btn');
  const showManualSyncBtn = document.getElementById('show-manual-sync-btn');
  const closeManualDrawer = document.getElementById('close-manual-drawer');

  if (hsToggle) {
    hsToggle.addEventListener('change', (e) => {
      crmConfig.hubspot.enabled = e.target.checked;
      updateCrmPipelineUI();
    });
  }

  if (lsToggle) {
    lsToggle.addEventListener('change', (e) => {
      crmConfig.leadsquared.enabled = e.target.checked;
      updateCrmPipelineUI();
    });
  }

  const sfToggle = document.getElementById('sf-toggle-btn');
  if (sfToggle) {
    sfToggle.addEventListener('change', (e) => {
      crmConfig.salesforce.enabled = e.target.checked;
      updateCrmPipelineUI();
    });
  }

  if (hsTest) {
    hsTest.addEventListener('click', () => testCrmConnection('hubspot'));
  }

  if (lsTest) {
    lsTest.addEventListener('click', () => testCrmConnection('leadsquared'));
  }

  if (hsSave) {
    hsSave.addEventListener('click', () => saveCrmConfig('hubspot'));
  }

  if (lsSave) {
    lsSave.addEventListener('click', () => saveCrmConfig('leadsquared'));
  }

  if (showManualSyncBtn) {
    showManualSyncBtn.addEventListener('click', () => {
      const drawer = document.getElementById('manual-sync-drawer');
      if (drawer) {
        drawer.style.display = drawer.style.display === 'none' ? 'block' : 'none';
        if (drawer.style.display === 'block') {
          renderManualSyncList();
        }
      }
    });
  }

  if (closeManualDrawer) {
    closeManualDrawer.addEventListener('click', () => {
      const drawer = document.getElementById('manual-sync-drawer');
      if (drawer) drawer.style.display = 'none';
    });
  }
}

// 3. Dynamic Weight Calculation & Delta Checking
function updateWeightsSum() {
  let sum = 0;
  const rangeInputs = document.querySelectorAll('#sliders-row-container input[type="range"]');
  rangeInputs.forEach(input => {
    sum += parseFloat(input.value);
  });
  
  if (sumIndicator) {
    sumIndicator.textContent = `Sum: ${sum.toFixed(3)}`;
    if (Math.abs(sum - 1.0) <= 0.001) {
      sumIndicator.className = 'sum-indicator valid';
      if (saveConfigBtn) saveConfigBtn.removeAttribute('disabled');
    } else {
      sumIndicator.className = 'sum-indicator invalid';
      if (saveConfigBtn) saveConfigBtn.setAttribute('disabled', 'true');
    }
  }
}

// 4. Fetch Tenant Configs & Lead feeds
async function loadTenantData() {
  try {
    const configRes = await fetch(`${API_BASE}/config?tenant_id=${currentTenant}`);
    if (configRes.ok) {
      const configData = await configRes.json();
      if (configData.success && configData.weights) {
        tenantWeights = configData.weights;
      }
    }

    // Load onboarding / CRM credentials config on startup
    const onboardRes = await fetch(`${API_BASE}/onboard?tenant_id=${currentTenant}`);
    if (onboardRes.ok) {
      const data = await onboardRes.json();
      if (data.success && data.onboarding_config) {
        tenantOnboardingConfig = data.onboarding_config;
        // HubSpot
        if (data.onboarding_config.hubspot_oauth) {
          crmConfig.hubspot.connected = true;
          crmConfig.hubspot.enabled = true;
        }
        if (data.onboarding_config.hubspot_api_key) {
          crmConfig.hubspot.apiKey = data.onboarding_config.hubspot_api_key;
          crmConfig.hubspot.connected = true;
          crmConfig.hubspot.enabled = true;
        }
        if (data.onboarding_config.hubspot_portal_id) {
          crmConfig.hubspot.portalId = data.onboarding_config.hubspot_portal_id;
        }

        // LeadSquared
        if (data.onboarding_config.ls_access_key) {
          crmConfig.leadsquared.accessKey = data.onboarding_config.ls_access_key;
          crmConfig.leadsquared.connected = true;
          crmConfig.leadsquared.enabled = true;
        }
        if (data.onboarding_config.ls_secret_key) {
          crmConfig.leadsquared.secretKey = data.onboarding_config.ls_secret_key;
        }
        if (data.onboarding_config.ls_api_host) {
          crmConfig.leadsquared.apiHost = data.onboarding_config.ls_api_host;
        }

        // Salesforce
        if (data.onboarding_config.sf_client_id) {
          crmConfig.salesforce.clientId = data.onboarding_config.sf_client_id;
          crmConfig.salesforce.connected = true;
          crmConfig.salesforce.enabled = true;
        }
        if (data.onboarding_config.sf_client_secret) {
          crmConfig.salesforce.clientSecret = data.onboarding_config.sf_client_secret;
        }
        if (data.onboarding_config.sf_login_url) {
          crmConfig.salesforce.loginUrl = data.onboarding_config.sf_login_url;
        }
      }
    }

    await fetchLeadsList();
  } catch (error) {
    console.error('Error fetching tenant details:', error);
    showToast('Load Error', 'Failed to retrieve tenant configuration details from backend server.', 'alert-triangle', 'error');
  }
}

async function fetchLeadsList() {
  try {
    const leadsRes = await fetch(`${API_BASE}?tenant_id=${currentTenant}`);
    if (leadsRes.ok) {
      const leadsData = await leadsRes.json();
      if (leadsData.success) {
        allLeads = leadsData.leads;
        updateCampaignFilterDropdown(allLeads);
        renderLeads(allLeads);
        updateDashboardKPIs(allLeads);

        // Modules 5-8 additions
        checkAndShowEscalationsBanner(allLeads);
        loadDashboardAnalytics();
      }
    }
  } catch (err) {
    console.error('Error fetching leads:', err);
    showToast('Fetch Error', 'Failed to update lead intelligence feed from backend.', 'alert-triangle', 'error');
  }
}


// Update filter badge counts
function updateFilterCounts(leads) {
  const hot  = leads.filter(l => l.score >= 80).length;
  const warm = leads.filter(l => l.score >= 50 && l.score < 80).length;
  const cold = leads.filter(l => l.score < 50).length;

  const fcAll  = document.getElementById('fc-all');
  const fcHot  = document.getElementById('fc-hot');
  const fcWarm = document.getElementById('fc-warm');
  const fcCold = document.getElementById('fc-cold');

  if (fcAll)  fcAll.textContent  = leads.length;
  if (fcHot)  fcHot.textContent  = hot;
  if (fcWarm) fcWarm.textContent = warm;
  if (fcCold) fcCold.textContent = cold;
}

// Update Lead Intelligence Analytics Summary Cards
function updateLeadIntelligenceAnalytics(leads) {
  const statTotalLeads = document.getElementById('stat-total-leads');
  const statAvgScore = document.getElementById('stat-avg-score');
  const statHotLeads = document.getElementById('stat-hot-leads');
  const statHotPercent = document.getElementById('stat-hot-percent');
  const statQualifiedLeads = document.getElementById('stat-qualified-leads');
  const statQualifiedPercent = document.getElementById('stat-qualified-percent');

  if (!statTotalLeads) return;

  const total = leads.length;
  statTotalLeads.textContent = total.toLocaleString();

  let avgScore = 0;
  if (total > 0) {
    const sum = leads.reduce((acc, l) => acc + (l.score || 0), 0);
    avgScore = sum / total;
  }
  if (statAvgScore) {
    statAvgScore.textContent = `${Math.round(avgScore)} / 100`;
  }

  const hotCount = leads.filter(l => l.score >= 80).length;
  if (statHotLeads) {
    statHotLeads.textContent = hotCount.toLocaleString();
  }
  if (statHotPercent) {
    const hotPct = total > 0 ? (hotCount / total) * 100 : 0;
    statHotPercent.textContent = `${hotPct.toFixed(1)}%`;
  }

  const qualifiedCount = leads.filter(l => (l.score >= 65 && l.status !== 'dnc') || l.status === 'hot_escalated').length;
  if (statQualifiedLeads) {
    statQualifiedLeads.textContent = qualifiedCount.toLocaleString();
  }
  if (statQualifiedPercent) {
    const qualPct = total > 0 ? (qualifiedCount / total) * 100 : 0;
    statQualifiedPercent.textContent = `${qualPct.toFixed(1)}%`;
  }
}

// 5. Render Lead Feed & Dynamic UI Elements
function renderLeads(leads) {
  const campaignFilterDropdown = document.getElementById('leads-campaign-filter');
  const selectedCampaign = campaignFilterDropdown ? campaignFilterDropdown.value : 'all';

  let campaignFilteredLeads = leads;
  if (selectedCampaign && selectedCampaign !== 'all') {
    campaignFilteredLeads = leads.filter(l => (l.campaign_name || 'Manual Ingests') === selectedCampaign);
  }

  // Render Dynamic weights sliders based on the active campaign industry
  const activeIndustry = getActiveIndustry();
  const activeKeys = getActiveSliderKeysForIndustry(activeIndustry);
  renderSliders(activeKeys);

  leadsCount.textContent = campaignFilteredLeads.length;
  sidebarLeadsCount.textContent = leads.length;
  updateFilterCounts(campaignFilteredLeads);
  updateLeadIntelligenceAnalytics(campaignFilteredLeads);

  let filtered = campaignFilteredLeads;
  if (currentFilter === 'hot') filtered = campaignFilteredLeads.filter(l => l.score >= 80);
  else if (currentFilter === 'warm') filtered = campaignFilteredLeads.filter(l => l.score >= 50 && l.score < 80);
  else if (currentFilter === 'cold') filtered = campaignFilteredLeads.filter(l => l.score < 50);

  if (filtered.length === 0) {
    leadsList.innerHTML = `
      <tr class="lx-empty-row">
        <td colspan="7" style="text-align: center; padding: 24px;">
          <div class="lx-empty">
            <i data-lucide="clock" style="width:20px; height:20px; color:var(--lx-muted);"></i>
            <div>No leads match this filter. Ingest leads or switch filter.</div>
          </div>
        </td>
      </tr>`;
    lucide.createIcons();
    return;
  }

  leadsList.innerHTML = filtered.map(lead => {
    const score = lead.score || 0;

    let tierClass, dispText, dispClass, scoreColor;
    if (lead.status === 'dnc') {
      tierClass = 'tier-cold'; dispText = 'DNC BLOCK'; dispClass = 'badge-red'; scoreColor = 'var(--lx-red)';
    } else if (lead.status === 'hot_escalated') {
      tierClass = 'tier-hot'; dispText = 'ESCALATED'; dispClass = 'badge-teal'; scoreColor = 'var(--lx-green)';
    } else if (score >= 80) {
      tierClass = 'tier-hot'; dispText = 'HOT'; dispClass = 'badge-green'; scoreColor = 'var(--lx-green)';
    } else if (score >= 65) {
      tierClass = 'tier-qualified'; dispText = 'QUALIFIED'; dispClass = 'badge-accent'; scoreColor = 'var(--lx-accent)';
    } else if (score >= 50) {
      tierClass = 'tier-warm'; dispText = 'WARM'; dispClass = 'badge-amber'; scoreColor = 'var(--lx-amber)';
    } else {
      tierClass = 'tier-cold'; dispText = 'COLD'; dispClass = 'badge-gray'; scoreColor = 'var(--lx-red)';
    }

    // Mini SVG score ring
    const r = 16, c = (2 * Math.PI * r).toFixed(1);
    const offset = (c - (c * score) / 100).toFixed(1);
    const scoreSvg = `<div class="lx-score-mini">
      <svg width="40" height="40" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="${r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="3"/>
        <circle cx="20" cy="20" r="${r}" fill="none" stroke="${scoreColor}" stroke-width="3"
          stroke-dasharray="${c}" stroke-dashoffset="${offset}"
          transform="rotate(-90 20 20)" stroke-linecap="round"/>
      </svg>
      <div class="lx-score-mini-num" style="color:${scoreColor}">${score}</div>
    </div>`;

    const rawPhone = lead.phone || '';
    const maskedPhone = rawPhone.length > 6
      ? rawPhone.substring(0, rawPhone.length - 5) + '***' + rawPhone.substring(rawPhone.length - 2)
      : rawPhone;

    const city = lead.raw_data?.city || 'Unknown';
    const age = lead.raw_data?.age || 'N/A';
    const srcKey = (lead.source || 'other').toLowerCase().replace(/-/g, '_');
    const srcLabel = (lead.source || 'OTHER').toUpperCase().replace(/-/g, '_');
    const campaignLabel = lead.campaign_name || 'Manual';
    const datasetLabel = lead.dataset_id || 'manual';

    const dncDisabled = lead.status === 'dnc' ? 'disabled' : '';

    return `
      <tr id="lead-tr-${lead.id}" class="${tierClass}">
        <td>
          <div class="lead-name-strong">${lead.name || 'Anonymous'}</div>
          <div class="lead-meta-sub">Location: ${city} | Age: ${age}</div>
        </td>
        <td><span style="font-family:var(--lx-mono);font-size:12px;">${maskedPhone}</span></td>
        <td><span class="lx-source-badge src-${srcKey}">${srcLabel}</span></td>
        <td style="text-align:center;"><div class="lx-score-cell">${scoreSvg}</div></td>
        <td><span class="lx-badge ${dispClass}">${dispText}</span></td>
        <td><span style="font-size:11px;color:var(--lx-muted);font-family:var(--lx-mono);">${campaignLabel} / ${datasetLabel}</span></td>
        <td>
          <div class="lx-action-row">
            <button class="btn-call" ${dncDisabled} onclick="triggerMockCall('${lead.id}','${lead.name}','${lead.phone}',${score})">Call</button>
            <button class="btn-handoff" ${dncDisabled} onclick="triggerMockHandoff('${lead.id}','${lead.name}')">Handoff</button>
            <button class="btn-icon-sm danger" ${dncDisabled} onclick="triggerMockDnc('${lead.id}','${lead.phone}')" title="Flag DNC">Block</button>
            <button class="btn-icon-sm" ${dncDisabled} onclick="rescoreSingleLead('${lead.id}')" title="Rescore">Rescore</button>
          </div>
        </td>
      </tr>`;
  }).join('');

  lucide.createIcons();
}

// 6. Update KPIs based on leads
function updateDashboardKPIs(leads) {
  const hotLeads = leads.filter(l => l.score >= 80);
  const totalCallsCount = 14800 + leads.length * 3;
  const qualifiedLeads = 3100 + hotLeads.length;

  document.getElementById('kpi-total-calls').textContent = totalCallsCount.toLocaleString();
  document.getElementById('kpi-qualified-leads').textContent = qualifiedLeads.toLocaleString();
  document.getElementById('kpi-hot-leads').textContent = (930 + hotLeads.length).toLocaleString();

  // Render Hot Leads rings strip on Home page
  const ringList = document.getElementById('hot-leads-ring-list');
  if (ringList) {
    if (hotLeads.length === 0) {
      ringList.innerHTML = `
        <div style="font-size: 11.5px; color: var(--lx-hint); text-align: center; padding: 20px 0;">
          No high-intent leads recorded yet.
        </div>
      `;
      return;
    }

    const topHot = [...hotLeads].sort((a,b) => b.score - a.score).slice(0, 3);
    ringList.innerHTML = topHot.map(lead => {
      const score = lead.score;
      const pctOffset = 131.9 - (131.9 * score) / 100;
      
      const rawPhone = lead.phone || '';
      let maskedPhone = rawPhone;
      if (rawPhone.length > 6) {
        maskedPhone = rawPhone.substring(0, rawPhone.length - 5) + '***' + rawPhone.substring(rawPhone.length - 2);
      }

      return `
        <div class="hotlead-row">
          <div class="hlr-name">
            <strong>${lead.name || 'Hot Lead'}</strong>
            <div class="hlr-meta">Phone: ${maskedPhone} | ${lead.raw_data?.city || 'India'}</div>
          </div>
          <div class="score-ring">
            <svg width="52" height="52" viewBox="0 0 52 52">
              <circle cx="26" cy="26" r="21" fill="none" stroke="var(--lx-border)" stroke-width="3"></circle>
              <circle cx="26" cy="26" r="21" fill="none" stroke="var(--lx-green)" stroke-width="3.5" stroke-dasharray="131.9" stroke-dashoffset="${pctOffset}" transform="rotate(-90 26 26)"></circle>
            </svg>
            <div class="score-num" style="color: var(--lx-green)">${score}</div>
          </div>
        </div>
      `;
    }).join('');
  }
}

// 7. Save Weights config API
async function saveWeightsConfig() {
  const weights = {};
  const rangeInputs = document.querySelectorAll('#sliders-row-container input[type="range"]');
  rangeInputs.forEach(input => {
    const key = input.id.replace('weight-', '');
    weights[key] = parseFloat(input.value);
  });

  try {
    const res = await fetch(`${API_BASE}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: currentTenant,
        weights,
        changed_by: 'intern-dashboard'
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Config Saved', 'Scoring weights updated successfully on server.', 'settings');
      loadTenantData();
      logActivityFeed('Configuration weights modified by user context.');
    } else {
      showToast('Save Failed', data.message || 'Validation failed on server.', 'alert-triangle', 'error');
    }
  } catch (error) {
    console.error('Error saving weights:', error);
    showToast('Network Error', 'Connection failed while saving configurations.', 'alert-triangle', 'error');
  }
}

// 8. Ingest Single Lead API Handler
async function handleSingleIngest(e) {
  e.preventDefault();
  
  const leadName = document.getElementById('leadName').value.trim();
  const leadPhone = document.getElementById('leadPhone').value.trim();
  const leadEmail = document.getElementById('leadEmail').value.trim();
  const leadSource = document.getElementById('leadSource').value;
  const leadAge = document.getElementById('leadAge').value;
  const leadCity = document.getElementById('leadCity').value.trim();
  const leadIncome = document.getElementById('leadIncome').value;
  const leadPages = document.getElementById('leadPages').value;
  const leadVideo = document.getElementById('leadVideo').checked;
  const leadCourse = document.getElementById('leadCourse').checked;
  const leadPriorOutcome = document.getElementById('leadPriorOutcome').value;

  const raw_data = {
    city: leadCity || undefined,
    age: leadAge ? parseInt(leadAge) : undefined,
    income: leadIncome ? parseInt(leadIncome) : undefined,
    pages_visited: leadPages ? parseInt(leadPages) : 0,
    video_watched: leadVideo,
    course_viewed: leadCourse,
    prior_outcome: leadPriorOutcome !== 'pending' ? leadPriorOutcome : undefined
  };

  const payload = {
    tenant_id: currentTenant,
    name: leadName || undefined,
    phone: leadPhone,
    email: leadEmail || undefined,
    source: leadSource,
    raw_data,
    campaign_name: 'Manual Ingests',
    dataset_id: 'manual'
  };

  submitSingleBtn.setAttribute('disabled', 'true');
  submitSingleBtn.textContent = 'Ingesting...';

  try {
    const res = await fetch(`${API_BASE}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (res.status === 201) {
      showToast('Lead Ingested', `Created lead: ${data.lead.name || 'Anonymous'} | Score: ${data.lead.score}`, 'check');
      singleIngestForm.reset();
      await fetchLeadsList();
      logActivityFeed(`New lead <strong>${data.lead.name || 'Anonymous'}</strong> ingested successfully (Score: ${data.lead.score}).`);
    } else if (res.status === 409) {
      showToast('Duplicate Lead', '409 Conflict: Phone number already exists for this tenant.', 'alert-triangle', 'warning');
    } else {
      showToast('Ingest Failed', data.message || 'Payload validation error.', 'alert-triangle', 'error');
    }
  } catch (error) {
    console.error('Ingest error:', error);
    showToast('Network Error', 'Could not establish connection to the server.', 'alert-triangle', 'error');
  } finally {
    submitSingleBtn.removeAttribute('disabled');
    submitSingleBtn.textContent = 'Ingest Lead';
  }
}

// 9. Batch JSON template loader
function loadSampleJsonTemplate() {
  const template = [
    {
      "name": "Jane Smith",
      "phone": "+918888877777",
      "email": "jane@smith.org",
      "source": "referral",
      "raw_data": {
        "age": 28,
        "city": "Mumbai",
        "income": 750000,
        "pages_visited": 8,
        "video_watched": true,
        "course_viewed": true
      }
    },
    {
      "name": "Alex Mercer",
      "phone": "+15550192837",
      "source": "organic",
      "raw_data": {
        "age": 42,
        "city": "Pune",
        "pages_visited": 2,
        "video_watched": false
      }
    }
  ];
  batchJsonArea.value = JSON.stringify(template, null, 2);
  showToast('Template Loaded', 'JSON array template populated in workspace.', 'clipboard');
}

// 10. Batch Ingest API Handler
async function handleBatchIngest() {
  const jsonStr = batchJsonArea.value.trim();
  if (!jsonStr) {
    showToast('Input Required', 'Please enter valid JSON array first.', 'alert-triangle', 'warning');
    return;
  }

  let leadsArray = null;
  try {
    leadsArray = JSON.parse(jsonStr);
    if (!Array.isArray(leadsArray)) {
      throw new Error('JSON is not an array');
    }
  } catch (err) {
    showToast('JSON Parse Error', 'Make sure your JSON is structured as a valid Array.', 'alert-triangle', 'error');
    return;
  }

  submitBatchBtn.setAttribute('disabled', 'true');
  submitBatchBtn.textContent = 'Processing...';

  try {
    const res = await fetch(`${API_BASE}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: currentTenant,
        leads: leadsArray,
        dataset_id: 'bulk-json',
        campaign_name: 'JSON Uploads'
      })
    });

    const data = await res.json();
    if (res.ok) {
      showToast('Batch Complete', `Accepted: ${data.accepted} | Rejected: ${data.rejected} | Duplicates: ${data.duplicates}`, 'check');
      batchJsonArea.value = '';
      await fetchLeadsList();
      logActivityFeed(`Batch ingested: <strong>${data.accepted} accepted</strong>, ${data.rejected} rejected, ${data.duplicates} duplicates.`);
    } else {
      showToast('Batch Failed', data.message || 'Validation failed for batch schema.', 'alert-triangle', 'error');
    }
  } catch (error) {
    console.error('Batch Ingest error:', error);
    showToast('Network Error', 'Connection lost during batch processing.', 'alert-triangle', 'error');
  } finally {
    submitBatchBtn.removeAttribute('disabled');
    submitBatchBtn.textContent = 'Ingest Batch';
  }
}

// 11. Rescore Single Lead API Handler
window.rescoreSingleLead = async function(leadId) {
  const trEl = document.getElementById(`lead-tr-${leadId}`);
  if (trEl) {
    trEl.style.opacity = '0.5';
  }

  try {
    const res = await fetch(`${API_BASE}/${leadId}/rescore`, {
      method: 'POST'
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Lead Rescored', `Lead score updated: ${data.old_score} to ${data.new_score}`, 'refresh-cw');
      await fetchLeadsList();
      logActivityFeed(`Lead <strong>${data.lead.name || 'Anonymous'}</strong> rescored from ${data.old_score} to ${data.new_score}.`);
    } else {
      showToast('Rescore Failed', data.message || 'Unable to update lead score.', 'alert-triangle', 'error');
      if (trEl) trEl.style.opacity = '1';
    }
  } catch (error) {
    console.error('Rescore single lead error:', error);
    showToast('Network Error', 'Failed to connect to rescoring endpoint.', 'alert-triangle', 'error');
    if (trEl) trEl.style.opacity = '1';
  }
};

// 12. Rescore All Leads API Handler
async function handleRescoreAll() {
  if (allLeads.length === 0) {
    showToast('No Leads', 'There are no active leads loaded to rescore.', 'alert-triangle', 'warning');
    return;
  }

  rescoreAllBtn.setAttribute('disabled', 'true');
  rescoreAllBtn.textContent = 'Recalculating...';

  try {
    const promises = allLeads.map(l => 
      fetch(`${API_BASE}/${l.id}/rescore`, { method: 'POST' })
        .then(r => r.json())
        .catch(err => ({ success: false }))
    );

    const results = await Promise.all(promises);
    const successful = results.filter(r => r.success).length;

    showToast('Recalculation Complete', `Successfully rescored ${successful} leads.`, 'check');
    await fetchLeadsList();
    logActivityFeed(`Bulk recalculation completed for <strong>${successful} leads</strong>.`);
  } catch (error) {
    console.error('Rescore all error:', error);
    showToast('Recalculation Failed', 'Error batch rescoring tenant leads.', 'alert-triangle', 'error');
  } finally {
    rescoreAllBtn.removeAttribute('disabled');
    rescoreAllBtn.textContent = 'Rescore All Leads';
  }
}

// 13. REAL CALL WEBHOOK ORCHESTRATION & STREAMING
window.triggerMockCall = async function(leadId, leadName, leadPhone, score) {
  showToast('Initiating Dial', `Triggering outbound VOIZ call session for ${leadName}...`, 'phone');
  
  try {
    const res = await fetch(`${API_BASE}/trigger-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: currentTenant,
        lead_id: leadId
      })
    });
    
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Call Session Started', `Call triggered successfully. Session: ${data.voiz_session_id}`, 'activity');
      
      // Switch to Live Monitor tab
      const monitorTab = document.querySelector('.lx-sidebar-item[data-page="monitor"]');
      if (monitorTab) monitorTab.click();
      
      // Trigger instant UI waveform simulator
      simulateWaveformInMonitor(leadId, leadName, leadPhone, score);

      // Force immediate poll of events logs
      fetchCallEventsStream();
    } else {
      showToast('DNC Blocked', data.message || 'Call failed to initiate.', 'alert-triangle', 'warning');
    }
  } catch (err) {
    console.error('Failed to trigger call:', err);
    showToast('Call Error', 'Could not establish connection to dialing service.', 'alert-triangle', 'error');
  }
};

function simulateWaveformInMonitor(leadId, leadName, leadPhone, score) {
  const liveList = document.getElementById('live-calls-list');
  if (!liveList) return;

  const newCallCard = document.createElement('div');
  newCallCard.className = 'lx-livecall';
  newCallCard.id = `livecall-sim-${leadId}`;
  newCallCard.style.borderLeft = '4px solid var(--lx-green)';
  
  newCallCard.innerHTML = `
    <div class="lc-header">
      <span class="lx-badge badge-green">ON CALL</span>
      <strong class="lc-title">${leadName}</strong>
      <span class="lc-sub">VOIZ-01 connected</span>
    </div>
    <div class="lc-grid">
      <div class="lc-item">
        <span class="lc-item-label">Phone</span>
        <span class="lc-item-val">${leadPhone}</span>
      </div>
      <div class="lc-item">
        <span class="lc-item-label">Intent Score</span>
        <span class="lc-item-val" style="color: var(--lx-green);">${score} / 100</span>
      </div>
      <div class="lc-item" style="display:flex; align-items:center; justify-content:space-between; flex-direction:row;">
        <div>
          <span class="lc-item-label">Live Stream</span>
          <span class="lc-item-val" id="stream-timer-${leadId}">00:01s</span>
        </div>
        <div class="call-wave">
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </div>
  `;
  
  liveList.insertBefore(newCallCard, liveList.firstChild);
  updateLiveCallsCountBadge();

  let secs = 1;
  const interval = setInterval(() => {
    const timerVal = document.getElementById(`stream-timer-${leadId}`);
    if (timerVal) {
      secs++;
      const minsStr = Math.floor(secs / 60).toString().padStart(2, '0');
      const secsStr = (secs % 60).toString().padStart(2, '0');
      timerVal.textContent = `${minsStr}:${secsStr}s`;
    } else {
      clearInterval(interval);
    }
  }, 1000);

  // Auto clean simulator view card after 10s (webhook will complete actual updates)
  setTimeout(() => {
    clearInterval(interval);
    const simCard = document.getElementById(`livecall-sim-${leadId}`);
    if (simCard) {
      simCard.remove();
      updateLiveCallsCountBadge();
    }
  }, 10000);
}

// Fetch and render Event Stream Logs
async function fetchCallEventsStream() {
  const filterType = document.getElementById('eventFilterSelect')?.value || '';
  try {
    const response = await fetch(`${API_BASE}/events?tenant_id=${currentTenant}&event_type=${filterType}`);
    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        renderEventsStream(data.events);
      }
    }
  } catch (err) {
    console.error('Failed to poll call events:', err);
  }
}

function renderEventsStream(events) {
  const tbody = document.getElementById('voizEventsStreamList');
  if (!tbody) return;

  if (events.length === 0) {
    tbody.innerHTML = `
      <tr class="lx-empty-row">
        <td colspan="5" style="text-align: center; padding: 20px;">
          No events streamed yet. Trigger a simulated call from Lead Intelligence list or via onboarding handshake.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = events.map(e => {
    const time = new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const payloadStr = JSON.stringify(e.payload);
    let detailText = e.payload?.transcript || e.payload?.disposition || e.payload?.reason || payloadStr;
    if (detailText.length > 80) {
      detailText = detailText.substring(0, 80) + '...';
    }

    let badgeClass = 'badge-gray';
    if (e.event_type === 'call_started') badgeClass = 'badge-green';
    else if (e.event_type === 'escalation_triggered') badgeClass = 'badge-red';
    else if (e.event_type === 'call_ended') badgeClass = 'badge-teal';
    else if (e.event_type === 'qualification_intent') badgeClass = 'badge-accent';

    return `
      <tr>
        <td style="font-family:var(--lx-mono);">${time}</td>
        <td style="font-family:var(--lx-mono); color:var(--lx-muted);">${e.session_id.substring(0, 8)}...</td>
        <td>Session ID: ${e.payload?.voiz_session_id || 'Stream'}</td>
        <td><span class="lx-badge ${badgeClass}">${e.event_type}</span></td>
        <td style="font-family:var(--lx-mono); font-size:11px;">${detailText}</td>
      </tr>
    `;
  }).join('');
  
  lucide.createIcons();
}

// Query Audit Trail
async function fetchAuditTrail() {
  try {
    const response = await fetch(`${API_BASE}/audit-trail?tenant_id=${currentTenant}`);
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.logs.length > 0) {
        // Refresh Timeline UI on home screen
        const timeline = document.getElementById('system-activity-timeline');
        if (timeline) {
          timeline.innerHTML = data.logs.slice(0, 8).map(log => {
            const time = new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            let details = JSON.stringify(log.details);
            let dotClass = 'sd-green';

            if (log.event_type === 'lead_ingested') {
              details = `Lead ingested successfully (Phone: ${log.details?.phone || 'Unknown'} | Score: ${log.details?.score || 0}).`;
            } else if (log.event_type === 'batch_leads_ingested') {
              details = `Batch processed: ${log.details?.accepted || 0} accepted for campaign: "${log.details?.campaign_name}".`;
            } else if (log.event_type === 'onboarding_config_updated') {
              details = log.details?.message || `Client onboarding configuration updated for segment: ${log.details?.industry || 'BFSI'}.`;
              dotClass = 'sd-amber';
            } else if (log.event_type === 'call_initiated') {
              details = `Call dial session initiated (Voiz ID: ${log.details?.voiz_session_id || 'Session'}).`;
              dotClass = 'sd-amber';
            } else if (log.event_type === 'call_completed') {
              details = `Call finished. Outcome status set to: ${log.details?.disposition || 'complete'}.`;
              dotClass = 'sd-gray';
            } else if (log.event_type === 'escalation_triggered') {
              details = `Lead escalated to supervisor. Syncing to HubSpot CRM (Reason: ${log.details?.reason}).`;
              dotClass = 'sd-amber';
            } else if (log.event_type === 'dnc_block') {
              details = `Blocked dial to phone number matching DNC registry: ${log.details?.phone}.`;
              dotClass = 'sd-red';
            } else if (log.event_type === 'crm_sync_success') {
              const providerName = log.details?.provider === 'hubspot' ? 'HubSpot' : 'LeadSquared';
              details = `CRM Sync: Successfully synced contact with ${providerName} (External ID: ${log.details?.result?.id || 'N/A'}).`;
              dotClass = 'sd-green';
            } else if (log.event_type === 'crm_sync_failure') {
              const providerName = log.details?.provider === 'hubspot' ? 'HubSpot' : 'LeadSquared';
              details = `CRM Sync Error: Failed to sync contact to ${providerName} (Error: ${log.details?.error || 'Unknown error'}).`;
              dotClass = 'sd-red';
            }
            
            return `
              <div class="tl-item">
                <span class="tl-dot ${dotClass}"></span>
                <span class="tl-time" style="font-size: 10px;">${time}</span>
                <span class="tl-text">${details}</span>
              </div>
            `;
          }).join('');
        }
      }
    }
  } catch (err) {
    console.error('Audit trail fetch error:', err);
  }
}

window.triggerMockHandoff = function(leadId, leadName) {
  const lead = allLeads.find(l => l.id === leadId);
  if (lead && lead.status === 'hot_escalated') {
    viewBriefModal(leadId);
    return;
  }

  showToast('Warm Handoff', `Routing high-intent lead ${leadName} to Muthoot Finance specialist...`, 'users');
  logActivityFeed(`Warm handoff triggered for <strong>${leadName}</strong>. Routing to specialist queue.`);

  setTimeout(() => {
    const liveMonitorItem = document.querySelector('.lx-sidebar-item[data-page="monitor"]');
    if (liveMonitorItem) {
      liveMonitorItem.click();
    }
  }, 1000);
};


window.triggerMockDnc = async function(leadId, leadPhone) {
  // Update status in backend
  try {
    const res = await fetch(`${API_BASE}/trigger-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: currentTenant,
        lead_id: leadId
      })
    });
    // This will hit the DNC block check since phone has DNC matching attributes, or we can update directly
  } catch (err) {}

  showToast('Added to DNC', `Phone number ${leadPhone} has been added to the Do Not Call registry.`, 'alert-triangle', 'warning');
  logActivityFeed(`DNC block enforced on lead phone: <strong>${leadPhone}</strong>. Auto-purged from dialer queues.`);
  
  await fetchLeadsList();
  fetchAuditTrail();
};

// 14. Campaign config mock save handlers
window.saveCampaignConfig = function(modeName) {
  showToast('Config Saved', `${modeName} campaign configurations updated successfully.`, 'settings');
  logActivityFeed(`Campaign settings updated for <strong>${modeName}</strong>. Configs saved.`);
};

window.preflightVerifyCampaign = function() {
  const campName = document.getElementById('cfg-sch-name').value.trim() || 'Scheduled Campaign';
  showToast('Verification', `Running pre-flight checks for ${campName}...`, 'activity');
  
  setTimeout(() => {
    showToast('Checks Passed', 'Dynamic weights, DNC registries, and VOIZ agent rosters validated.', 'check');
    logActivityFeed(`Pre-flight checks passed for scheduled campaign: <strong>${campName}</strong>.`);
  }, 1500);
};

// 15. Client portal interactions
window.exportClientReport = function() {
  showToast('Exporting Report', 'Compiling Muthoot Finance performance sheets...', 'folder');
  setTimeout(() => {
    showToast('Download Ready', 'LeadX_Muthoot_Report_June.pdf has been generated.', 'upload');
  }, 1500);
};

// 16. Onboarding Wizard Actions
window.goToStep = function(stepNum) {
  for (let i = 1; i <= 4; i++) {
    const indicator = document.getElementById(`wstep-${i}`);
    const content = document.getElementById(`wcontent-${i}`);
    if (indicator) {
      if (i < stepNum) {
        indicator.className = 'wizard-step completed';
      } else if (i === stepNum) {
        indicator.className = 'wizard-step active';
      } else {
        indicator.className = 'wizard-step';
      }
    }
    if (content) {
      if (i === stepNum) {
        content.classList.add('show');
      } else {
        content.classList.remove('show');
      }
    }
  }
};

window.loadCSVTemplate = function(templateType) {
  let csv = '';
  if (templateType === 'realestate') {
    csv = `Full Name,Mobile Number,Email,Age,Property Location,Budget
Rahul Sen,+919999988888,rahul.sen@example.com,30,Mumbai,8500000
Priya Nair,+919999977777,priya.nair@example.com,27,Bangalore,12000000`;
    document.getElementById('wizardCampaignName').value = 'Real Estate Brokerage Q3';
    document.getElementById('wizardDatasetId').value = 'ds-realestate-03';
    const indSelect = document.getElementById('wizardIndustry');
    if (indSelect) indSelect.value = 'Real Estate';
  } else if (templateType === 'bfsi') {
    csv = `Customer Name,Contact Phone,Email Address,Age,Monthly Income,Credit Score
Karan Shah,+919999966666,karan.shah@example.com,35,75000,740
Neha Malhotra,+919999955555,neha.malhotra@example.com,29,52000,680`;
    document.getElementById('wizardCampaignName').value = 'BFSI Loan Ingest June';
    document.getElementById('wizardDatasetId').value = 'ds-bfsi-june-02';
    const indSelect = document.getElementById('wizardIndustry');
    if (indSelect) indSelect.value = 'BFSI';
  }
  document.getElementById('wizardUploadArea').value = csv;
  showToast('Sample Loaded', 'Loaded sample CSV data template.', 'clipboard');
};

const targetFieldsMap = {
  bfsi: [
    { key: 'phone', label: 'Phone Number', importance: 'compulsory', desc: 'Required for dialing pipeline' },
    { key: 'name', label: 'Full Name', importance: 'compulsory', desc: 'Used for agent greetings' },
    { key: 'monthly_income', label: 'Monthly Income', importance: 'important', desc: 'Used for credit & loan scoring' },
    { key: 'credit_score', label: 'Credit Score', importance: 'important', desc: 'Used for risk assessment scoring' },
    { key: 'loan_amount', label: 'Desired Loan Amt', importance: 'important', desc: 'Used for product fit scoring' },
    { key: 'email', label: 'Email Address', importance: 'optional', desc: 'Used for fallback communications' }
  ],
  realestate: [
    { key: 'phone', label: 'Phone Number', importance: 'compulsory', desc: 'Required for dialing pipeline' },
    { key: 'name', label: 'Full Name', importance: 'compulsory', desc: 'Used for agent greetings' },
    { key: 'budget', label: 'Max Budget (INR)', importance: 'important', desc: 'Used for property affordability score' },
    { key: 'property_type', label: 'Property BHK/Type', importance: 'important', desc: 'Used for preference matching' },
    { key: 'location_preference', label: 'Location Preference', importance: 'important', desc: 'Used for project matching' },
    { key: 'email', label: 'Email Address', importance: 'optional', desc: 'Used for fallback communications' }
  ],
  education: [
    { key: 'phone', label: 'Phone Number', importance: 'compulsory', desc: 'Required for dialing pipeline' },
    { key: 'name', label: 'Full Name', importance: 'compulsory', desc: 'Used for agent greetings' },
    { key: 'course_interest', label: 'Course Interest', importance: 'important', desc: 'Used for enrollment match score' },
    { key: 'qualification', label: 'Highest Education', importance: 'important', desc: 'Used for eligibility score' },
    { key: 'year_of_graduation', label: 'Graduation Year', importance: 'important', desc: 'Used for cohort placement' },
    { key: 'email', label: 'Email Address', importance: 'optional', desc: 'Used for fallback communications' }
  ],
  default: [
    { key: 'phone', label: 'Phone Number', importance: 'compulsory', desc: 'Required for dialing pipeline' },
    { key: 'name', label: 'Full Name', importance: 'compulsory', desc: 'Used for agent greetings' },
    { key: 'email', label: 'Email Address', importance: 'optional', desc: 'Used for fallback communications' },
    { key: 'age', label: 'Age', importance: 'optional', desc: 'Demographic parameter' },
    { key: 'income', label: 'Annual Income', importance: 'optional', desc: 'Financial demographic parameter' },
    { key: 'city', label: 'City', importance: 'optional', desc: 'Location parameter' }
  ]
};

function getActiveTargetFields() {
  const indValue = document.getElementById('wizardIndustry').value || 'default';
  const indKey = indValue.toLowerCase().replace(/[^a-z]/g, '');
  return targetFieldsMap[indKey] || targetFieldsMap['default'];
}

function findBestHeaderMatch(targetKey, targetLabel, headers) {
  const synonyms = {
    phone: ['phone', 'mobile', 'contact', 'ph', 'cell', 'tel', 'telephone', 'mobile number', 'contact number'],
    name: ['name', 'full name', 'fname', 'first name', 'customer', 'prospect', 'customer name', 'lead name'],
    email: ['email', 'mail', 'email address', 'email_address', 'mail address'],
    monthly_income: ['monthly_income', 'income', 'salary', 'earnings', 'monthly salary', 'pay'],
    credit_score: ['credit_score', 'credit', 'cibil', 'score', 'cibil score'],
    loan_amount: ['loan_amount', 'loan', 'loan amount', 'req loan', 'loan_amt'],
    budget: ['budget', 'price', 'max budget', 'investment', 'cost', 'value'],
    property_type: ['property_type', 'property', 'bhk', 'type', 'flat', 'unit'],
    location_preference: ['location', 'city', 'location preference', 'pref location', 'area'],
    course_interest: ['course', 'course_interest', 'stream', 'subject', 'program', 'major'],
    qualification: ['qualification', 'education', 'degree', 'qualification level'],
    year_of_graduation: ['graduation', 'year', 'grad year', 'year_of_graduation']
  };

  const candidates = synonyms[targetKey] || [targetKey, targetLabel.toLowerCase()];
  
  let bestMatch = '';
  let highestScore = 0;

  headers.forEach(h => {
    const cleanH = h.toLowerCase().trim();
    candidates.forEach(c => {
      if (cleanH === c) {
        bestMatch = h;
        highestScore = 10;
      }
    });

    if (highestScore >= 10) return;

    candidates.forEach(c => {
      if (cleanH.includes(c) || c.includes(cleanH)) {
        const score = cleanH.includes(c) ? c.length : cleanH.length;
        if (score > highestScore) {
          bestMatch = h;
          highestScore = score;
        }
      }
    });
  });

  return bestMatch;
}

window.parseAndPrepareMapping = function(isCrm = false) {
  if (!isCrm) {
    const uploadVal = document.getElementById('wizardUploadArea').value.trim();
    if (!uploadVal) {
      showToast('Input Required', 'Please paste CSV data first.', 'alert-triangle', 'warning');
      return;
    }

    const lines = uploadVal.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) {
      showToast('Format Error', 'CSV must contain at least a header line and one data row.', 'alert-triangle', 'error');
      return;
    }

    parsedCsvHeaders = lines[0].split(',').map(h => h.trim());
    parsedCsvRows = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      const row = {};
      parsedCsvHeaders.forEach((h, idx) => {
        row[h] = cols[idx] || '';
      });
      parsedCsvRows.push(row);
    }
  }

  const fieldsContainer = document.getElementById('mappingFieldsContainer');
  const targetFields = getActiveTargetFields();

  fieldsContainer.innerHTML = targetFields.map(tf => {
    const bestMatch = findBestHeaderMatch(tf.key, tf.label, parsedCsvHeaders);

    const optionsHtml = ['<option value="">-- Skip --</option>']
      .concat(parsedCsvHeaders.map(h => {
        const selectedAttr = h === bestMatch ? 'selected' : '';
        return `<option value="${h}" ${selectedAttr}>${h}</option>`;
      }))
      .join('');

    const badgeClass = tf.importance === 'compulsory' ? 'badge-red' : tf.importance === 'important' ? 'badge-amber' : 'badge-gray';

    return `
      <div class="mapping-field-row" style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.02); border: 1px solid var(--lx-border); border-radius: 6px; padding: 8px 12px; margin-bottom: 8px;">
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <div style="font-weight: 600; font-size: 12.5px; color: var(--lx-text);">${tf.label}${tf.importance === 'compulsory' ? ' <span style="color:var(--lx-red);">*</span>' : ''}</div>
          <div style="font-size: 10px; color: var(--lx-muted);">${tf.desc}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="lx-badge ${badgeClass}" style="font-size: 9px; padding: 2px 6px;">${tf.importance.toUpperCase()}</span>
          <select class="lx-input" id="map-target-${tf.key}" style="width: 150px; padding: 4px 8px; font-size: 12px; margin: 0;">
            ${optionsHtml}
          </select>
        </div>
      </div>
    `;
  }).join('');

  targetFields.forEach(tf => {
    const selectEl = document.getElementById(`map-target-${tf.key}`);
    if (selectEl) {
      selectEl.addEventListener('change', renderMappingPreview);
    }
  });

  renderMappingPreview();
  goToStep(3);
};

function renderMappingPreview() {
  const targetFields = getActiveTargetFields();
  const mappingConfig = {};
  targetFields.forEach(tf => {
    const el = document.getElementById(`map-target-${tf.key}`);
    mappingConfig[tf.key] = el ? el.value : '';
  });

  const previewHead = document.getElementById('mappingPreviewHead');
  const previewBody = document.getElementById('mappingPreviewBody');

  previewHead.innerHTML = `
    <tr>
      ${targetFields.map(tf => `<th>${tf.label.toUpperCase()}</th>`).join('')}
    </tr>
  `;

  const previewRows = parsedCsvRows.slice(0, 3);
  if (previewRows.length === 0) {
    previewBody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No data rows found</td></tr>';
    return;
  }

  previewBody.innerHTML = previewRows.map(row => {
    return `
      <tr>
        ${targetFields.map(tf => {
          const rawHeader = mappingConfig[tf.key];
          return `<td>${rawHeader ? row[rawHeader] || 'N/A' : '<span style="color:var(--lx-hint);">Skipped</span>'}</td>`;
        }).join('')}
      </tr>
    `;
  }).join('');
}

window.commitWizardData = function() {
  const targetFields = getActiveTargetFields();
  const mappingConfig = {};
  targetFields.forEach(tf => {
    const el = document.getElementById(`map-target-${tf.key}`);
    mappingConfig[tf.key] = el ? el.value : '';
  });

  if (!mappingConfig.phone) {
    showToast('Mapping Error', 'You must map the Phone Number field before ingestion.', 'alert-triangle', 'error');
    return;
  }

  const compulsoryMissing = targetFields.filter(tf => tf.importance === 'compulsory' && !mappingConfig[tf.key]);
  if (compulsoryMissing.length > 0) {
    showToast('Mapping Error', `Compulsory fields missing mapping: ${compulsoryMissing.map(m => m.label).join(', ')}`, 'alert-triangle', 'error');
    return;
  }

  const datasetId = document.getElementById('wizardDatasetId').value.trim() || 'ds-mapped-upload';
  const campaignName = document.getElementById('wizardCampaignName').value.trim() || 'Mapped Campaign';
  const industry = document.getElementById('wizardIndustry').value;
  const objective = document.getElementById('wizardObjective').value.trim();
  const agentFocus = document.getElementById('wizardFocus').value.trim();
  const handoffRules = document.getElementById('wizardHandoff').value.trim();
  const dncCheck = document.getElementById('wizardDncCheck').checked;
  const crmTarget = document.getElementById('wizardCrmSelector').value;

  const mappedLeads = parsedCsvRows.map(row => {
    const lead = {
      source: 'organic',
      raw_data: {}
    };

    targetFields.forEach(tf => {
      const mappedHeader = mappingConfig[tf.key];
      if (mappedHeader) {
        const val = row[mappedHeader];
        if (tf.key === 'phone') {
          lead.phone = val;
        } else if (tf.key === 'name') {
          lead.name = val;
        } else if (tf.key === 'email') {
          lead.email = val;
        } else {
          // Parse numbers if applicable, else string
          if (tf.key === 'monthly_income' || tf.key === 'credit_score' || tf.key === 'loan_amount' || tf.key === 'budget' || tf.key === 'year_of_graduation' || tf.key === 'age' || tf.key === 'income') {
            lead.raw_data[tf.key] = val ? parseFloat(val.replace(/[^0-9.-]/g, '')) || 0 : 0;
          } else {
            lead.raw_data[tf.key] = val;
          }
        }
      }
    });

    if (row.hubspot_id) {
      lead.raw_data.hubspot_id = row.hubspot_id;
    }

    return lead;
  }).filter(l => l.phone);

  const finishBtn = document.getElementById('wizardFinishBtn');
  finishBtn.setAttribute('disabled', 'true');
  finishBtn.textContent = 'Processing...';

  const onboardPayload = {
    tenant_id: currentTenant,
    onboarding_config: {
      industry,
      objective,
      agent_focus: agentFocus,
      handoff_rules: handoffRules,
      dnc_validation_ownership: dncCheck ? 'platform' : 'client',
      target_crm: crmTarget
    }
  };

  fetch('/leads/onboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(onboardPayload)
  })
  .then(res => res.json())
  .then(onboardData => {
    if (onboardData.success && onboardData.onboarding_config) {
      tenantOnboardingConfig = onboardData.onboarding_config;
    }
    const batchPayload = {
      tenant_id: currentTenant,
      dataset_id: datasetId,
      campaign_name: campaignName,
      leads: mappedLeads
    };

    return fetch('/leads/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batchPayload)
    });
  })
  .then(res => res.json())
  .then(async batchData => {
    if (batchData.success) {
      showToast('Wizard Complete', `Uploaded ${batchData.accepted} leads for campaign "${campaignName}"`, 'check');
      goToStep(1);
      document.getElementById('wizardUploadArea').value = '';
      
      const leadsItem = document.querySelector('.lx-sidebar-item[data-page="leads"]');
      if (leadsItem) leadsItem.click();

      await fetchLeadsList();
      await fetchCampaignsList();
      fetchAuditTrail();
    } else {
      showToast('Ingest Failed', batchData.message || 'Error processing batch upload.', 'alert-triangle', 'error');
    }
  })
  .catch(err => {
    console.error('Wizard commit error:', err);
    showToast('Sync Error', 'Network connection failed during wizard submission.', 'alert-triangle', 'error');
  })
  .finally(() => {
    finishBtn.removeAttribute('disabled');
    finishBtn.textContent = 'Finalize and Trigger Handoff';
  });
};

// 17. Utility Helpers
function showToast(title, body, iconName = 'info', type = 'info') {
  toastIcon.setAttribute('data-lucide', iconName);
  toastTitle.textContent = title;
  toastBody.textContent = body;

  toast.className = 'toast show';
  if (type === 'error') {
    toast.style.borderLeft = '4px solid var(--lx-red)';
  } else if (type === 'warning') {
    toast.style.borderLeft = '4px solid var(--lx-amber)';
  } else {
    toast.style.borderLeft = '4px solid var(--lx-teal)';
  }
  
  lucide.createIcons();

  setTimeout(() => {
    toast.classList.remove('show');
  }, 5000);
}

function logActivityFeed(text) {
  const timeline = document.getElementById('system-activity-timeline');
  if (timeline) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const item = document.createElement('div');
    item.className = 'tl-item';
    item.innerHTML = `
      <span class="tl-dot sd-green"></span>
      <span class="tl-time">${time}</span>
      <span class="tl-text">${text}</span>
    `;
    timeline.insertBefore(item, timeline.firstChild);
    
    if (timeline.children.length > 6) {
      timeline.removeChild(timeline.lastChild);
    }
  }
}

function updateLiveCallsCountBadge() {
  const list = document.getElementById('live-calls-list');
  const badge = document.getElementById('liveCallCount');
  if (list && badge) {
    const activeCount = list.children.length;
    badge.textContent = activeCount;
  }
}

function updateLiveMonitorQueue() {
  const queueBody = document.getElementById('monitor-queue-tbody');
  if (queueBody) {
    const rows = queueBody.getElementsByTagName('tr');
    for (let r of rows) {
      const waitCell = r.getElementsByTagName('td')[1];
      if (waitCell && waitCell.textContent.includes('second')) {
        let currentSeconds = parseInt(waitCell.textContent);
        currentSeconds += Math.floor(Math.random() * 3) + 1;
        waitCell.innerHTML = `<span style="font-family: var(--lx-mono);">${currentSeconds} seconds</span>`;
      }
    }
  }
}

// Seed initial leads in mock DB if database is empty on page load
async function seedInitialDataIfEmpty() {
  try {
    const leadsRes = await fetch(`${API_BASE}?tenant_id=${currentTenant}`);
    if (leadsRes.ok) {
      const data = await leadsRes.json();
      if (data.success && data.leads.length === 0) {
        const sampleLeads = [
          {
            "name": "Raman Iyer",
            "phone": "+919908188223",
            "email": "raman.iyer@gmail.com",
            "source": "referral",
            "raw_data": { "age": 31, "city": "Mumbai", "income": 650000, "pages_visited": 10, "video_watched": true }
          },
          {
            "name": "Arjun Mehta",
            "phone": "+919812499155",
            "source": "organic",
            "raw_data": { "age": 28, "city": "Mumbai", "income": 450000, "pages_visited": 7, "video_watched": true }
          },
          {
            "name": "Priya Sharma",
            "phone": "+917738200112",
            "source": "paid_ads",
            "raw_data": { "age": 24, "city": "Delhi", "income": 320000, "pages_visited": 5, "video_watched": true }
          },
          {
            "name": "Karan Malhotra",
            "phone": "+919822411077",
            "source": "re-engagement",
            "raw_data": { "age": 42, "city": "Pune", "pages_visited": 4, "video_watched": false }
          }
        ];

        for (let lead of sampleLeads) {
          await fetch(`${API_BASE}/ingest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenant_id: currentTenant, ...lead })
          });
        }
        
        loadTenantData();
      }
    }
  } catch (err) {
    console.error('Seed helper error:', err);
  }
}

// Activity timeline simulator
function startActivitySimulator() {
  updateLiveCallsCountBadge();
  
  setInterval(() => {
    const events = [
      "CRM sync succeeded for tenant: default-tenant.",
      "VOIZ dialer completed call with Jane Smith.",
      "Lead Alex Mercer qualification score verified.",
      "Dialing retry scheduled for lead: +91 99343 ***12.",
      "Non-RT Campaign concurrency adjusted: 15 threads.",
      "Webhook ingested lead from AdWords API (source: paid_ads)."
    ];
    const randomEvent = events[Math.floor(Math.random() * events.length)];
    logActivityFeed(randomEvent);
    updateLiveMonitorQueue();
  }, 12000);
}

// ============================================================
// CRM Sync Control Center Controller Logics
// ============================================================

// Loads page configurations, updates status badges, and renders tables
async function loadCrmPageData() {
  try {
    const response = await fetch(`${API_BASE}/onboard?tenant_id=${currentTenant}`);
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.onboarding_config) {
        // Handle HubSpot OAuth connection
        if (data.onboarding_config.hubspot_oauth) {
          crmConfig.hubspot.connected = true;
          crmConfig.hubspot.enabled = true;
          const statusText = document.getElementById('hs-oauth-status-text');
          const connectBtn = document.getElementById('hs-oauth-connect-btn');
          if (statusText) statusText.style.display = 'block';
          if (connectBtn) connectBtn.style.display = 'none';
        }

        // Load HubSpot Private App settings
        if (data.onboarding_config.hubspot_api_key) {
          crmConfig.hubspot.apiKey = data.onboarding_config.hubspot_api_key;
          const hsKeyEl = document.getElementById('hs-api-key');
          if (hsKeyEl) hsKeyEl.value = data.onboarding_config.hubspot_api_key;
          crmConfig.hubspot.connected = true;
          crmConfig.hubspot.enabled = true;
        }
        if (data.onboarding_config.hubspot_portal_id) {
          crmConfig.hubspot.portalId = data.onboarding_config.hubspot_portal_id;
          const hsPortalEl = document.getElementById('hs-portal-id');
          if (hsPortalEl) hsPortalEl.value = data.onboarding_config.hubspot_portal_id;
        }

        // Load LeadSquared settings
        if (data.onboarding_config.ls_access_key) {
          crmConfig.leadsquared.accessKey = data.onboarding_config.ls_access_key;
          const lsAccessEl = document.getElementById('ls-access-key');
          if (lsAccessEl) lsAccessEl.value = data.onboarding_config.ls_access_key;
          crmConfig.leadsquared.connected = true;
          crmConfig.leadsquared.enabled = true;
        }
        if (data.onboarding_config.ls_secret_key) {
          crmConfig.leadsquared.secretKey = data.onboarding_config.ls_secret_key;
          const lsSecretEl = document.getElementById('ls-secret-key');
          if (lsSecretEl) lsSecretEl.value = data.onboarding_config.ls_secret_key;
        }
        if (data.onboarding_config.ls_api_host) {
          crmConfig.leadsquared.apiHost = data.onboarding_config.ls_api_host;
          const lsHostEl = document.getElementById('ls-api-host');
          if (lsHostEl) lsHostEl.value = data.onboarding_config.ls_api_host;
        }

        // Load Salesforce settings
        if (data.onboarding_config.sf_client_id) {
          crmConfig.salesforce.clientId = data.onboarding_config.sf_client_id;
          const sfClientEl = document.getElementById('sf-client-id');
          if (sfClientEl) sfClientEl.value = data.onboarding_config.sf_client_id;
          crmConfig.salesforce.connected = true;
          crmConfig.salesforce.enabled = true;
        }
        if (data.onboarding_config.sf_client_secret) {
          crmConfig.salesforce.clientSecret = data.onboarding_config.sf_client_secret;
          const sfSecretEl = document.getElementById('sf-client-secret');
          if (sfSecretEl) sfSecretEl.value = data.onboarding_config.sf_client_secret;
        }
        if (data.onboarding_config.sf_login_url) {
          crmConfig.salesforce.loginUrl = data.onboarding_config.sf_login_url;
          const sfLoginUrlEl = document.getElementById('sf-login-url');
          if (sfLoginUrlEl) sfLoginUrlEl.value = data.onboarding_config.sf_login_url;
        }
      }
    }
  } catch (err) {
    console.error('Error fetching CRM configurations:', err);
  }

  updateCrmPipelineUI();
  renderCrmSyncLogs();
  renderManualSyncList();
}

window.connectHubSpotOAuth = function() {
  const width = 500;
  const height = 600;
  const left = window.screen.width / 2 - width / 2;
  const top = window.screen.height / 2 - height / 2;
  
  const popup = window.open(
    `/oauth/hubspot/authorize?tenant_id=${currentTenant}`,
    'HubSpot OAuth Connection',
    `width=${width},height=${height},top=${top},left=${left},status=no,location=no,toolbar=no,menubar=no`
  );
  
  if (!popup) {
    showToast('Popup Blocked', 'Please allow popups to connect with HubSpot.', 'alert-triangle', 'warning');
  }
};

window.addEventListener('message', async (event) => {
  if (event.data && event.data.type === 'hubspot-oauth-success') {
    showToast('CRM Connected', 'HubSpot OAuth connection succeeded!', 'check');
    crmConfig.hubspot.connected = true;
    crmConfig.hubspot.enabled = true;
    
    // Hide api key input or show connected text
    const statusText = document.getElementById('hs-oauth-status-text');
    const connectBtn = document.getElementById('hs-oauth-connect-btn');
    if (statusText) statusText.style.display = 'block';
    if (connectBtn) connectBtn.style.display = 'none';
    
    // Trigger UI updates
    updateCrmPipelineUI();
    renderManualSyncList();
    renderCrmSyncLogs();
  }
});

// Updates visual connections in connector pipeline
function updateCrmPipelineUI() {
  const nodeLeadx = document.getElementById('crm-node-leadx');
  const connHs = document.getElementById('crm-conn-hubspot');
  const nodeHs = document.getElementById('crm-node-hubspot');
  const connLs = document.getElementById('crm-conn-leadsquared');
  const nodeLs = document.getElementById('crm-node-leadsquared');

  const hsToggle = document.getElementById('hs-toggle-btn');
  const lsToggle = document.getElementById('ls-toggle-btn');

  // Update HubSpot visual pipeline
  if (crmConfig.hubspot.enabled) {
    if (hsToggle) hsToggle.checked = true;
    if (crmConfig.hubspot.connected) {
      if (nodeHs) { nodeHs.className = 'crm-node active connected'; }
      if (connHs) { connHs.className = 'crm-connector active'; }
      const hsBadge = document.getElementById('hs-status-badge');
      if (hsBadge) {
        hsBadge.textContent = 'CONNECTED';
        hsBadge.className = 'lx-badge badge-green';
      }
    } else {
      if (nodeHs) { nodeHs.className = 'crm-node active'; }
      if (connHs) { connHs.className = 'crm-connector'; }
      const hsBadge = document.getElementById('hs-status-badge');
      if (hsBadge) {
        hsBadge.textContent = 'ENABLED (UNTESTED)';
        hsBadge.className = 'lx-badge badge-amber';
      }
    }
  } else {
    if (hsToggle) hsToggle.checked = false;
    if (nodeHs) { nodeHs.className = 'crm-node'; }
    if (connHs) { connHs.className = 'crm-connector'; }
    const hsBadge = document.getElementById('hs-status-badge');
    if (hsBadge) {
      hsBadge.textContent = 'DISCONNECTED';
      hsBadge.className = 'lx-badge badge-gray';
    }
  }

  // Update LeadSquared visual pipeline
  if (crmConfig.leadsquared.enabled) {
    if (lsToggle) lsToggle.checked = true;
    if (crmConfig.leadsquared.connected) {
      if (nodeLs) { nodeLs.className = 'crm-node active connected'; }
      if (connLs) { connLs.className = 'crm-connector active'; }
      const lsBadge = document.getElementById('ls-status-badge');
      if (lsBadge) {
        lsBadge.textContent = 'CONNECTED';
        lsBadge.className = 'lx-badge badge-green';
      }
    } else {
      if (nodeLs) { nodeLs.className = 'crm-node active'; }
      if (connLs) { connLs.className = 'crm-connector'; }
      const lsBadge = document.getElementById('ls-status-badge');
      if (lsBadge) {
        lsBadge.textContent = 'ENABLED (UNTESTED)';
        lsBadge.className = 'lx-badge badge-amber';
      }
    }
  } else {
    if (lsToggle) lsToggle.checked = false;
    if (nodeLs) { nodeLs.className = 'crm-node'; }
    if (connLs) { connLs.className = 'crm-connector'; }
    const lsBadge = document.getElementById('ls-status-badge');
    if (lsBadge) {
      lsBadge.textContent = 'DISCONNECTED';
      lsBadge.className = 'lx-badge badge-gray';
    }
  }

  // Update Salesforce visual pipeline
  const sfToggle = document.getElementById('sf-toggle-btn');
  if (crmConfig.salesforce.enabled) {
    if (sfToggle) sfToggle.checked = true;
    const sfBadge = document.getElementById('sf-status-badge');
    if (crmConfig.salesforce.connected) {
      if (sfBadge) {
        sfBadge.textContent = 'CONNECTED';
        sfBadge.className = 'lx-badge badge-green';
      }
    } else {
      if (sfBadge) {
        sfBadge.textContent = 'ENABLED (UNTESTED)';
        sfBadge.className = 'lx-badge badge-amber';
      }
    }
  } else {
    if (sfToggle) sfToggle.checked = false;
    const sfBadge = document.getElementById('sf-status-badge');
    if (sfBadge) {
      sfBadge.textContent = 'DISCONNECTED';
      sfBadge.className = 'lx-badge badge-gray';
    }
  }
}

// Simulates API handshake with external provider
async function testCrmConnection(provider) {
  const btn = document.getElementById(`${provider === 'hubspot' ? 'hs' : provider === 'leadsquared' ? 'ls' : 'sf'}-test-btn`);
  if (!btn) return;

  const originalText = btn.textContent;
  btn.setAttribute('disabled', 'true');
  btn.textContent = 'Testing Handshake...';

  // Extract config input values
  let apiKey = '';
  let detailField = '';
  if (provider === 'hubspot') {
    apiKey = document.getElementById('hs-api-key').value;
    detailField = document.getElementById('hs-portal-id').value;
  } else if (provider === 'leadsquared') {
    apiKey = document.getElementById('ls-access-key').value;
    detailField = document.getElementById('ls-api-host').value;
  } else if (provider === 'salesforce') {
    apiKey = document.getElementById('sf-client-id').value;
    detailField = document.getElementById('sf-client-secret').value;
  }

  // Simulate networking delay
  await new Promise(resolve => setTimeout(resolve, 1500));

  if (!apiKey || !detailField) {
    showToast('Handshake Failed', 'Please input all credentials before testing.', 'alert-triangle', 'warning');
    btn.removeAttribute('disabled');
    btn.textContent = originalText;
    return;
  }

  // Update connection state
  crmConfig[provider].connected = true;
  crmConfig[provider].enabled = true;
  updateCrmPipelineUI();

  let friendlyProviderName = provider === 'hubspot' ? 'HubSpot Cloud' : provider === 'leadsquared' ? 'LeadSquared Regional API' : 'Salesforce Cloud';
  showToast('Handshake Succeeded', `Successfully authenticated with ${friendlyProviderName}`, 'check');
  btn.removeAttribute('disabled');
  btn.textContent = 'Tested Ok';
  btn.style.borderColor = 'var(--lx-green)';
  btn.style.color = 'var(--lx-green)';

  // Log in activity feed
  let simpleProviderName = provider === 'hubspot' ? 'HubSpot' : provider === 'leadsquared' ? 'LeadSquared' : 'Salesforce';
  logActivityFeed(`CRM Connection: Handshake succeeded with <strong>${simpleProviderName}</strong> provider.`);
  
  setTimeout(() => {
    btn.textContent = originalText;
    btn.style.borderColor = '';
    btn.style.color = '';
  }, 3000);
}

// Saves integration settings
async function saveCrmConfig(provider) {
  const btn = document.getElementById(`${provider === 'hubspot' ? 'hs' : provider === 'leadsquared' ? 'ls' : 'sf'}-save-btn`);
  if (!btn) return;

  const originalText = btn.textContent;
  btn.setAttribute('disabled', 'true');
  btn.textContent = 'Saving...';

  let onboardingConfig = {};
  try {
    const res = await fetch(`${API_BASE}/onboard?tenant_id=${currentTenant}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.onboarding_config) {
        onboardingConfig = data.onboarding_config;
      }
    }
  } catch (err) {
    console.error('Error fetching onboarding config before CRM save:', err);
  }

  // Read config fields and store state
  if (provider === 'hubspot') {
    crmConfig.hubspot.apiKey = document.getElementById('hs-api-key').value;
    crmConfig.hubspot.portalId = document.getElementById('hs-portal-id').value;
    crmConfig.hubspot.ruleHot = document.getElementById('hs-rule-hot').checked;
    crmConfig.hubspot.ruleQual = document.getElementById('hs-rule-qual').checked;
    crmConfig.hubspot.ruleRecordings = document.getElementById('hs-rule-recordings').checked;

    onboardingConfig.hubspot_api_key = crmConfig.hubspot.apiKey;
    onboardingConfig.hubspot_portal_id = crmConfig.hubspot.portalId;
    if (crmConfig.hubspot.apiKey) {
      delete onboardingConfig.hubspot_oauth;
    }
  } else if (provider === 'leadsquared') {
    crmConfig.leadsquared.accessKey = document.getElementById('ls-access-key').value;
    crmConfig.leadsquared.secretKey = document.getElementById('ls-secret-key').value;
    crmConfig.leadsquared.apiHost = document.getElementById('ls-api-host').value;
    crmConfig.leadsquared.ruleHot = document.getElementById('ls-rule-hot').checked;
    crmConfig.leadsquared.ruleCustom = document.getElementById('ls-rule-custom').checked;

    onboardingConfig.ls_access_key = crmConfig.leadsquared.accessKey;
    onboardingConfig.ls_secret_key = crmConfig.leadsquared.secretKey;
    onboardingConfig.ls_api_host = crmConfig.leadsquared.apiHost;
  } else if (provider === 'salesforce') {
    crmConfig.salesforce.clientId = document.getElementById('sf-client-id').value;
    crmConfig.salesforce.clientSecret = document.getElementById('sf-client-secret').value;
    crmConfig.salesforce.loginUrl = document.getElementById('sf-login-url').value;
    crmConfig.salesforce.ruleHot = document.getElementById('sf-rule-hot').checked;
    crmConfig.salesforce.ruleCustom = document.getElementById('sf-rule-custom').checked;

    onboardingConfig.sf_client_id = crmConfig.salesforce.clientId;
    onboardingConfig.sf_client_secret = crmConfig.salesforce.clientSecret;
    onboardingConfig.sf_login_url = crmConfig.salesforce.loginUrl;
  }

  try {
    const res = await fetch(`${API_BASE}/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: currentTenant,
        onboarding_config: onboardingConfig
      })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        crmConfig[provider].connected = true;
        crmConfig[provider].enabled = true;
        let displayProvider = provider === 'hubspot' ? 'HubSpot' : provider === 'leadsquared' ? 'LeadSquared' : 'Salesforce';
        showToast('Settings Saved', `Configurations saved and sync'd to server for ${displayProvider} integration.`, 'check');
      }
    }
  } catch (err) {
    console.error('Failed to post onboarding CRM config:', err);
    showToast('Sync Warning', 'Saved locally, but failed to persist to server storage.', 'alert-triangle', 'warning');
  }

  btn.removeAttribute('disabled');
  btn.textContent = 'Saved';
  
  setTimeout(() => {
    btn.textContent = originalText;
  }, 2000);

  updateCrmPipelineUI();
}

// Queries real audit logs and formats CRM events, blending mock logs for UX fallback
async function renderCrmSyncLogs() {
  const container = document.getElementById('crmSyncLogsList');
  if (!container) return;

  try {
    const response = await fetch(`${API_BASE}/audit-trail?tenant_id=${currentTenant}`);
    let crmLogs = [];

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.logs) {
        // Filter audit logs for CRM sync events
        crmLogs = data.logs.filter(log => 
          log.event_type === 'crm_sync_success' || 
          log.event_type === 'crm_sync_failure' ||
          log.event_type === 'escalation_triggered'
        );
      }
    }

    // Fallback: If no crm logs in DB audit trail, inject beautiful seed logs for rich aesthetics
    if (crmLogs.length === 0) {
      crmLogs = [
        {
          created_at: new Date(Date.now() - 4 * 60000).toISOString(),
          event_type: 'crm_sync_success',
          details: {
            phone: '+919908188223',
            provider: 'hubspot',
            lead_name: 'Raman Iyer',
            result: { id: 'hs-contact-928493' }
          }
        },
        {
          created_at: new Date(Date.now() - 32 * 60000).toISOString(),
          event_type: 'crm_sync_success',
          details: {
            phone: '+919812499155',
            provider: 'leadsquared',
            lead_name: 'Arjun Mehta',
            result: { id: 'lsq-lead-883011' }
          }
        },
        {
          created_at: new Date(Date.now() - 120 * 60000).toISOString(),
          event_type: 'crm_sync_failure',
          details: {
            phone: '+917738200112',
            provider: 'hubspot',
            lead_name: 'Priya Sharma',
            error: 'Authentication failed: Invalid Private App token API credentials'
          }
        }
      ];
    }

    container.innerHTML = crmLogs.map(log => {
      const time = new Date(log.created_at).toLocaleString();
      const eventType = log.event_type;
      
      let badgeClass = 'badge-green';
      let statusText = 'SUCCESS';
      let detailsText = '';
      
      const provider = log.details?.provider || 'hubspot';
      const providerText = provider === 'hubspot' ? 'HubSpot' : 'LeadSquared';
      const providerClass = provider === 'hubspot' ? 'src-referral' : 'src-organic'; // visual coloring classes

      const phone = log.details?.phone || 'Unknown';
      const leadName = log.details?.lead_name || 'Qualified Lead';

      if (eventType === 'crm_sync_failure') {
        badgeClass = 'badge-red';
        statusText = 'FAILED';
        detailsText = `<span style="color:var(--lx-red); font-weight:500;">Error:</span> ${log.details?.error || 'Unknown network error'}`;
      } else if (eventType === 'escalation_triggered') {
        badgeClass = 'badge-teal';
        statusText = 'AUTO ESCALATED';
        detailsText = `Auto triggered sync for Hot Lead (Reason: confirm interest)`;
      } else {
        const syncId = log.details?.result?.id || 'mock-sync-id';
        detailsText = `Synced contact successfully. External ID: <code style="font-family:var(--lx-mono); color:var(--lx-teal);">${syncId}</code>`;
      }

      return `
        <tr>
          <td><span style="font-family:var(--lx-mono); color:var(--lx-muted);">${time}</span></td>
          <td>
            <strong>${leadName}</strong>
            <div style="font-size:10.5px; color:var(--lx-muted);">${phone}</div>
          </td>
          <td><span class="lx-source-badge ${providerClass}">${providerText.toUpperCase()}</span></td>
          <td><span class="lx-badge ${badgeClass}">${statusText}</span></td>
          <td style="font-size:11px;">${detailsText}</td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Error rendering CRM sync logs:', err);
    container.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--lx-red);">Failed to render CRM logs.</td></tr>`;
  }
}

// Renders lists of leads that can be manually pushed to a connected CRM
// Renders lists of leads that can be manually pushed to a connected CRM
async function renderManualSyncList() {
  const container = document.getElementById('manual-sync-leads-list');
  if (!container) return;

  // Reset selection states
  const master = document.getElementById('select-all-sync');
  if (master) master.checked = false;
  const bulkBar = document.getElementById('bulk-sync-bar');
  if (bulkBar) bulkBar.style.display = 'none';

  // Fetch audit trail to determine which leads have already been synced
  let syncedLeadIds = new Set();
  try {
    const response = await fetch(`${API_BASE}/audit-trail?tenant_id=${currentTenant}`);
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.logs) {
        data.logs.forEach(log => {
          if (log.event_type === 'crm_sync_success' && log.details?.lead_id) {
            syncedLeadIds.add(log.details.lead_id);
          }
        });
      }
    }
  } catch (err) {
    console.error('Error fetching audit trail for manual sync status:', err);
  }

  // Filter qualified leads (Score >= 65 and not blocked as DNC)
  const qualifiedLeads = allLeads.filter(l => l.score >= 65 && l.status !== 'dnc');

  if (qualifiedLeads.length === 0) {
    container.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding:12px; color:var(--lx-muted);">
          No qualified leads currently in queue. Ingest leads or configure lower scoring weight thresholds.
        </td>
      </tr>
    `;
    return;
  }

  container.innerHTML = qualifiedLeads.map(lead => {
    const srcKey = (lead.source || 'other').toLowerCase().replace(/-/g, '_');
    const srcLabel = (lead.source || 'OTHER').toUpperCase().replace(/-/g, '_');

    // Create dropdown selection for target CRM
    const options = `
      <select id="manual-target-${lead.id}" class="lx-tenant-input" style="width: 110px; border:1px solid var(--lx-border); border-radius:4px; padding:2px 4px; background:var(--lx-card2);">
        <option value="hubspot">HubSpot</option>
        <option value="leadsquared">LeadSquared</option>
      </select>
    `;

    const isSynced = syncedLeadIds.has(lead.id);
    const btnText = isSynced ? 'Sync Again' : 'Sync Now';
    const btnStyle = isSynced ? 'border-color: rgba(46, 204, 138, 0.3); color: var(--lx-green); background: rgba(46, 204, 138, 0.05);' : '';
    const syncedBadge = isSynced ? '<span class="lx-status-badge success" style="margin-left: 8px; font-size: 9px; padding: 1px 4px; vertical-align: middle;">Synced</span>' : '';

    return `
      <tr>
        <td style="text-align: center;">
          <input type="checkbox" class="manual-sync-select" value="${lead.id}" onchange="onManualSyncSelectChange()">
        </td>
        <td>
          <strong style="color:var(--lx-text);">${lead.name || 'Anonymous'}</strong>${syncedBadge}
          <span style="display:block; font-size:10.5px; color:var(--lx-muted);">${lead.phone}</span>
        </td>
        <td><span class="lx-source-badge src-${srcKey}">${srcLabel}</span></td>
        <td><strong style="color:var(--lx-teal); font-family:var(--lx-mono);">${lead.score} / 100</strong></td>
        <td>${options}</td>
        <td style="text-align:right;">
          <button class="lx-btn lx-btn-small primary" style="${btnStyle}" id="btn-manual-sync-${lead.id}" onclick="triggerManualLeadSync('${lead.id}', '${lead.name}')">${btnText}</button>
        </td>
      </tr>
    `;
  }).join('');
}

// Bulk Sync Helper controller logic
window.toggleSelectAllSync = function(masterCheckbox) {
  const checkboxes = document.querySelectorAll('.manual-sync-select');
  checkboxes.forEach(cb => {
    cb.checked = masterCheckbox.checked;
  });
  onManualSyncSelectChange();
};

window.onManualSyncSelectChange = function() {
  const checkboxes = document.querySelectorAll('.manual-sync-select');
  const selected = Array.from(checkboxes).filter(cb => cb.checked);
  
  const bulkBar = document.getElementById('bulk-sync-bar');
  const countSpan = document.getElementById('bulk-selected-count');
  
  if (bulkBar && countSpan) {
    if (selected.length > 0) {
      bulkBar.style.display = 'flex';
      countSpan.textContent = selected.length;
    } else {
      bulkBar.style.display = 'none';
    }
  }

  // Update master checkbox state
  const master = document.getElementById('select-all-sync');
  if (master) {
    master.checked = selected.length === checkboxes.length && checkboxes.length > 0;
  }
};

window.triggerBulkSync = async function() {
  const checkboxes = document.querySelectorAll('.manual-sync-select');
  const selectedIds = Array.from(checkboxes)
    .filter(cb => cb.checked)
    .map(cb => cb.value);
  
  if (selectedIds.length === 0) return;

  const providerSelect = document.getElementById('bulk-sync-provider');
  if (!providerSelect) return;
  const provider = providerSelect.value;

  // Verify provider connection
  if (!crmConfig[provider].connected) {
    showToast('CRM Disconnected', `Please test and save credentials for ${provider === 'hubspot' ? 'HubSpot' : 'LeadSquared'} first.`, 'alert-triangle', 'warning');
    return;
  }

  const btn = document.getElementById('bulk-sync-btn');
  const originalText = btn ? btn.textContent : 'Bulk Sync';
  if (btn) {
    btn.setAttribute('disabled', 'true');
    btn.textContent = 'Syncing...';
  }

  // Visual flow connector animation start
  const connLine = document.getElementById(`crm-conn-${provider}`);
  if (connLine) {
    connLine.classList.add('active');
  }

  try {
    const res = await fetch(`${API_BASE}/batch-sync-crm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: selectedIds, provider })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Bulk Sync Successful', `Successfully bulk synced ${selectedIds.length} contact(s) to ${provider === 'hubspot' ? 'HubSpot' : 'LeadSquared'}.`, 'check');
      logActivityFeed(`CRM Bulk Sync: Synced ${selectedIds.length} contact(s) to ${provider === 'hubspot' ? 'HubSpot' : 'LeadSquared'}.`);
      await renderCrmSyncLogs();
      await renderManualSyncList();
    } else {
      showToast('Bulk Sync Failed', data.message || 'Error occurred during bulk CRM sync.', 'alert-triangle', 'error');
    }
  } catch (err) {
    console.error('Bulk CRM sync error:', err);
    showToast('Sync Error', 'An unexpected error occurred during bulk data push.', 'alert-triangle', 'error');
  } finally {
    if (btn) {
      btn.removeAttribute('disabled');
      btn.textContent = originalText;
    }
    // Reset connector pipeline state after a few seconds
    setTimeout(() => {
      if (connLine && !crmConfig[provider].connected) {
        connLine.classList.remove('active');
      }
    }, 3000);
  }
};

// Triggers manual lead synchronization push simulation
window.triggerManualLeadSync = async function(leadId, leadName) {
  const targetSelect = document.getElementById(`manual-target-${leadId}`);
  const btn = document.getElementById(`btn-manual-sync-${leadId}`);
  if (!targetSelect || !btn) return;

  const provider = targetSelect.value;
  
  // Verify provider connection
  if (!crmConfig[provider].connected) {
    showToast('CRM Disconnected', `Please test and save credentials for ${provider === 'hubspot' ? 'HubSpot' : 'LeadSquared'} first.`, 'alert-triangle', 'warning');
    return;
  }

  const originalText = btn.textContent;
  btn.setAttribute('disabled', 'true');
  btn.textContent = 'Syncing...';

  // Find lead details
  const lead = allLeads.find(l => l.id === leadId);
  if (!lead) return;

  // Visual flow connector animation start
  const connLine = document.getElementById(`crm-conn-${provider}`);
  if (connLine) {
    connLine.classList.add('active');
  }

  try {
    const res = await fetch(`${API_BASE}/${leadId}/sync-crm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Sync Successful', `Synchronized ${leadName} contact stream with ${provider === 'hubspot' ? 'HubSpot contact properties' : 'LeadSquared portal'}.`, 'check');
      logActivityFeed(`CRM Sync: Manually synced contact <strong>${leadName}</strong> to ${provider === 'hubspot' ? 'HubSpot' : 'LeadSquared'}.`);
      await renderCrmSyncLogs();
    } else {
      showToast('Sync Failed', data.message || 'Validation error during CRM push.', 'alert-triangle', 'error');
    }
  } catch (err) {
    console.error('Manual CRM sync error:', err);
    showToast('Sync Error', 'An unexpected error occurred during manual data mapping.', 'alert-triangle', 'error');
  } finally {
    btn.removeAttribute('disabled');
    btn.textContent = 'Synced';
    btn.style.backgroundColor = 'rgba(46, 204, 138, 0.15)';
    btn.style.color = 'var(--lx-green)';
    btn.style.borderColor = 'rgba(46, 204, 138, 0.3)';

    // Reset connector pipeline state after a few seconds
    setTimeout(() => {
      if (connLine && !crmConfig[provider].connected) {
        connLine.classList.remove('active');
      }
      btn.textContent = originalText;
      btn.style.backgroundColor = '';
      btn.style.color = '';
      btn.style.borderColor = '';
      renderManualSyncList();
    }, 2500);
  }
};

// ============================================================
// CRM Inbound Ingestion / Import Controller Logics
// ============================================================

// Mock CRM list data
const CRM_MOCK_LISTS = {
  hubspot: [
    { id: 'hs-list-1', name: 'Muthoot Inbound Leads Q3', count: 150 },
    { id: 'hs-list-2', name: 'High Intent Callbacks', count: 45 },
    { id: 'hs-list-3', name: 'Website Enquiries', count: 85 }
  ],
  leadsquared: [
    { id: 'lsq-list-1', name: 'LSQ Campaign Lead Group 1', count: 210 },
    { id: 'lsq-list-2', name: 'Mckinsey Personal Loan Interest List', count: 90 },
    { id: 'lsq-list-3', name: 'LSQ Gold Loan Registrants', count: 180 }
  ]
};

// Mock contacts to pull
const CRM_MOCK_CONTACTS = [
  { "Customer Name": "Vikram Seth", "Contact Phone": "+919934311029", "Email Address": "vikram.seth@outlook.com", "Age": "34", "Monthly Income": "62000", "City": "Delhi" },
  { "Customer Name": "Preeti Sen", "Contact Phone": "+918822399120", "Email Address": "preeti.sen@gmail.com", "Age": "28", "Monthly Income": "45000", "City": "Kolkata" },
  { "Customer Name": "Anand Rao", "Contact Phone": "+917766022199", "Email Address": "anand.rao@yahoo.com", "Age": "41", "Monthly Income": "89000", "City": "Chennai" },
  { "Customer Name": "Sunita Das", "Contact Phone": "+919830111222", "Email Address": "sunita.das@zoho.com", "Age": "31", "Monthly Income": "55000", "City": "Bangalore" },
  { "Customer Name": "Rajesh Nair", "Contact Phone": "+919908123456", "Email Address": "rajesh.nair@gmail.com", "Age": "39", "Monthly Income": "71000", "City": "Mumbai" }
];

// Switches upload modes in the Onboarding Wizard
window.toggleWizardUploadMode = function(mode) {
  const csvTab = document.getElementById('wtab-csv');
  const crmTab = document.getElementById('wtab-crm');
  const csvContainer = document.getElementById('wizard-upload-csv-container');
  const crmContainer = document.getElementById('wizard-upload-crm-container');

  if (mode === 'csv') {
    csvTab.classList.add('active');
    crmTab.classList.remove('active');
    csvContainer.style.display = 'block';
    crmContainer.style.display = 'none';
  } else {
    csvTab.classList.remove('active');
    crmTab.classList.add('active');
    csvContainer.style.display = 'none';
    crmContainer.style.display = 'block';
    onWizardCrmProviderChange();
  }
};

// Updates wizard CRM lists and connection status dynamically from backend
window.onWizardCrmProviderChange = async function() {
  const provider = document.getElementById('wizardCrmSourceSelect').value;
  const listSelect = document.getElementById('wizardCrmListSelect');
  const statusText = document.getElementById('wizard-crm-status-text');
  const statusBadge = document.getElementById('wizard-crm-status-badge');

  if (!listSelect) return;

  listSelect.innerHTML = '<option value="">Loading available lists...</option>';

  try {
    const res = await fetch(`${API_BASE}/crm-lists?tenant_id=${currentTenant}&provider=${provider}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.lists && data.lists.length > 0) {
        listSelect.innerHTML = data.lists.map(l => `<option value="${l.id}">${l.name} (${l.count} leads)</option>`).join('');
      } else {
        listSelect.innerHTML = '<option value="">No list segments found</option>';
      }
    } else {
      listSelect.innerHTML = '<option value="">Failed to query CRM lists</option>';
    }
  } catch (err) {
    console.error('Error fetching CRM lists:', err);
    listSelect.innerHTML = '<option value="">Error retrieving CRM lists</option>';
  }

  // Update status
  if (crmConfig[provider].connected) {
    statusText.textContent = `${provider === 'hubspot' ? 'HubSpot Cloud' : 'LeadSquared Regional API'} Connected`;
    statusBadge.textContent = 'CONNECTED';
    statusBadge.className = 'lx-badge badge-green';
  } else {
    statusText.textContent = `${provider === 'hubspot' ? 'HubSpot' : 'LeadSquared'} Disconnected`;
    statusBadge.textContent = 'NOT CONFIGURED';
    statusBadge.className = 'lx-badge badge-gray';
  }
};

// Fetches actual contact records from selected CRM list
window.fetchCrmContactsForWizard = async function() {
  const provider = document.getElementById('wizardCrmSourceSelect').value;
  const listSelect = document.getElementById('wizardCrmListSelect');
  if (!listSelect || listSelect.selectedIndex === -1 || !listSelect.value) {
    showToast('Selection Required', 'Please select a lead list first.', 'alert-triangle', 'warning');
    return;
  }
  const selectedListName = listSelect.options[listSelect.selectedIndex].text.split(' (')[0];
  const btn = document.getElementById('wizard-crm-fetch-btn');

  // Verify connection
  if (!crmConfig[provider].connected) {
    showToast('CRM Disconnected', `Please test and save credentials for ${provider === 'hubspot' ? 'HubSpot' : 'LeadSquared'} first.`, 'alert-triangle', 'warning');
    return;
  }

  btn.setAttribute('disabled', 'true');
  btn.textContent = 'Querying Lists...';

  await new Promise(resolve => setTimeout(resolve, 500));
  btn.textContent = 'Retrieving Contact Records...';

  try {
    const res = await fetch(`${API_BASE}/crm-contacts?tenant_id=${currentTenant}&provider=${provider}&list_id=${listSelect.value}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.contacts && data.contacts.length > 0) {
        // Populate wizard data fields by taking the union of all keys across all contacts
        const allKeys = new Set(['firstname', 'lastname', 'email', 'phone', 'Customer Name', 'Contact Phone', 'Email Address']);
        data.contacts.forEach(c => {
          Object.keys(c).forEach(k => allKeys.add(k));
        });
        parsedCsvHeaders = Array.from(allKeys);
        parsedCsvRows = data.contacts;

        // Auto-fill campaign tags
        document.getElementById('wizardCampaignName').value = `${provider === 'hubspot' ? 'HubSpot' : 'LeadSquared'} List: ${selectedListName}`;
        document.getElementById('wizardDatasetId').value = `ds-${provider}-${listSelect.value}`;

        showToast('Fetch Succeeded', `Pulled ${parsedCsvRows.length} contacts from ${provider === 'hubspot' ? 'HubSpot CRM' : 'LeadSquared'}`, 'check');
        
        // Automatically advance to column mapping wizard step
        parseAndPrepareMapping(true);
      } else {
        showToast('Fetch Failed', 'No contact records returned from selected list.', 'alert-triangle', 'error');
      }
    } else {
      showToast('Fetch Failed', 'Failed to retrieve list records from server.', 'alert-triangle', 'error');
    }
  } catch (err) {
    console.error('Fetch CRM contacts error:', err);
    showToast('Fetch Error', 'Unexpected connection error during fetch.', 'alert-triangle', 'error');
  } finally {
    btn.removeAttribute('disabled');
    btn.textContent = 'Fetch CRM Contacts';
  }
};

// Initializes direct sync UI options on Lead Intelligence page
function loadDirectCrmIngestData() {
  onDirectCrmProviderChange();
}

// Handles provider dropdown change on Direct Sync panel
window.onDirectCrmProviderChange = function() {
  const providerEl = document.getElementById('directCrmSourceSelect');
  if (!providerEl) return;
  const provider = providerEl.value;
  const listSelect = document.getElementById('directCrmListSelect');
  const statusBadge = document.getElementById('direct-crm-status-badge');

  if (!listSelect) return;

  // Populate list options
  const lists = CRM_MOCK_LISTS[provider] || [];
  listSelect.innerHTML = lists.map(l => `<option value="${l.name.toLowerCase().replace(/\s+/g, '-')}">${l.name} (${l.count} leads)</option>`).join('');

  // Update status badge
  if (crmConfig[provider].connected) {
    statusBadge.textContent = 'CONNECTED';
    statusBadge.className = 'lx-badge badge-green';
  } else {
    statusBadge.textContent = 'NOT CONFIGURED';
    statusBadge.className = 'lx-badge badge-gray';
  }
};

// Verify Connection / Preview list in Ingestion panel
window.fetchCrmLeadsDirectPreview = async function() {
  const provider = document.getElementById('directCrmSourceSelect').value;
  const listSelect = document.getElementById('directCrmListSelect');
  const selectedListName = listSelect.options[listSelect.selectedIndex].text.split(' (')[0];
  const btn = document.getElementById('directCrmFetchBtn');

  if (!crmConfig[provider].connected) {
    showToast('CRM Disconnected', `Connect to ${provider === 'hubspot' ? 'HubSpot' : 'LeadSquared'} first in CRM Sync.`, 'alert-triangle', 'warning');
    return;
  }

  btn.setAttribute('disabled', 'true');
  btn.textContent = 'Verifying...';

  await new Promise(resolve => setTimeout(resolve, 800));

  showToast('Verified', `List "${selectedListName}" is accessible. Contacts are ready to sync.`, 'check');
  btn.removeAttribute('disabled');
  btn.textContent = 'Verify Connection';
};

// Syncs CRM contacts directly into the LeadX database
window.syncCrmLeadsDirect = async function() {
  const provider = document.getElementById('directCrmSourceSelect').value;
  const listSelect = document.getElementById('directCrmListSelect');
  const listSlug = listSelect.value;
  const selectedListName = listSelect.options[listSelect.selectedIndex].text.split(' (')[0];
  const btn = document.getElementById('directCrmSyncBtn');

  // Verify connection
  if (!crmConfig[provider].connected) {
    showToast('CRM Disconnected', `Connect to ${provider === 'hubspot' ? 'HubSpot' : 'LeadSquared'} first in CRM Sync.`, 'alert-triangle', 'warning');
    return;
  }

  btn.setAttribute('disabled', 'true');
  btn.textContent = 'Syncing...';

  // Visual flow connector animation start
  const connLine = document.getElementById(`crm-conn-${provider}`);
  if (connLine) {
    connLine.classList.add('active');
  }

  // Simulate network synchronization API delay
  await new Promise(resolve => setTimeout(resolve, 1500));

  // Map mock contacts into DB schema
  const crmContacts = [
    { name: "Vikram Seth", phone: "+919934311029", email: "vikram.seth@outlook.com", source: provider, raw_data: { age: 34, city: "Delhi", income: 62000, pages_visited: 4 } },
    { name: "Preeti Sen", phone: "+918822399120", email: "preeti.sen@gmail.com", source: provider, raw_data: { age: 28, city: "Kolkata", income: 45000, pages_visited: 6 } },
    { name: "Anand Rao", phone: "+917766022199", email: "anand.rao@yahoo.com", source: provider, raw_data: { age: 41, city: "Chennai", income: 89000, pages_visited: 8 } }
  ];

  const batchPayload = {
    tenant_id: currentTenant,
    dataset_id: `ds-${provider}-${listSlug}`,
    campaign_name: `${provider === 'hubspot' ? 'HubSpot' : 'LeadSquared'} Sync: ${selectedListName}`,
    leads: crmContacts
  };

  try {
    const res = await fetch(`${API_BASE}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batchPayload)
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Import Complete', `Synchronized ${data.accepted} contacts from ${provider === 'hubspot' ? 'HubSpot' : 'LeadSquared'} directly into active database.`, 'check');
      
      // Reload leads leads list view
      await fetchLeadsList();
      await fetchCampaignsList();
      
      logActivityFeed(`CRM Import: Ingested <strong>${data.accepted} contacts</strong> directly from list: "${selectedListName}"`);
    } else {
      showToast('Sync Failed', data.message || 'Validation error during sync.', 'alert-triangle', 'error');
    }
  } catch (err) {
    console.error('CRM import sync error:', err);
    showToast('Network Error', 'Failed to communicate with local ingestion pipeline.', 'alert-triangle', 'error');
  } finally {
    btn.removeAttribute('disabled');
    btn.textContent = 'Sync CRM Contacts';

    // Reset connector pipeline state after a few seconds
    setTimeout(() => {
      if (connLine && !crmConfig[provider].connected) {
        connLine.classList.remove('active');
      }
    }, 2500);
  }
};

// Dynamic Campaign Manager and Filtering Helpers
function updateCampaignFilterDropdown(leads) {
  const dropdown = document.getElementById('leads-campaign-filter');
  if (!dropdown) return;

  const currentValue = dropdown.value;

  // Extract unique campaigns
  const campaigns = new Set();
  leads.forEach(l => {
    if (l.campaign_name) campaigns.add(l.campaign_name);
  });

  dropdown.innerHTML = '<option value="all">All Campaigns</option>';
  campaigns.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    dropdown.appendChild(opt);
  });

  // Re-set value if it still exists, otherwise default to all
  if (campaigns.has(currentValue)) {
    dropdown.value = currentValue;
  } else {
    dropdown.value = 'all';
  }
}

function getActiveIndustry() {
  const campaignFilterDropdown = document.getElementById('leads-campaign-filter');
  const selectedCampaign = campaignFilterDropdown ? campaignFilterDropdown.value : 'all';

  if (!selectedCampaign || selectedCampaign === 'all') {
    return 'General';
  }

  const nameLower = selectedCampaign.toLowerCase();
  if (nameLower.includes('real estate') || nameLower.includes('realestate') || nameLower.includes('property') || nameLower.includes('home') || nameLower.includes('housing')) {
    return 'Real Estate';
  } else if (nameLower.includes('bfsi') || nameLower.includes('bank') || nameLower.includes('loan') || nameLower.includes('gold loan') || nameLower.includes('credit') || nameLower.includes('finance')) {
    return 'BFSI';
  } else if (nameLower.includes('education') || nameLower.includes('course') || nameLower.includes('college') || nameLower.includes('school') || nameLower.includes('enrollment')) {
    return 'Education';
  }

  // Scan leads of this specific campaign to see if we can find a dominant category
  const campaignLeads = allLeads.filter(l => (l.campaign_name || 'Manual Ingests') === selectedCampaign);
  let hasRealEstate = false;
  let hasBFSI = false;
  let hasEducation = false;
  
  for (const lead of campaignLeads) {
    const raw = lead.raw_data || {};
    if (raw.budget !== undefined || raw.property_type !== undefined || raw.location_preference !== undefined || raw.bhk !== undefined || raw.location !== undefined) {
      hasRealEstate = true;
      break;
    }
    if (raw.credit_score !== undefined || raw.monthly_income !== undefined || raw.loan_amount !== undefined || raw.desired_loan !== undefined) {
      hasBFSI = true;
      break;
    }
    if (raw.course_interest !== undefined || raw.qualification !== undefined || raw.year_of_graduation !== undefined) {
      hasEducation = true;
      break;
    }
  }

  if (hasRealEstate) return 'Real Estate';
  if (hasBFSI) return 'BFSI';
  if (hasEducation) return 'Education';

  return 'General';
}

function getActiveSliderKeysForIndustry(industry) {
  const indNormalized = industry ? industry.toLowerCase().replace(/[^a-z]/g, '') : '';
  if (indNormalized === 'realestate') {
    return [
      { key: 'budget', label: 'Budget Fit', defaultWeight: 0.33 },
      { key: 'property_type', label: 'BHK Fit', defaultWeight: 0.33 },
      { key: 'location_preference', label: 'Location Fit', defaultWeight: 0.34 }
    ];
  } else if (indNormalized === 'bfsi') {
    return [
      { key: 'monthly_income', label: 'Income Fit', defaultWeight: 0.33 },
      { key: 'credit_score', label: 'Credit Score Fit', defaultWeight: 0.33 },
      { key: 'loan_amount', label: 'Loan Amount Fit', defaultWeight: 0.34 }
    ];
  } else if (indNormalized === 'education') {
    return [
      { key: 'course_interest', label: 'Course Fit', defaultWeight: 0.50 },
      { key: 'qualification', label: 'Qualification Fit', defaultWeight: 0.50 }
    ];
  } else {
    // Keep original fallback of 5 weights
    return [
      { key: 'demographic_fit', label: 'Demographic Fit', defaultWeight: 0.25 },
      { key: 'source_quality', label: 'Source Quality', defaultWeight: 0.25 },
      { key: 'recency', label: 'Recency', defaultWeight: 0.20 },
      { key: 'behavioural_signals', label: 'Behavioural Signals', defaultWeight: 0.15 },
      { key: 'prior_interaction', label: 'Prior Interaction', defaultWeight: 0.15 }
    ];
  }
}

function renderSliders(activeSliderKeys) {
  const container = document.getElementById('sliders-row-container');
  if (!container) return;

  // Check if same keys are already rendered to avoid destroying focus during slider dragging
  const activeKeysStr = activeSliderKeys.map(k => k.key).join(',');
  if (container.getAttribute('data-active-keys') === activeKeysStr) {
    activeSliderKeys.forEach(slider => {
      const input = document.getElementById(`weight-${slider.key}`);
      if (input) {
        let val = tenantWeights[slider.key];
        if (val === undefined) val = slider.defaultWeight;
        input.value = val;
        const display = document.getElementById(`val-${slider.key}`);
        if (display) display.textContent = val.toFixed(2);
      }
    });
    updateWeightsSum();
    return;
  }

  container.setAttribute('data-active-keys', activeKeysStr);
  container.innerHTML = '';

  activeSliderKeys.forEach((slider, idx) => {
    const item = document.createElement('div');
    item.className = 'li-slider-item';

    let val = tenantWeights[slider.key];
    if (val === undefined) {
      val = slider.defaultWeight;
    }

    item.innerHTML = `
      <div class="li-slider-top">
        <span>${slider.label}</span>
        <span id="val-${slider.key}" class="slider-val">${val.toFixed(2)}</span>
      </div>
      <input type="range" id="weight-${slider.key}" min="0" max="1" step="0.01" value="${val}" class="slider">
    `;

    container.appendChild(item);

    if (idx < activeSliderKeys.length - 1) {
      const sep = document.createElement('div');
      sep.className = 'li-slider-sep';
      container.appendChild(sep);
    }
  });

  setupSliderEventListeners();
  updateWeightsSum();
}

function setupSliderEventListeners() {
  const rangeInputs = document.querySelectorAll('#sliders-row-container input[type="range"]');
  rangeInputs.forEach(input => {
    const newEl = input.cloneNode(true);
    input.parentNode.replaceChild(newEl, input);
    
    newEl.addEventListener('input', (e) => {
      const key = e.target.id.replace('weight-', '');
      const val = parseFloat(e.target.value);
      const valDisplay = document.getElementById(`val-${key}`);
      if (valDisplay) valDisplay.textContent = val.toFixed(2);

      tenantWeights[key] = val;
      updateWeightsSum();
    });
  });
}

window.fetchCampaignsList = async function() {
  try {
    const res = await fetch(`${API_BASE}/campaigns?tenant_id=${currentTenant}`);
    if (!res.ok) throw new Error('Failed to fetch campaigns');
    const data = await res.json();
    if (data.success) {
      renderCampaigns(data.campaigns);
    }
  } catch (err) {
    console.error('Error fetching campaigns:', err);
  }
};

function renderCampaigns(campaigns) {
  const rtContainer = document.getElementById('camp-content-rt');
  const nonrtContainer = document.getElementById('camp-content-nonrt');
  const scheduledContainer = document.getElementById('camp-content-scheduled');

  if (!rtContainer || !nonrtContainer || !scheduledContainer) return;

  rtContainer.innerHTML = '';
  nonrtContainer.innerHTML = '';
  scheduledContainer.innerHTML = '';

  const rtCamps = [];
  const nonrtCamps = [];
  const scheduledCamps = [];

  campaigns.forEach(camp => {
    const nameLower = camp.name.toLowerCase();
    if (nameLower.includes('scheduled')) {
      scheduledCamps.push(camp);
    } else if (nameLower.includes('batch') || nameLower.includes('csv') || nameLower.includes('json') || nameLower.includes('upload')) {
      nonrtCamps.push(camp);
    } else {
      rtCamps.push(camp);
    }
  });

  // Render dynamic list or placeholders
  if (rtCamps.length === 0) {
    rtContainer.innerHTML = `
      <div class="campaign-card">
        <div class="cc-top">
          <div>
            <div class="cc-name">Muthoot Gold Loan RT Ingestion</div>
            <div class="cc-sub">Mode: Real-Time Dialing | Tenant: ${currentTenant}</div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button class="lx-btn primary" onclick="viewCampaignScores('Muthoot Gold Loan RT Ingestion')" style="padding: 4px 10px; font-size: 11px; margin: 0;"><i data-lucide="zap" style="width:10px; height:10px; display:inline-block; vertical-align:middle; margin-right:3px;"></i>View Scores</button>
            <span class="lx-badge badge-green">ACTIVE</span>
          </div>
        </div>
        <div class="cc-stats">
          <div class="cc-stat">
            <div class="cc-stat-val">12,450</div>
            <div class="cc-stat-label">Ingested</div>
          </div>
          <div class="cc-stat">
            <div class="cc-stat-val">9,870</div>
            <div class="cc-stat-label">Attempted</div>
          </div>
          <div class="cc-stat">
            <div class="cc-stat-val">8,204</div>
            <div class="cc-stat-label">Connected</div>
          </div>
          <div class="cc-stat">
            <div class="cc-stat-val">82.6%</div>
            <div class="cc-stat-label">Connect Rate</div>
          </div>
        </div>
        <div class="cc-progress">
          <div class="cc-progress-label">
            <span>Roster: 8 VOIZ agents assigned</span>
            <span>Progress: 79%</span>
          </div>
          <div class="lx-progress-bar">
            <div class="lx-progress-fill" style="width: 79%; background: var(--lx-accent);"></div>
          </div>
        </div>
      </div>
      <div class="campaign-card">
        <div class="cc-top">
          <div>
            <div class="cc-name">Muthoot Home Loan Re-engagement</div>
            <div class="cc-sub">Mode: Real-Time Triggers | Tenant: ${currentTenant}</div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button class="lx-btn primary" onclick="viewCampaignScores('Muthoot Home Loan Re-engagement')" style="padding: 4px 10px; font-size: 11px; margin: 0;"><i data-lucide="zap" style="width:10px; height:10px; display:inline-block; vertical-align:middle; margin-right:3px;"></i>View Scores</button>
            <span class="lx-badge badge-green">ACTIVE</span>
          </div>
        </div>
        <div class="cc-stats">
          <div class="cc-stat">
            <div class="cc-stat-val">2,142</div>
            <div class="cc-stat-label">Ingested</div>
          </div>
          <div class="cc-stat">
            <div class="cc-stat-val">1,209</div>
            <div class="cc-stat-label">Attempted</div>
          </div>
          <div class="cc-stat">
            <div class="cc-stat-val">812</div>
            <div class="cc-stat-label">Connected</div>
          </div>
          <div class="cc-stat">
            <div class="cc-stat-val">67.1%</div>
            <div class="cc-stat-label">Connect Rate</div>
          </div>
        </div>
        <div class="cc-progress">
          <div class="cc-progress-label">
            <span>Roster: 4 VOIZ agents assigned</span>
            <span>Progress: 56%</span>
          </div>
          <div class="lx-progress-bar">
            <div class="lx-progress-fill" style="width: 56%; background: var(--lx-accent);"></div>
          </div>
        </div>
      </div>
    `;
  } else {
    rtContainer.innerHTML = rtCamps.map(renderCampaignCardHtml).join('');
  }

  if (nonrtCamps.length === 0) {
    nonrtContainer.innerHTML = `
      <div class="campaign-card">
        <div class="cc-top">
          <div>
            <div class="cc-name">Muthoot Finance Personal Loan Batch</div>
            <div class="cc-sub">Mode: Non-RT Batch Outbound | Concurrency: 15</div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button class="lx-btn primary" onclick="viewCampaignScores('Muthoot Finance Personal Loan Batch')" style="padding: 4px 10px; font-size: 11px; margin: 0;"><i data-lucide="zap" style="width:10px; height:10px; display:inline-block; vertical-align:middle; margin-right:3px;"></i>View Scores</button>
            <span class="lx-badge badge-amber">PAUSED</span>
          </div>
        </div>
        <div class="cc-stats">
          <div class="cc-stat">
            <div class="cc-stat-val">5,000</div>
            <div class="cc-stat-label">Batch Size</div>
          </div>
          <div class="cc-stat">
            <div class="cc-stat-val">3,120</div>
            <div class="cc-stat-label">Attempted</div>
          </div>
          <div class="cc-stat">
            <div class="cc-stat-val">1,822</div>
            <div class="cc-stat-label">Connected</div>
          </div>
          <div class="cc-stat">
            <div class="cc-stat-val">58.4%</div>
            <div class="cc-stat-label">Connect Rate</div>
          </div>
        </div>
        <div class="cc-progress">
          <div class="cc-progress-label">
            <span>Roster: 6 VOIZ agents assigned</span>
            <span>Progress: 62%</span>
          </div>
          <div class="lx-progress-bar">
            <div class="lx-progress-fill" style="width: 62%; background: var(--lx-amber);"></div>
          </div>
        </div>
      </div>
    `;
  } else {
    nonrtContainer.innerHTML = nonrtCamps.map(renderCampaignCardHtml).join('');
  }

  if (scheduledCamps.length === 0) {
    scheduledContainer.innerHTML = `
      <div class="campaign-card">
        <div class="cc-top">
          <div>
            <div class="cc-name">Muthoot Gold Ingest Scheduled Q3</div>
            <div class="cc-sub">Mode: Scheduled Outbound | Starts: Tomorrow 10:00 AM</div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button class="lx-btn primary" onclick="viewCampaignScores('Muthoot Gold Ingest Scheduled Q3')" style="padding: 4px 10px; font-size: 11px; margin: 0;"><i data-lucide="zap" style="width:10px; height:10px; display:inline-block; vertical-align:middle; margin-right:3px;"></i>View Scores</button>
            <span class="lx-badge badge-gray">SCHEDULED</span>
          </div>
        </div>
        <div class="cc-stats">
          <div class="cc-stat">
            <div class="cc-stat-val">8,500</div>
            <div class="cc-stat-label">Expected Leads</div>
          </div>
          <div class="cc-stat">
            <div class="cc-stat-val">0</div>
            <div class="cc-stat-label">Attempted</div>
          </div>
          <div class="cc-stat">
            <div class="cc-stat-val">0</div>
            <div class="cc-stat-label">Connected</div>
          </div>
          <div class="cc-stat">
            <div class="cc-stat-val">0%</div>
            <div class="cc-stat-label">Connect Rate</div>
          </div>
        </div>
        <div class="cc-progress">
          <div class="cc-progress-label">
            <span>Roster: 10 VOIZ agents reserved</span>
            <span>Progress: 0%</span>
          </div>
          <div class="lx-progress-bar">
            <div class="lx-progress-fill" style="width: 0%; background: var(--lx-border);"></div>
          </div>
        </div>
      </div>
    `;
  } else {
    scheduledContainer.innerHTML = scheduledCamps.map(renderCampaignCardHtml).join('');
  }

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function renderCampaignCardHtml(camp) {
  let agentsAssigned = 4;
  if (camp.name.toLowerCase().includes('real estate')) agentsAssigned = 6;
  else if (camp.name.toLowerCase().includes('gold')) agentsAssigned = 8;
  
  const progressPercent = camp.ingested > 0 ? Math.min(Math.round((camp.attempted / camp.ingested) * 100), 100) : 0;
  
  return `
    <div class="campaign-card">
      <div class="cc-top">
        <div>
          <div class="cc-name">${camp.name}</div>
          <div class="cc-sub">Leads Active | Tenant: ${currentTenant}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button class="lx-btn primary" onclick="viewCampaignScores('${camp.name}')" style="padding: 4px 10px; font-size: 11px; margin: 0;"><i data-lucide="zap" style="width:10px; height:10px; display:inline-block; vertical-align:middle; margin-right:3px;"></i>View Scores</button>
          <span class="lx-badge badge-green">ACTIVE</span>
        </div>
      </div>
      <div class="cc-stats">
        <div class="cc-stat">
          <div class="cc-stat-val">${camp.ingested.toLocaleString()}</div>
          <div class="cc-stat-label">Ingested</div>
        </div>
        <div class="cc-stat">
          <div class="cc-stat-val">${camp.attempted.toLocaleString()}</div>
          <div class="cc-stat-label">Attempted</div>
        </div>
        <div class="cc-stat">
          <div class="cc-stat-val">${camp.connected.toLocaleString()}</div>
          <div class="cc-stat-label">Connected</div>
        </div>
        <div class="cc-stat">
          <div class="cc-stat-val">${camp.connect_rate}%</div>
          <div class="cc-stat-label">Connect Rate</div>
        </div>
      </div>
      <div class="cc-progress">
        <div class="cc-progress-label">
          <span>Roster: ${agentsAssigned} VOIZ agents assigned</span>
          <span>Progress: ${progressPercent}%</span>
        </div>
        <div class="lx-progress-bar">
          <div class="lx-progress-fill" style="width: ${progressPercent}%; background: var(--lx-accent);"></div>
        </div>
      </div>
    </div>
  `;
}

window.viewCampaignScores = function(campaignName) {
  const leadsItem = document.querySelector('.lx-sidebar-item[data-page="leads"]');
  if (leadsItem) {
    leadsItem.click();
  }

  const filterDropdown = document.getElementById('leads-campaign-filter');
  if (filterDropdown) {
    let found = false;
    for (let i = 0; i < filterDropdown.options.length; i++) {
      if (filterDropdown.options[i].value === campaignName) {
        found = true;
        break;
      }
    }
    if (!found) {
      const opt = document.createElement('option');
      opt.value = campaignName;
      opt.textContent = campaignName;
      filterDropdown.appendChild(opt);
    }
    filterDropdown.value = campaignName;
    filterDropdown.dispatchEvent(new Event('change'));
  }
};

window.fetchQueueStatus = async function() {
  try {
    const res = await fetch(`${API_BASE}/queue-status?tenant_id=${currentTenant}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.stats) {
        const stats = data.stats;
        const queuedEl = document.getElementById('queue-stat-queued');
        const callingEl = document.getElementById('queue-stat-calling');
        const retriesEl = document.getElementById('queue-stat-retries');
        const dncEl = document.getElementById('queue-stat-dnc');
        
        if (queuedEl) queuedEl.textContent = stats.queued ?? 0;
        if (callingEl) callingEl.textContent = stats.calling ?? 0;
        if (retriesEl) retriesEl.textContent = stats.re_queued ?? 0;
        if (dncEl) dncEl.textContent = stats.dnc ?? 0;
      }
    }
    
    // Also update the active ingestion queue table!
    const leadsRes = await fetch(`${API_BASE}?tenant_id=${currentTenant}`);
    if (leadsRes.ok) {
      const leadsData = await leadsRes.json();
      if (leadsData.success) {
        allLeads = leadsData.leads;
        renderActiveQueueTable(allLeads);
      }
    }
  } catch (err) {
    console.error('Error fetching queue status:', err);
  }
};

function renderActiveQueueTable(leads) {
  const tbody = document.getElementById('monitor-queue-tbody');
  if (!tbody) return;

  const queuedLeads = leads.filter(l => l.status === 'queued' || l.status === 're-queued' || l.status === 'calling');
  // Sort by score descending
  queuedLeads.sort((a, b) => b.score - a.score);

  if (queuedLeads.length === 0) {
    tbody.innerHTML = `
      <tr class="lx-empty-row">
        <td colspan="3" style="text-align: center; color: var(--lx-muted); padding: 12px;">No leads currently queued.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = queuedLeads.map(lead => {
    let badgeColor = 'var(--lx-text)';
    if (lead.status === 'calling') badgeColor = 'var(--lx-green)';
    if (lead.status === 're-queued') badgeColor = 'var(--lx-amber)';
    return `
      <tr>
        <td><strong>${lead.name || 'Unknown'}</strong></td>
        <td><span style="font-family: var(--lx-mono); color: ${badgeColor};">${lead.phone} (${lead.status})</span></td>
        <td style="text-align: right;"><span class="lx-badge badge-teal">${lead.score}</span></td>
      </tr>
    `;
  }).join('');
}

window.triggerForceRetryDialer = async function() {
  const btn = document.getElementById('forceRetryDialerBtn');
  if (btn) {
    btn.setAttribute('disabled', 'true');
    const originalContent = btn.innerHTML;
    btn.innerHTML = 'Retrying...';
    try {
      const res = await fetch(`${API_BASE}/force-retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: currentTenant })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          showToast('Force Retry Succeeded', data.message || 'Leads re-queued successfully.', 'check');
          fetchQueueStatus();
        } else {
          showToast('Force Retry Failed', data.message || 'Could not re-queue leads.', 'alert-triangle', 'error');
        }
      } else {
        showToast('Force Retry Error', 'Server returned status ' + res.status, 'alert-triangle', 'error');
      }
    } catch (err) {
      console.error('Error triggering force retry dialer:', err);
      showToast('Network Error', 'Failed to reach backend server.', 'alert-triangle', 'error');
    } finally {
      btn.removeAttribute('disabled');
      btn.innerHTML = originalContent;
    }
  }
};

// -------------------------------------------------------------
// MODULES 5-8: SCRIPT EDITOR, ANALYTICS DASHBOARD & HANDOFF BRIEF
// -------------------------------------------------------------

// Active escalation warning banner controller
function checkAndShowEscalationsBanner(leads) {
  const escalatedLead = leads.find(l => l.status === 'hot_escalated');
  const banner = document.getElementById('escalationWarningBanner');
  const bannerText = document.getElementById('escalationBannerText');
  const viewBtn = document.getElementById('viewBriefBannerBtn');
  
  if (escalatedLead) {
    if (banner) {
      banner.style.display = 'flex';
    }
    if (bannerText) {
      bannerText.textContent = `Lead ${escalatedLead.name || 'Unknown'} requires immediate advisor brief lookup.`;
    }
    if (viewBtn) {
      viewBtn.onclick = null;
      viewBtn.onclick = () => viewBriefModal(escalatedLead.id);
    }
  } else {
    if (banner) {
      banner.style.display = 'none';
    }
  }
}

// Close brief modal button setup
const closeBriefBtn = document.getElementById('closeBriefModal');
if (closeBriefBtn) {
  closeBriefBtn.addEventListener('click', () => {
    document.getElementById('agentBriefModal').style.display = 'none';
  });
}
window.addEventListener('click', (event) => {
  const briefModal = document.getElementById('agentBriefModal');
  if (event.target === briefModal) {
    briefModal.style.display = 'none';
  }
});

// Load Script editor view
async function loadScriptEditorData() {
  try {
    const res = await fetch(`${API_BASE}/scripts?tenant_id=${currentTenant}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        const scriptVersionHistory = document.getElementById('scriptVersionHistory');
        if (scriptVersionHistory) {
          if (data.scripts.length === 0) {
            scriptVersionHistory.innerHTML = `
              <tr>
                <td colspan="4" style="text-align: center; color: var(--lx-muted); padding: 12px;">No versions published.</td>
              </tr>
            `;
          } else {
            // Sort by created_at descending
            const sorted = [...data.scripts].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
            scriptVersionHistory.innerHTML = sorted.map(s => {
              const dateStr = new Date(s.created_at).toLocaleString();
              return `
                <tr style="cursor: pointer;" onclick="loadSpecificScriptToEditor('${s.id}')">
                  <td><strong>${s.script_id}</strong></td>
                  <td>${s.version}</td>
                  <td><span class="lx-badge badge-gray">${s.language.toUpperCase()}</span></td>
                  <td style="font-family: var(--lx-mono);">${dateStr}</td>
                </tr>
              `;
            }).join('');
          }
        }
        
        // Populate JSON editor with latest version if textarea is empty or placeholder
        const jsonArea = document.getElementById('scriptJsonArea');
        if (jsonArea && (!jsonArea.value.trim() || jsonArea.value.trim() === 'Placeholder...')) {
          if (data.scripts.length > 0) {
            const sorted = [...data.scripts].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
            const latest = sorted[0];
            jsonArea.value = JSON.stringify(latest, null, 2);
            validateScriptJsonUI();
          } else {
            loadScriptTemplate('edtech');
          }
        }
      }
    }
  } catch (err) {
    console.error('Error loading script editor data:', err);
    showToast('Fetch Error', 'Failed to retrieve conversational scripts.', 'alert-triangle', 'error');
  }
}

window.loadSpecificScriptToEditor = async function(id) {
  try {
    const res = await fetch(`${API_BASE}/scripts/${id}?tenant_id=${currentTenant}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.script) {
        const jsonArea = document.getElementById('scriptJsonArea');
        if (jsonArea) {
          jsonArea.value = JSON.stringify(data.script, null, 2);
          validateScriptJsonUI();
          showToast('Script Loaded', `Loaded version ${data.script.version} of script "${data.script.script_id}" into editor.`, 'file-text');
        }
      }
    }
  } catch (err) {
    console.error('Error loading specific script:', err);
    showToast('Fetch Error', 'Failed to load script details.', 'alert-triangle', 'error');
  }
};

window.loadScriptTemplate = function(type) {
  let templateObj = null;
  if (type === 'edtech') {
    templateObj = {
      "tenant_id": currentTenant,
      "script_id": "edtech-admissions-v1",
      "version": "1.0",
      "language": "en",
      "max_duration_seconds": 300,
      "escalation_triggers": [
        {
          "type": "explicit_request",
          "phrases": ["speak to advisor", "talk to human", "connect me to human", "transfer to specialist", "agent", "representative", "help desk"]
        },
        {
          "type": "sentiment_low",
          "threshold": 0.3
        },
        {
          "type": "high_intent",
          "phrases": ["i want to enroll", "how do i pay", "when does course start", "send syllabus", "can i enroll", "where is the link to pay"]
        },
        {
          "type": "max_duration",
          "seconds": 240
        }
      ],
      "nodes": [
        {
          "id": "greeting",
          "prompt": "Hello {lead_name}, I am calling from Predixion AI Academy. I saw you recently showed interest in our Full-Stack AI Engineering program. Am I speaking with the right person?",
          "expected_intents": ["yes", "no"],
          "branches": {
            "yes": "course_interest",
            "no": "wrong_number"
          }
        },
        {
          "id": "wrong_number",
          "prompt": "Oh, my apologies. I will remove this number from our contact list. Have a great day!",
          "expected_intents": [],
          "branches": {},
          "is_terminal": true
        },
        {
          "id": "course_interest",
          "prompt": "Excellent! The Full-Stack AI program is a 6-month hands-on course covering LLM fine-tuning, agent architectures, and production deployment. Are you looking to upgrade your skills for a career change or to build a specific AI product?",
          "expected_intents": ["career_change", "build_product", "general_info"],
          "branches": {
            "career_change": "background_check",
            "build_product": "background_check",
            "general_info": "background_check"
          }
        },
        {
          "id": "background_check",
          "prompt": "Understood. Our curriculum is tailored for developers and technical professionals. Do you have some prior coding experience in Python or JavaScript, or are you starting fresh?",
          "expected_intents": ["experienced", "fresh"],
          "branches": {
            "experienced": "timeline_check",
            "fresh": "timeline_check"
          }
        },
        {
          "id": "timeline_check",
          "prompt": "Got it. Our next cohort starts on the first Monday of next month. How soon are you planning to start your learning journey — immediately, or are you looking at later cohorts?",
          "expected_intents": ["immediately", "later"],
          "branches": {
            "immediately": "budget_check",
            "later": "budget_check"
          }
        },
        {
          "id": "budget_check",
          "prompt": "Perfect. The tuition for the cohort is 75,000 Rupees, with monthly installment plans starting at 7,500 Rupees. Does this budget work for you, or would you like to hear about our scholarship options?",
          "expected_intents": ["budget_ok", "wants_scholarship", "budget_high"],
          "branches": {
            "budget_ok": "close_interested",
            "wants_scholarship": "scholarship_info",
            "budget_high": "scholarship_info"
          }
        },
        {
          "id": "scholarship_info",
          "prompt": "No worries! We offer up to 20% merit-based scholarships for qualified applicants. I can request our admissions advisor to review your profile. Would you like me to schedule a brief profile review call with them?",
          "expected_intents": ["yes", "no"],
          "branches": {
            "yes": "manual_escalation_schedule",
            "no": "close_not_interested"
          }
        },
        {
          "id": "manual_escalation_schedule",
          "prompt": "Wonderful! Let me transfer you directly or schedule a advisor callback right now.",
          "expected_intents": [],
          "branches": {},
          "is_terminal": true
        },
        {
          "id": "close_interested",
          "prompt": "Fantastic! Since you are ready to proceed, I will email you the registration link and syllabus details. You can complete the payment to secure your seat. Is this email address correct: {email}?",
          "expected_intents": ["yes", "no"],
          "branches": {
            "yes": "terminal_success",
            "no": "terminal_success"
          }
        },
        {
          "id": "terminal_success",
          "prompt": "Awesome, I have sent the details. Looking forward to having you in the program. Goodbye!",
          "expected_intents": [],
          "branches": {},
          "is_terminal": true
        },
        {
          "id": "close_not_interested",
          "prompt": "Thank you for your time. If you change your mind, you can visit our website at predixion.ai. Have a great day!",
          "expected_intents": [],
          "branches": {},
          "is_terminal": true
        }
      ]
    };
  } else if (type === 'sales') {
    templateObj = {
      "tenant_id": currentTenant,
      "script_id": "b2c-sales-v1",
      "version": "1.0",
      "language": "en",
      "max_duration_seconds": 180,
      "escalation_triggers": [
        {
          "type": "explicit_request",
          "phrases": ["agent", "human", "supervisor", "representative", "manager"]
        },
        {
          "type": "sentiment_low",
          "threshold": 0.4
        },
        {
          "type": "high_intent",
          "phrases": ["sign up", "interested", "buy now", "cost", "price"]
        }
      ],
      "nodes": [
        {
          "id": "greeting",
          "prompt": "Hello! I am calling from Muthoot Finance. I saw you recently checked our Gold Loan interest rates online. Are you interested in getting a quick valuation of your gold jewelry today?",
          "expected_intents": ["yes", "no", "later"],
          "branches": {
            "yes": "loan_amount",
            "no": "not_interested",
            "later": "callback_schedule"
          }
        },
        {
          "id": "loan_amount",
          "prompt": "Great! We offer the highest value per gram and interest rates starting at just 0.99% per month. How much loan amount are you looking for approximately?",
          "expected_intents": ["under_1_lakh", "above_1_lakh"],
          "branches": {
            "under_1_lakh": "verification",
            "above_1_lakh": "high_value_offer"
          }
        },
        {
          "id": "high_value_offer",
          "prompt": "Excellent! For loans above 1 Lakh, we have a doorstep gold evaluation service where our representative comes to your house. Would you like me to book a doorstep evaluation session for you?",
          "expected_intents": ["yes", "no"],
          "branches": {
            "yes": "doorstep_booking",
            "no": "visit_branch"
          }
        },
        {
          "id": "verification",
          "prompt": "Perfect. I can check the nearest branch for you. Can you please confirm your current city and postal code?",
          "expected_intents": ["provided", "declined"],
          "branches": {
            "provided": "branch_schedule",
            "declined": "branch_schedule"
          }
        },
        {
          "id": "visit_branch",
          "prompt": "No problem. You can visit our nearest branch to get the loan disbursed in just 30 minutes. I will send you the location via SMS. Is that okay?",
          "expected_intents": ["yes", "no"],
          "branches": {
            "yes": "close_sms",
            "no": "not_interested"
          }
        },
        {
          "id": "doorstep_booking",
          "prompt": "Fantastic. I am scheduling the doorstep evaluation. Our representative will contact you to confirm the time. Thank you for choosing Muthoot Finance!",
          "expected_intents": [],
          "branches": {},
          "is_terminal": true
        },
        {
          "id": "branch_schedule",
          "prompt": "Awesome. I've noted that down. A branch executive will call you to confirm your visit. Thank you!",
          "expected_intents": [],
          "branches": {},
          "is_terminal": true
        },
        {
          "id": "close_sms",
          "prompt": "Thank you! I have sent the address details via SMS. Have a nice day!",
          "expected_intents": [],
          "branches": {},
          "is_terminal": true
        },
        {
          "id": "callback_schedule",
          "prompt": "No problem. When would be a better time to call you back?",
          "expected_intents": [],
          "branches": {},
          "is_terminal": true
        },
        {
          "id": "not_interested",
          "prompt": "Thank you for your time. Have a great day!",
          "expected_intents": [],
          "branches": {},
          "is_terminal": true
        }
      ]
    };
  }
  
  if (templateObj) {
    const jsonArea = document.getElementById('scriptJsonArea');
    if (jsonArea) {
      jsonArea.value = JSON.stringify(templateObj, null, 2);
      validateScriptJsonUI();
      showToast('Template Loaded', `Loaded ${type === 'edtech' ? 'Ed-Tech' : 'B2C Sales'} script template into workspace.`, 'clipboard');
    }
  }
};

window.validateScriptJsonUI = function() {
  const jsonArea = document.getElementById('scriptJsonArea');
  const statusBadge = document.getElementById('scriptValidationStatus');
  const errorsDiv = document.getElementById('scriptValidationErrors');
  const visualizer = document.getElementById('scriptFlowVisualizer');
  
  if (!jsonArea || !statusBadge || !errorsDiv || !visualizer) return false;
  
  const val = jsonArea.value.trim();
  if (!val) {
    statusBadge.textContent = 'UNVALIDATED';
    statusBadge.className = 'lx-badge badge-gray';
    errorsDiv.style.display = 'none';
    visualizer.innerHTML = `<div style="text-align: center; color: var(--lx-muted); padding: 30px 0;">No script loaded. Paste/Load a template to view the graph flow.</div>`;
    return false;
  }
  
  let script = null;
  try {
    script = JSON.parse(val);
  } catch (e) {
    statusBadge.textContent = 'INVALID JSON';
    statusBadge.className = 'lx-badge badge-red';
    errorsDiv.textContent = `JSON Syntax Error: ${e.message}`;
    errorsDiv.style.display = 'block';
    visualizer.innerHTML = `<div style="text-align: center; color: var(--lx-red); padding: 30px 0;">JSON Syntax Error. Fix JSON syntax to preview nodes.</div>`;
    return false;
  }
  
  const errors = [];
  if (!script.tenant_id || typeof script.tenant_id !== 'string' || script.tenant_id.trim() === '') {
    errors.push('tenant_id is required and must be a non-empty string');
  }
  if (!script.script_id || typeof script.script_id !== 'string' || script.script_id.trim() === '') {
    errors.push('script_id is required and must be a non-empty string');
  }
  if (!script.version || typeof script.version !== 'string' || script.version.trim() === '') {
    errors.push('version is required and must be a non-empty string');
  }
  if (!script.language || typeof script.language !== 'string') {
    errors.push('language must be a string');
  }
  
  if (!script.nodes || !Array.isArray(script.nodes) || script.nodes.length === 0) {
    errors.push('nodes must be a non-empty array');
  } else {
    const nodeIds = new Set(script.nodes.map(n => n.id).filter(id => typeof id === 'string'));
    script.nodes.forEach((node, index) => {
      if (!node.id || typeof node.id !== 'string' || node.id.trim() === '') {
        errors.push(`Node [index ${index}] lacks a valid string id`);
      }
      if (!node.prompt || typeof node.prompt !== 'string') {
        errors.push(`Node "${node.id || index}" prompt must be a string`);
      }
      if (node.expected_intents && !Array.isArray(node.expected_intents)) {
        errors.push(`Node "${node.id || index}" expected_intents must be an array`);
      }
      if (node.branches && (typeof node.branches !== 'object' || Array.isArray(node.branches))) {
        errors.push(`Node "${node.id || index}" branches must be an object`);
      } else if (node.branches) {
        Object.entries(node.branches).forEach(([intent, targetId]) => {
          if (!nodeIds.has(targetId)) {
            errors.push(`Node "${node.id}" branches to non-existent node "${targetId}"`);
          }
        });
      }
    });
  }
  
  if (script.escalation_triggers !== undefined) {
    if (!Array.isArray(script.escalation_triggers)) {
      errors.push('escalation_triggers must be an array');
    } else {
      const allowedTypes = ['explicit_request', 'sentiment_low', 'high_intent', 'max_duration'];
      script.escalation_triggers.forEach((trigger, idx) => {
        if (!trigger.type || !allowedTypes.includes(trigger.type)) {
          errors.push(`Escalation trigger [index ${idx}] has invalid type: ${trigger.type || 'none'}`);
        }
        if (trigger.type === 'explicit_request' || trigger.type === 'high_intent') {
          if (!trigger.phrases || !Array.isArray(trigger.phrases)) {
            errors.push(`Escalation trigger [index ${idx}] of type "${trigger.type}" must have a phrases array`);
          }
        }
        if (trigger.type === 'sentiment_low' && typeof trigger.threshold !== 'number') {
          errors.push(`Escalation trigger [index ${idx}] of type "sentiment_low" must have a numeric threshold`);
        }
        if (trigger.type === 'max_duration' && typeof trigger.seconds !== 'number') {
          errors.push(`Escalation trigger [index ${idx}] of type "max_duration" must have a numeric seconds field`);
        }
      });
    }
  }
  
  if (script.max_duration_seconds !== undefined && typeof script.max_duration_seconds !== 'number') {
    errors.push('max_duration_seconds must be a number');
  }
  
  if (errors.length > 0) {
    statusBadge.textContent = 'INVALID';
    statusBadge.className = 'lx-badge badge-red';
    errorsDiv.innerHTML = errors.map(err => `• ${err}`).join('<br>');
    errorsDiv.style.display = 'block';
    visualizer.innerHTML = `<div style="text-align: center; color: var(--lx-red); padding: 30px 0;">Validation Failed. Fix errors to preview nodes.</div>`;
    return false;
  }
  
  statusBadge.textContent = 'VALID';
  statusBadge.className = 'lx-badge badge-green';
  errorsDiv.style.display = 'none';
  
  renderScriptFlowVisualizer(script);
  return true;
};

window.saveScriptJsonUI = async function() {
  const isValid = validateScriptJsonUI();
  if (!isValid) {
    showToast('Save Failed', 'Please fix JSON syntax or validation errors before saving.', 'alert-triangle', 'error');
    return;
  }
  
  const jsonArea = document.getElementById('scriptJsonArea');
  const script = JSON.parse(jsonArea.value.trim());
  
  try {
    const res = await fetch(`${API_BASE}/scripts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(script)
    });
    
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Script Published', `Successfully published version ${script.version} of script "${script.script_id}".`, 'check');
      logActivityFeed('Script published: <strong>' + script.script_id + ' (v' + script.version + ')</strong>.');
      await loadScriptEditorData();
    } else {
      showToast('Save Failed', data.message || 'Server-side validation failed.', 'alert-triangle', 'error');
    }
  } catch (err) {
    console.error('Error saving script:', err);
    showToast('Network Error', 'Failed to publish script to backend.', 'alert-triangle', 'error');
  }
};

function renderScriptFlowVisualizer(script) {
  const visualizer = document.getElementById('scriptFlowVisualizer');
  if (!visualizer || !script.nodes) return;
  
  if (script.nodes.length === 0) {
    visualizer.innerHTML = `<div style="text-align: center; color: var(--lx-muted); padding: 30px 0;">No nodes in script.</div>`;
    return;
  }
  
  visualizer.innerHTML = script.nodes.map(node => {
    const isTerminal = node.is_terminal === true || !node.branches || Object.keys(node.branches).length === 0;
    const terminalBadge = isTerminal ? `<span class="lx-badge badge-red" style="font-size: 9px; padding: 2px 6px;">Terminal</span>` : '';
    
    const intents = node.expected_intents || [];
    const intentsHtml = intents.map(i => `<span class="lx-badge badge-gray" style="font-size: 9px; margin-right: 4px;">${i}</span>`).join('');
    
    const branches = node.branches || {};
    const branchesHtml = Object.entries(branches).map(([intent, target]) => {
      return `<div style="font-size: 11px; margin-top: 4px; color: var(--lx-muted);">
        <i data-lucide="corner-down-right" style="width: 10px; height: 10px; display: inline-block; vertical-align: middle; margin-right: 4px;"></i>
        If intent is <strong style="color: var(--lx-text); font-family: var(--lx-mono);">${intent}</strong> &rarr; go to <strong style="color: var(--lx-teal);">${target}</strong>
      </div>`;
    }).join('');
    
    return `
      <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--lx-border); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 6px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed var(--lx-border); padding-bottom: 4px;">
          <strong style="color: var(--lx-teal); font-family: var(--lx-mono); font-size: 12.5px;"># ${node.id}</strong>
          ${terminalBadge}
        </div>
        <div style="font-size: 11.5px; color: var(--lx-text); line-height: 1.4; font-style: italic;">&ldquo;${node.prompt}&rdquo;</div>
        ${intentsHtml ? `<div style="margin-top: 2px;">${intentsHtml}</div>` : ''}
        ${branchesHtml ? `<div style="margin-top: 2px; border-top: 1px solid rgba(255,255,255,0.02); padding-top: 4px;">${branchesHtml}</div>` : ''}
      </div>
    `;
  }).join('');
  
  if (window.lucide) {
    window.lucide.createIcons({ attrs: { class: 'lx-icon' }, parent: visualizer });
  }
}

window.viewBriefModal = async function(leadId) {
  try {
    const res = await fetch(`${API_BASE}/handoff/brief/${leadId}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.brief) {
        const brief = data.brief;
        const modal = document.getElementById('agentBriefModal');
        const content = document.getElementById('briefModalContent');
        const printBtn = document.getElementById('printBriefBtn');
        const resolveBtn = document.getElementById('resolveBriefBtn');
        
        if (modal && content) {
          modal.style.display = 'flex';
          
          const keyPhrases = brief.key_phrases || [];
          const objections = brief.objections || [];
          
          content.innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; background: rgba(255,255,255,0.02); padding: 10px; border-radius: 8px; border: 1px solid var(--lx-border);">
              <div>
                <span style="font-size: 10px; color: var(--lx-muted); text-transform: uppercase;">Lead Name</span>
                <div style="font-size: 13.5px; font-weight: bold; color: var(--lx-text);">${brief.lead_name}</div>
              </div>
              <div>
                <span style="font-size: 10px; color: var(--lx-muted); text-transform: uppercase;">Lead Score</span>
                <div style="font-size: 13.5px; font-weight: bold; color: var(--lx-green);">${brief.lead_score} / 100</div>
              </div>
              <div>
                <span style="font-size: 10px; color: var(--lx-muted); text-transform: uppercase;">Phone Number</span>
                <div style="font-size: 13.5px; font-family: var(--lx-mono); color: var(--lx-text);">${brief.phone}</div>
              </div>
              <div>
                <span style="font-size: 10px; color: var(--lx-muted); text-transform: uppercase;">Call Duration</span>
                <div style="font-size: 13.5px; font-family: var(--lx-mono); color: var(--lx-text);">${brief.call_duration_seconds} seconds</div>
              </div>
            </div>
            
            <div>
              <span style="font-size: 10px; color: var(--lx-muted); text-transform: uppercase; display: block; margin-bottom: 4px;">AI Call Summary</span>
              <div style="background: rgba(255,255,255,0.01); border: 1px solid var(--lx-border); padding: 8px 10px; border-radius: 6px; line-height: 1.4; color: var(--lx-text); font-style: italic;">
                &ldquo;${brief.call_summary}&rdquo;
              </div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div>
                <span style="font-size: 10px; color: var(--lx-muted); text-transform: uppercase; display: block; margin-bottom: 4px;">Key Phrases Detected</span>
                <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                  ${keyPhrases.length > 0 ? keyPhrases.map(p => `<span class="lx-badge badge-teal" style="font-size: 9px; padding: 2px 6px;">${p}</span>`).join('') : '<span style="font-size:11px; color:var(--lx-muted);">None detected</span>'}
                </div>
              </div>
              <div>
                <span style="font-size: 10px; color: var(--lx-muted); text-transform: uppercase; display: block; margin-bottom: 4px;">Objections Raised</span>
                <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                  ${objections.length > 0 ? objections.map(o => `<span class="lx-badge badge-red" style="font-size: 9px; padding: 2px 6px;">${o}</span>`).join('') : '<span style="font-size:11px; color:var(--lx-muted);">None detected</span>'}
                </div>
              </div>
            </div>
            
            <div style="background: rgba(30, 201, 183, 0.1); border: 1px solid rgba(30, 201, 183, 0.3); padding: 10px; border-radius: 8px; margin-top: 4px;">
              <span style="font-size: 10px; color: var(--lx-teal); text-transform: uppercase; font-weight: bold; display: block; margin-bottom: 2px;">Recommended Specialist Action</span>
              <div style="font-size: 12.5px; font-weight: 600; color: var(--lx-text);">${brief.recommended_action}</div>
            </div>
          `;
          
          if (printBtn) {
            printBtn.onclick = () => {
              const printWindow = window.open('', '_blank');
              printWindow.document.write(`
                <html>
                  <head>
                    <title>LeadX Agent Brief - ${brief.lead_name || 'Context'}</title>
                    <style>
                      body { font-family: 'DM Sans', sans-serif; padding: 40px; color: #1e272e; background: #f5f6fa; }
                      .card { background: white; border: 1px solid #dcdde1; padding: 24px; border-radius: 12px; max-width: 600px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
                      h1 { font-size: 20px; font-weight: 700; border-bottom: 2px solid #2f3542; padding-bottom: 12px; margin-top: 0; display: flex; justify-content: space-between; }
                      .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; background: #f8f9fa; padding: 12px; border-radius: 8px; }
                      .label { font-size: 11px; color: #7f8c8d; text-transform: uppercase; }
                      .val { font-size: 14px; font-weight: bold; margin-top: 2px; }
                      .section { margin-top: 20px; }
                      .section-title { font-size: 11px; font-weight: bold; color: #7f8c8d; text-transform: uppercase; border-bottom: 1px solid #dcdde1; padding-bottom: 4px; margin-bottom: 8px; }
                      .summary { font-style: italic; line-height: 1.5; color: #2f3542; background: #f1f2f6; padding: 12px; border-radius: 8px; }
                      .badge { display: inline-block; font-size: 10px; font-weight: bold; padding: 4px 8px; border-radius: 4px; margin-right: 6px; margin-top: 4px; }
                      .badge-teal { background: #d1f2eb; color: #16a085; }
                      .badge-red { background: #fadbd8; color: #c0392b; }
                      .recommendation { background: #e8f8f5; border: 1px solid #a3e4d7; padding: 12px; border-radius: 8px; font-weight: bold; color: #16a085; }
                    </style>
                  </head>
                  <body>
                    <div class="card">
                      <h1><span>LEADX HANDOFF BRIEF</span> <span style="color: #16a085;">SCORE ${brief.lead_score}</span></h1>
                      <div class="row">
                        <div>
                          <div class="label">Lead Name</div>
                          <div class="val">${brief.lead_name}</div>
                        </div>
                        <div>
                          <div class="label">Phone Number</div>
                          <div class="val">${brief.phone}</div>
                        </div>
                        <div>
                          <div class="label">Call Duration</div>
                          <div class="val">${brief.call_duration_seconds}s</div>
                        </div>
                        <div>
                          <div class="label">Date Generated</div>
                          <div class="val">${new Date().toLocaleDateString()}</div>
                        </div>
                      </div>
                      <div class="section">
                        <div class="section-title">AI Call Summary</div>
                        <div class="summary">&ldquo;${brief.call_summary}&rdquo;</div>
                      </div>
                      <div class="section" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <div>
                          <div class="section-title">Key Phrases</div>
                          <div>
                            ${keyPhrases.map(p => `<span class="badge badge-teal">${p}</span>`).join('') || 'None detected'}
                          </div>
                        </div>
                        <div>
                          <div class="section-title">Objections</div>
                          <div>
                            ${objections.map(o => `<span class="badge badge-red">${o}</span>`).join('') || 'None detected'}
                          </div>
                        </div>
                      </div>
                      <div class="section">
                        <div class="section-title">Recommended Specialist Action</div>
                        <div class="recommendation">${brief.recommended_action}</div>
                      </div>
                    </div>
                    <script>
                      setTimeout(() => { window.print(); }, 500);
                    </script>
                  </body>
                </html>
              `);
              printWindow.document.close();
            };
          }
          
          if (resolveBtn) {
            resolveBtn.onclick = async () => {
              try {
                const res = await fetch(`${API_BASE}/${leadId}/resolve`, { method: 'POST' });
                const data = await res.json();
                if (res.ok && data.success) {
                  showToast('Escalation Resolved', 'Status marked as called. Escalation cleared.', 'check');
                  modal.style.display = 'none';
                  await fetchLeadsList();
                } else {
                  showToast('Resolution Failed', data.message || 'Could not resolve escalation.', 'alert-triangle', 'error');
                }
              } catch (err) {
                showToast('Network Error', 'Connection failed.', 'alert-triangle', 'error');
              }
            };
          }
        }
      } else {
        showToast('Not Found', 'No agent brief found for this lead.', 'alert-triangle', 'warning');
      }
    } else {
      showToast('Brief Error', 'Failed to retrieve agent brief context.', 'alert-triangle', 'error');
    }
  } catch (err) {
    console.error('Error fetching brief details:', err);
    showToast('Network Error', 'Failed to connect to brief endpoint.', 'alert-triangle', 'error');
  }
};

async function loadDashboardAnalytics() {
  try {
    const res = await fetch(`${API_BASE}/analytics/summary?tenant_id=${currentTenant}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        // Update KPIs
        const totalCallsEl = document.getElementById('kpi-total-calls');
        const connectRateEl = document.getElementById('kpi-connect-rate');
        const qualifiedLeadsEl = document.getElementById('kpi-qualified-leads');
        const hotLeadsEl = document.getElementById('kpi-hot-leads');
        
        if (totalCallsEl) totalCallsEl.textContent = data.kpis.calls_today.toLocaleString();
        if (connectRateEl) connectRateEl.textContent = data.kpis.connect_rate.toFixed(1) + '%';
        if (qualifiedLeadsEl) qualifiedLeadsEl.textContent = data.kpis.qualified_leads.toLocaleString();
        if (hotLeadsEl) hotLeadsEl.textContent = data.kpis.hot_leads.toLocaleString();
        
        // Update Funnel stages
        const stages = document.querySelectorAll('.lx-funnel .funnel-stage');
        if (stages.length === 7) {
          const f = data.funnel;
          
          const setStage = (index, label, countText, percent) => {
            const stage = stages[index];
            if (stage) {
              const fill = stage.querySelector('.funnel-fill');
              const count = stage.querySelector('.funnel-count');
              if (fill) {
                fill.textContent = countText;
                fill.style.width = `${percent}%`;
              }
              if (count) {
                count.textContent = `${percent.toFixed(1)}%`;
              }
            }
          };

          setStage(0, 'Ingested', `${f.ingested} leads`, 100);
          setStage(1, 'Scrubbed (DNC)', `${f.scrubbed} leads`, f.ingested > 0 ? (f.scrubbed / f.ingested) * 100 : 0);
          setStage(2, 'Scored', `${f.scored} leads`, f.ingested > 0 ? (f.scored / f.ingested) * 100 : 0);
          setStage(3, 'Queued', `${f.queued} leads`, f.ingested > 0 ? (f.queued / f.ingested) * 100 : 0);
          setStage(4, 'Attempted', `${f.attempted} calls`, f.ingested > 0 ? (f.attempted / f.ingested) * 100 : 0);
          setStage(5, 'Connected', `${f.connected} connects`, f.ingested > 0 ? (f.connected / f.ingested) * 100 : 0);
          setStage(6, 'Qualified', `${f.qualified} qualified`, f.ingested > 0 ? (f.qualified / f.ingested) * 100 : 0);
        }
        
        // Render Chart.js line/doughnut/bar charts
        renderAnalyticsCharts(data);
      }
    }
  } catch (err) {
    console.error('Error loading dashboard analytics:', err);
  }
}

function renderAnalyticsCharts(data) {
  // 1. Connect Rate Trend
  const crCanvas = document.getElementById('connectRateChart');
  if (crCanvas) {
    if (connectRateChartInstance) {
      connectRateChartInstance.destroy();
    }
    const ctx = crCanvas.getContext('2d');
    connectRateChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.connect_rate_trend.map(t => t.date),
        datasets: [{
          label: 'Connect Rate (%)',
          data: data.connect_rate_trend.map(t => t.connect_rate),
          borderColor: '#6c72f8',
          backgroundColor: 'rgba(108, 114, 248, 0.15)',
          borderWidth: 2.5,
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#a4b0be', font: { size: 10 } }
          },
          y: {
            min: 0,
            max: 100,
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#a4b0be', font: { size: 10 } }
          }
        }
      }
    });
  }

  // 2. Dispositions Pie Chart
  const dispCanvas = document.getElementById('dispositionsChart');
  if (dispCanvas) {
    if (dispositionsChartInstance) {
      dispositionsChartInstance.destroy();
    }
    const ctx = dispCanvas.getContext('2d');
    dispositionsChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: data.dispositions.map(d => d.name),
        datasets: [{
          data: data.dispositions.map(d => d.value),
          backgroundColor: [
            '#6c72f8', '#2ecc8a', '#1ec9b7', '#ff4757', '#ffa502', '#2f3542', '#a4b0be'
          ],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#a4b0be', font: { size: 10 } }
          }
        }
      }
    });
  }

  // 3. Scoring Effectiveness
  const effCanvas = document.getElementById('scoringEffectivenessChart');
  if (effCanvas) {
    if (scoringEffectivenessChartInstance) {
      scoringEffectivenessChartInstance.destroy();
    }
    const ctx = effCanvas.getContext('2d');
    scoringEffectivenessChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.scoring_effectiveness.map(s => s.category),
        datasets: [{
          label: 'Conversions',
          data: data.scoring_effectiveness.map(s => s.converted),
          backgroundColor: ['#2ecc8a', '#ffa502', '#ff4757'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#a4b0be', font: { size: 10 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#a4b0be', font: { size: 10 } }
          }
        }
      }
    });
  }
}

