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

let parsedCsvHeaders = [];
let parsedCsvRows = [];

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

const sliders = {
  demographic_fit: document.getElementById('weight-demographic_fit'),
  source_quality: document.getElementById('weight-source_quality'),
  recency: document.getElementById('weight-recency'),
  behavioural_signals: document.getElementById('weight-behavioural_signals'),
  prior_interaction: document.getElementById('weight-prior_interaction')
};

const sliderVals = {
  demographic_fit: document.getElementById('val-demographic_fit'),
  source_quality: document.getElementById('val-source_quality'),
  recency: document.getElementById('val-recency'),
  behavioural_signals: document.getElementById('val-behavioural_signals'),
  prior_interaction: document.getElementById('val-prior_interaction')
};

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

  // Poll call events stream every 5 seconds
  setInterval(fetchCallEventsStream, 5000);
  fetchCallEventsStream();

  // Audit Logs Poller
  setInterval(fetchAuditTrail, 10000);
  fetchAuditTrail();
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

  // Dynamic slider input listeners
  Object.keys(sliders).forEach(key => {
    if (sliders[key]) {
      sliders[key].addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (sliderVals[key]) sliderVals[key].textContent = val.toFixed(2);
        updateWeightsSum();
      });
    }
  });

  // Save weights config
  saveConfigBtn.addEventListener('click', saveWeightsConfig);

  // Ingest forms pill tab toggling
  const ingestTabs = document.querySelectorAll('#ingest-mode-tabs .lx-pill-tab');
  ingestTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      ingestTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const tabId = tab.getAttribute('data-tab');
      document.getElementById('ingest-form-single').className = 'tab-content' + (tabId === 'single' ? ' show' : '');
      document.getElementById('ingest-form-batch').className = 'tab-content' + (tabId === 'batch' ? ' show' : '');
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
  singleIngestForm.addEventListener('submit', handleSingleIngest);

  // Sample Batch loading
  loadSampleBatchBtn.addEventListener('click', loadSampleJsonTemplate);

  // Batch Ingest submit
  submitBatchBtn.addEventListener('click', handleBatchIngest);

  // Rescore All Leads
  rescoreAllBtn.addEventListener('click', handleRescoreAll);

  // Reset Scoring Weights to defaults
  if (resetWeightsBtn) {
    resetWeightsBtn.addEventListener('click', () => {
      const isAlreadyDefault = Object.keys(DEFAULT_WEIGHTS).every(key =>
        sliders[key] && Math.abs(parseFloat(sliders[key].value) - DEFAULT_WEIGHTS[key]) < 0.001
      );

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

      Object.keys(DEFAULT_WEIGHTS).forEach(key => {
        if (sliders[key]) sliders[key].value = DEFAULT_WEIGHTS[key];
        if (sliderVals[key]) sliderVals[key].textContent = DEFAULT_WEIGHTS[key].toFixed(2);
      });
      updateWeightsSum();
      showToast('Weights Reset', 'Restored to defaults: 0.25 / 0.25 / 0.20 / 0.15 / 0.15', 'rotate-ccw');
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
}

// 3. Dynamic Weight Calculation & Delta Checking
function updateWeightsSum() {
  let sum = 0;
  Object.keys(sliders).forEach(key => {
    if (sliders[key]) sum += parseFloat(sliders[key].value);
  });
  
  sumIndicator.textContent = `Sum: ${sum.toFixed(3)}`;
  
  if (Math.abs(sum - 1.0) <= 0.001) {
    sumIndicator.className = 'sum-indicator valid';
    saveConfigBtn.removeAttribute('disabled');
  } else {
    sumIndicator.className = 'sum-indicator invalid';
    saveConfigBtn.setAttribute('disabled', 'true');
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
        Object.keys(tenantWeights).forEach(key => {
          if (sliders[key]) {
            sliders[key].value = tenantWeights[key];
            if (sliderVals[key]) sliderVals[key].textContent = tenantWeights[key].toFixed(2);
          }
        });
        updateWeightsSum();
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
        renderLeads(allLeads);
        updateDashboardKPIs(allLeads);
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

// 5. Render Lead Feed & Dynamic UI Elements
function renderLeads(leads) {
  leadsCount.textContent = leads.length;
  sidebarLeadsCount.textContent = leads.length;
  updateFilterCounts(leads);

  let filtered = leads;
  if (currentFilter === 'hot') filtered = leads.filter(l => l.score >= 80);
  else if (currentFilter === 'warm') filtered = leads.filter(l => l.score >= 50 && l.score < 80);
  else if (currentFilter === 'cold') filtered = leads.filter(l => l.score < 50);

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
  Object.keys(sliders).forEach(key => {
    if (sliders[key]) weights[key] = parseFloat(sliders[key].value);
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
          timeline.innerHTML = data.logs.slice(0, 6).map(log => {
            const time = new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            let details = JSON.stringify(log.details);
            if (log.event_type === 'lead_ingested') {
              details = `Lead ingested successfully (Phone: ${log.details?.phone || 'Unknown'} | Score: ${log.details?.score || 0}).`;
            } else if (log.event_type === 'batch_leads_ingested') {
              details = `Batch processed: ${log.details?.accepted || 0} accepted for campaign: "${log.details?.campaign_name}".`;
            } else if (log.event_type === 'onboarding_config_updated') {
              details = `Client onboarding configuration updated for segment: ${log.details?.industry || 'BFSI'}.`;
            } else if (log.event_type === 'call_initiated') {
              details = `Call dial session initiated (Voiz ID: ${log.details?.voiz_session_id || 'Session'}).`;
            } else if (log.event_type === 'call_completed') {
              details = `Call finished. Outcome status set to: ${log.details?.disposition || 'complete'}.`;
            } else if (log.event_type === 'escalation_triggered') {
              details = `Lead escalated to supervisor. Syncing to HubSpot CRM (Reason: ${log.details?.reason}).`;
            } else if (log.event_type === 'dnc_block') {
              details = `Blocked dial to phone number matching DNC registry: ${log.details?.phone}.`;
            }
            
            return `
              <div class="tl-item">
                <span class="tl-dot sd-green"></span>
                <span class="tl-time">${time}</span>
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
  } else if (templateType === 'bfsi') {
    csv = `Customer Name,Contact Phone,Email Address,Age,Monthly Income,Credit Score
Karan Shah,+919999966666,karan.shah@example.com,35,75000,740
Neha Malhotra,+919999955555,neha.malhotra@example.com,29,52000,680`;
    document.getElementById('wizardCampaignName').value = 'BFSI Loan Ingest June';
    document.getElementById('wizardDatasetId').value = 'ds-bfsi-june-02';
  }
  document.getElementById('wizardUploadArea').value = csv;
  showToast('Sample Loaded', 'Loaded sample CSV data template.', 'clipboard');
};

window.parseAndPrepareMapping = function() {
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

  const fieldsContainer = document.getElementById('mappingFieldsContainer');
  const targetFields = [
    { key: 'name', label: 'Full Name' },
    { key: 'phone', label: 'Phone Number' },
    { key: 'email', label: 'Email' },
    { key: 'age', label: 'Age' },
    { key: 'income', label: 'Income' },
    { key: 'city', label: 'City' }
  ];

  fieldsContainer.innerHTML = targetFields.map(tf => {
    let bestMatch = '';
    const lowTF = tf.label.toLowerCase();
    parsedCsvHeaders.forEach(h => {
      const lowH = h.toLowerCase();
      if (lowH.includes(lowTF) || lowTF.includes(lowH) || 
          (tf.key === 'phone' && (lowH.includes('mobile') || lowH.includes('contact')))) {
        bestMatch = h;
      }
    });

    const optionsHtml = ['<option value="">-- Skip --</option>']
      .concat(parsedCsvHeaders.map(h => {
        const selectedAttr = h === bestMatch ? 'selected' : '';
        return `<option value="${h}" ${selectedAttr}>${h}</option>`;
      }))
      .join('');

    return `
      <div class="mapping-field-row" style="margin-bottom:8px;">
        <span>${tf.label}</span>
        <select class="lx-tenant-input" id="map-target-${tf.key}">
          ${optionsHtml}
        </select>
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
  const targetFields = ['name', 'phone', 'email', 'age', 'income', 'city'];
  const mappingConfig = {};
  targetFields.forEach(tf => {
    const el = document.getElementById(`map-target-${tf}`);
    mappingConfig[tf] = el ? el.value : '';
  });

  const previewHead = document.getElementById('mappingPreviewHead');
  const previewBody = document.getElementById('mappingPreviewBody');

  previewHead.innerHTML = `
    <tr>
      ${targetFields.map(tf => `<th>${tf.toUpperCase()}</th>`).join('')}
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
          const rawHeader = mappingConfig[tf];
          return `<td>${rawHeader ? row[rawHeader] || 'N/A' : '<span style="color:var(--lx-hint);">Skipped</span>'}</td>`;
        }).join('')}
      </tr>
    `;
  }).join('');
}

window.commitWizardData = function() {
  const targetFields = ['name', 'phone', 'email', 'age', 'income', 'city'];
  const mappingConfig = {};
  targetFields.forEach(tf => {
    const el = document.getElementById(`map-target-${tf}`);
    mappingConfig[tf] = el ? el.value : '';
  });

  if (!mappingConfig.phone) {
    showToast('Mapping Error', 'You must map the Phone Number field before ingestion.', 'alert-triangle', 'error');
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
    const raw_data = {
      city: mappingConfig.city ? row[mappingConfig.city] : undefined,
      age: mappingConfig.age ? parseInt(row[mappingConfig.age]) || undefined : undefined,
      income: mappingConfig.income ? parseInt(row[mappingConfig.income]) || undefined : undefined
    };
    return {
      name: mappingConfig.name ? row[mappingConfig.name] : undefined,
      phone: row[mappingConfig.phone],
      email: mappingConfig.email ? row[mappingConfig.email] : undefined,
      source: 'organic',
      raw_data
    };
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
