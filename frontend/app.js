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
      // Find Client Portal item in sidebar and trigger click
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
      showToast('Tenant Switched', `Switched active tenant context to: ${currentTenant}`, '🔑');
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

  // Reset Scoring Weights to defaults — with "already at defaults" guard
  if (resetWeightsBtn) {
    resetWeightsBtn.addEventListener('click', () => {
      // Check if sliders are already at default values
      const isAlreadyDefault = Object.keys(DEFAULT_WEIGHTS).every(key =>
        sliders[key] && Math.abs(parseFloat(sliders[key].value) - DEFAULT_WEIGHTS[key]) < 0.001
      );

      if (isAlreadyDefault) {
        // Already at defaults — tell the user, briefly animate the button
        resetWeightsBtn.textContent = '✓ Already Default';
        resetWeightsBtn.style.color = 'var(--lx-green)';
        resetWeightsBtn.style.borderColor = 'rgba(46,204,138,0.4)';
        setTimeout(() => {
          resetWeightsBtn.textContent = '↺ Reset';
          resetWeightsBtn.style.color = '';
          resetWeightsBtn.style.borderColor = '';
        }, 2000);
        return;
      }

      // Apply defaults
      Object.keys(DEFAULT_WEIGHTS).forEach(key => {
        if (sliders[key]) sliders[key].value = DEFAULT_WEIGHTS[key];
        if (sliderVals[key]) sliderVals[key].textContent = DEFAULT_WEIGHTS[key].toFixed(2);
      });
      updateWeightsSum();
      showToast('Weights Reset', 'Restored to defaults: 0.25 / 0.25 / 0.20 / 0.15 / 0.15', '↺');
    });
  }

  // Leads Filter Badges — active class toggling (counts updated by renderLeads)
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
  
  // Weights check within 0.001 delta tolerance
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
    // A. Fetch config weights
    const configRes = await fetch(`${API_BASE}/config?tenant_id=${currentTenant}`);
    if (configRes.ok) {
      const configData = await configRes.json();
      if (configData.success && configData.weights) {
        tenantWeights = configData.weights;
        // Update slider values
        Object.keys(tenantWeights).forEach(key => {
          if (sliders[key]) {
            sliders[key].value = tenantWeights[key];
            if (sliderVals[key]) sliderVals[key].textContent = tenantWeights[key].toFixed(2);
          }
        });
        updateWeightsSum();
      }
    }

    // B. Fetch Leads list
    await fetchLeadsList();
  } catch (error) {
    console.error('Error fetching tenant details:', error);
    showToast('Load Error', 'Failed to retrieve tenant configuration details from backend server.', '❌', 'error');
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
    showToast('Fetch Error', 'Failed to update lead intelligence feed from backend.', '❌', 'error');
  }
}

// 4b. Update filter badge live counts
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
          <div class="lx-empty"><span>⏳</span><div>No leads match this filter. Ingest leads or switch filter.</div></div>
        </td>
      </tr>`;
    return;
  }

  leadsList.innerHTML = filtered.map(lead => {
    const score = lead.score || 0;

    let tierClass, dispText, dispClass, scoreColor;
    if (score >= 80) {
      tierClass = 'tier-hot'; dispText = 'HOT LEAD'; dispClass = 'disp-hot'; scoreColor = 'var(--lx-green)';
    } else if (score >= 65) {
      tierClass = 'tier-qualified'; dispText = 'QUALIFIED'; dispClass = 'disp-qualified'; scoreColor = 'var(--lx-accent)';
    } else if (score >= 50) {
      tierClass = 'tier-warm'; dispText = 'WARM LEAD'; dispClass = 'disp-warm'; scoreColor = 'var(--lx-amber)';
    } else {
      tierClass = 'tier-cold'; dispText = 'NO INTENT'; dispClass = 'disp-cold'; scoreColor = 'var(--lx-red)';
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
    const timeStr = lead.created_at
      ? new Date(lead.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'Just Now';

    return `
      <tr id="lead-tr-${lead.id}" class="${tierClass}">
        <td>
          <div class="lead-name-strong">${lead.name || 'Anonymous'}</div>
          <div class="lead-meta-sub">📍 ${city} (Age: ${age})</div>
        </td>
        <td><span style="font-family:var(--lx-mono);font-size:12px;">${maskedPhone}</span></td>
        <td><span class="lx-source-badge src-${srcKey}">${srcLabel}</span></td>
        <td style="text-align:center;"><div class="lx-score-cell">${scoreSvg}</div></td>
        <td><span class="lx-badge ${dispClass}">${dispText}</span></td>
        <td><span style="font-size:11px;color:var(--lx-muted);font-family:var(--lx-mono);">${timeStr}</span></td>
        <td>
          <div class="lx-action-row">
            <button class="btn-call" onclick="triggerMockCall('${lead.id}','${lead.name}','${lead.phone}',${score})">📞 Call</button>
            <button class="btn-handoff" onclick="triggerMockHandoff('${lead.id}','${lead.name}')">🤝 Handoff</button>
            <button class="btn-icon-sm danger" onclick="triggerMockDnc('${lead.id}','${lead.phone}')" title="Flag DNC">🚫</button>
            <button class="btn-icon-sm" onclick="rescoreSingleLead('${lead.id}')" title="Rescore">🔄</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}


// 6. Update KPIs based on leads
function updateDashboardKPIs(leads) {
  const hotLeads = leads.filter(l => l.score >= 80);
  const warmLeads = leads.filter(l => l.score >= 50 && l.score < 80);
  
  // Simple ratios
  const totalCallsCount = 14800 + leads.length * 3;
  const connectRate = 68.4;
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

    // Grab top 3 hot leads
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
            <div class="hlr-meta">📞 ${maskedPhone} | ${lead.raw_data?.city || 'India'}</div>
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
      showToast('Config Saved', 'Scoring weights updated successfully on server.', '✅');
      loadTenantData();
      logActivityFeed('Configuration weights modified by user context.');
    } else {
      showToast('Save Failed', data.message || 'Validation failed on server.', '❌', 'error');
    }
  } catch (error) {
    console.error('Error saving weights:', error);
    showToast('Network Error', 'Connection failed while saving configurations.', '❌', 'error');
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
    raw_data
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
      showToast('Lead Ingested', `Created lead: ${data.lead.name || 'Anonymous'} | Score: ${data.lead.score}`, '🎉');
      singleIngestForm.reset();
      await fetchLeadsList();
      logActivityFeed(`New lead <strong>${data.lead.name || 'Anonymous'}</strong> ingested successfully (Score: ${data.lead.score}).`);
    } else if (res.status === 409) {
      showToast('Duplicate Lead', '409 Conflict: Phone number already exists for this tenant.', '⚠️', 'warning');
    } else {
      showToast('Ingest Failed', data.message || 'Payload validation error.', '❌', 'error');
    }
  } catch (error) {
    console.error('Ingest error:', error);
    showToast('Network Error', 'Could not establish connection to the server.', '❌', 'error');
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
        "city": "Tier 2 City",
        "pages_visited": 2,
        "video_watched": false
      }
    },
    {
      "name": "Invalid Lead Test",
      "phone": "123",
      "source": "paid_ads"
    }
  ];
  batchJsonArea.value = JSON.stringify(template, null, 2);
  showToast('Template Loaded', 'JSON array template populated in workspace.', '📝');
}

// 10. Batch Ingest API Handler
async function handleBatchIngest() {
  const jsonStr = batchJsonArea.value.trim();
  if (!jsonStr) {
    showToast('Input Required', 'Please enter valid JSON array first.', '⚠️', 'warning');
    return;
  }

  let leadsArray = null;
  try {
    leadsArray = JSON.parse(jsonStr);
    if (!Array.isArray(leadsArray)) {
      throw new Error('JSON is not an array');
    }
  } catch (err) {
    showToast('JSON Parse Error', 'Make sure your JSON is structured as a valid Array.', '❌', 'error');
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
        leads: leadsArray
      })
    });

    const data = await res.json();
    if (res.ok) {
      showToast('Batch Complete', `Accepted: ${data.accepted} | Rejected: ${data.rejected} | Duplicates: ${data.duplicates}`, '📂');
      batchJsonArea.value = '';
      await fetchLeadsList();
      logActivityFeed(`Batch ingested: <strong>${data.accepted} accepted</strong>, ${data.rejected} rejected, ${data.duplicates} duplicates.`);
    } else {
      showToast('Batch Failed', data.message || 'Validation failed for batch schema.', '❌', 'error');
    }
  } catch (error) {
    console.error('Batch Ingest error:', error);
    showToast('Network Error', 'Connection lost during batch processing.', '❌', 'error');
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
      showToast('Lead Rescored', `Lead score updated: ${data.old_score} ➡️ ${data.new_score}`, '🔄');
      await fetchLeadsList();
      logActivityFeed(`Lead <strong>${data.lead.name || 'Anonymous'}</strong> rescored from ${data.old_score} to ${data.new_score}.`);
    } else {
      showToast('Rescore Failed', data.message || 'Unable to update lead score.', '❌', 'error');
      if (trEl) trEl.style.opacity = '1';
    }
  } catch (error) {
    console.error('Rescore single lead error:', error);
    showToast('Network Error', 'Failed to connect to rescoring endpoint.', '❌', 'error');
    if (trEl) trEl.style.opacity = '1';
  }
};

// 12. Rescore All Leads API Handler
async function handleRescoreAll() {
  if (allLeads.length === 0) {
    showToast('No Leads', 'There are no active leads loaded to rescore.', '⚠️', 'warning');
    return;
  }

  rescoreAllBtn.setAttribute('disabled', 'true');
  rescoreAllBtn.textContent = 'Recalculating...';

  try {
    // Fetch and trigger rescore in parallel
    const promises = allLeads.map(l => 
      fetch(`${API_BASE}/${l.id}/rescore`, { method: 'POST' })
        .then(r => r.json())
        .catch(err => ({ success: false }))
    );

    const results = await Promise.all(promises);
    const successful = results.filter(r => r.success).length;

    showToast('Recalculation Complete', `Successfully rescored ${successful} leads.`, '🚀');
    await fetchLeadsList();
    logActivityFeed(`Bulk recalculation completed for <strong>${successful} leads</strong>.`);
  } catch (error) {
    console.error('Rescore all error:', error);
    showToast('Recalculation Failed', 'Error batch rescoring tenant leads.', '❌', 'error');
  } finally {
    rescoreAllBtn.removeAttribute('disabled');
    rescoreAllBtn.textContent = 'Rescore All Leads';
  }
}

// 13. Interactive Mock Operations (VOIZ dialer simulator)
window.triggerMockCall = function(leadId, leadName, leadPhone, score) {
  showToast('Initiating Dial', `Connecting VOIZ Roster to ${leadName}...`, '📞');
  logActivityFeed(`VOIZ dialer attempting connection for: <strong>${leadName}</strong> (${leadPhone}).`);

  // Switch to Live Monitor automatically to show the waveform animation!
  setTimeout(() => {
    const liveMonitorItem = document.querySelector('.lx-sidebar-item[data-page="monitor"]');
    if (liveMonitorItem) {
      liveMonitorItem.click();
    }
    
    // Add call card to list dynamically
    const liveList = document.getElementById('live-calls-list');
    const newCallCard = document.createElement('div');
    newCallCard.className = 'lx-livecall';
    newCallCard.id = `livecall-sim-${leadId}`;
    newCallCard.style.borderLeft = '4px solid var(--lx-green)';
    
    // Create random waveform animation
    newCallCard.innerHTML = `
      <div class="lc-header">
        <span class="lx-badge badge-green">ON CALL</span>
        <strong class="lc-title">${leadName}</strong>
        <span class="lc-sub">VOIZ-01 (Kavita) connected</span>
      </div>
      <div class="lc-grid">
        <div class="lc-item">
          <span class="lc-item-label">Phone</span>
          <span class="lc-item-val">${leadPhone.substring(0, leadPhone.length - 5) + '***' + leadPhone.substring(leadPhone.length - 2)}</span>
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
    
    // Prepend to top of list
    liveList.insertBefore(newCallCard, liveList.firstChild);
    updateLiveCallsCountBadge();

    // Start a mock timer for the call duration
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

    // After 15 seconds, complete call or simulate disconnect
    setTimeout(() => {
      clearInterval(interval);
      const simCard = document.getElementById(`livecall-sim-${leadId}`);
      if (simCard) {
        simCard.remove();
        updateLiveCallsCountBadge();
        showToast('Call Completed', `VOIZ call finished for ${leadName}. Syncing outcome.`, '✅');
        logActivityFeed(`VOIZ dialer completed call with <strong>${leadName}</strong>. Dispositioned: Interested.`);
      }
    }, 15000);
  }, 1200);
};

window.triggerMockHandoff = function(leadId, leadName) {
  showToast('Warm Handoff', `Routing high-intent lead ${leadName} to Muthoot Finance specialist...`, '🤝');
  logActivityFeed(`Warm handoff triggered for <strong>${leadName}</strong>. Routing to specialist queue.`);

  // Auto switch to Live monitor to show handoff highlight
  setTimeout(() => {
    const liveMonitorItem = document.querySelector('.lx-sidebar-item[data-page="monitor"]');
    if (liveMonitorItem) {
      liveMonitorItem.click();
    }
  }, 1000);
};

window.triggerMockDnc = function(leadId, leadPhone) {
  showToast('Added to DNC', `Phone number ${leadPhone} has been added to the Do Not Call registry.`, '🚫', 'warning');
  logActivityFeed(`DNC block enforced on lead phone: <strong>${leadPhone}</strong>. Auto-purged from dialer queues.`);
  
  // Highlight and remove row
  const row = document.getElementById(`lead-tr-${leadId}`);
  if (row) {
    row.style.background = 'rgba(240, 84, 100, 0.15)';
    setTimeout(() => {
      row.remove();
      // Update count
      allLeads = allLeads.filter(l => l.id !== leadId);
      renderLeads(allLeads);
      updateDashboardKPIs(allLeads);
    }, 1500);
  }
};

// 14. Campaign config mock save handlers
window.saveCampaignConfig = function(modeName) {
  showToast('Config Saved', `${modeName} campaign configurations updated successfully.`, '⚙️');
  logActivityFeed(`Campaign settings updated for <strong>${modeName}</strong>. Configs saved.`);
};

window.preflightVerifyCampaign = function() {
  const campName = document.getElementById('cfg-sch-name').value.trim() || 'Scheduled Campaign';
  showToast('Verification', `Running pre-flight checks for ${campName}...`, '🧪');
  
  setTimeout(() => {
    showToast('Checks Passed', 'Dynamic weights, DNC registries, and VOIZ agent rosters validated.', '✅');
    logActivityFeed(`Pre-flight checks passed for scheduled campaign: <strong>${campName}</strong>.`);
  }, 1500);
};

// 15. Client portal interactions
window.exportClientReport = function() {
  showToast('Exporting Report', 'Compiling Muthoot Finance performance sheets...', '📂');
  setTimeout(() => {
    showToast('Download Ready', 'LeadX_Muthoot_Report_June.pdf has been generated.', '📥');
  }, 1500);
};

// 16. Utility Helpers
function showToast(title, body, icon = 'ℹ️', type = 'info') {
  toastIcon.textContent = icon;
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

  // Auto hide
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
    // Prepend
    timeline.insertBefore(item, timeline.firstChild);
    
    // Cap at 6 events
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

// Periodically updates live monitor counts and timers to feel interactive
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

// 17. Seed initial leads in mock DB if database is empty on page load
async function seedInitialDataIfEmpty() {
  try {
    const leadsRes = await fetch(`${API_BASE}?tenant_id=${currentTenant}`);
    if (leadsRes.ok) {
      const data = await leadsRes.json();
      if (data.success && data.leads.length === 0) {
        // Seed 4-5 dummy leads automatically
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
        
        // Reload
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
  
  // Random timeline events interval
  setInterval(() => {
    const events = [
      "CRM sync succeeded for tenant: <strong>default-tenant</strong>.",
      "VOIZ dialer completed call with <strong>Jane Smith</strong>.",
      "Lead <strong>Alex Mercer</strong> qualification score verified.",
      "Dialing retry scheduled for lead: +91 99343 ***12.",
      "Non-RT Campaign concurrency adjusted: 15 threads.",
      "Webhook ingested lead from AdWords API (source: paid_ads)."
    ];
    const randomEvent = events[Math.floor(Math.random() * events.length)];
    logActivityFeed(randomEvent);
    updateLiveMonitorQueue();
  }, 12000);
}
