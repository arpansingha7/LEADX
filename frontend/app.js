// LEADX Frontend Engine
const API_BASE = '/leads';
let currentTenant = 'default-tenant';
let tenantWeights = {
  demographic_fit: 0.25,
  source_quality: 0.25,
  recency: 0.20,
  behavioural_signals: 0.15,
  prior_interaction: 0.15
};

// DOM Elements
const tenantIdInput = document.getElementById('tenantIdInput');
const loadTenantBtn = document.getElementById('loadTenantBtn');
const singleIngestForm = document.getElementById('singleIngestForm');
const submitSingleBtn = document.getElementById('submitSingleBtn');

const batchJsonArea = document.getElementById('batchJsonArea');
const loadSampleBatchBtn = document.getElementById('loadSampleBatchBtn');
const submitBatchBtn = document.getElementById('submitBatchBtn');

const saveConfigBtn = document.getElementById('saveConfigBtn');
const sumIndicator = document.getElementById('sumIndicator');
const rescoreAllBtn = document.getElementById('rescoreAllBtn');
const leadsList = document.getElementById('leadsList');
const leadsCount = document.getElementById('leadsCount');

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

// Toast Elements
const toast = document.getElementById('notificationToast');
const toastIcon = document.getElementById('toastIcon');
const toastTitle = document.getElementById('toastTitle');
const toastBody = document.getElementById('toastBody');
const toastClose = document.querySelector('.toast-close');

// Initialize
window.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadTenantData();
});

function setupEventListeners() {
  // Tenant loading
  loadTenantBtn.addEventListener('click', () => {
    const val = tenantIdInput.value.trim();
    if (val) {
      currentTenant = val;
      loadTenantData();
      showToast('Tenant Switched', `Switched active tenant context to: ${currentTenant}`, '🔑');
    }
  });

  // Slider adjustments
  Object.keys(sliders).forEach(key => {
    sliders[key].addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      sliderVals[key].textContent = val.toFixed(2);
      updateWeightsSum();
    });
  });

  // Save weights
  saveConfigBtn.addEventListener('click', saveWeightsConfig);

  // Single Ingest form submit
  singleIngestForm.addEventListener('submit', handleSingleIngest);

  // Sample Batch loading
  loadSampleBatchBtn.addEventListener('click', loadSampleJsonTemplate);

  // Batch Ingest submit
  submitBatchBtn.addEventListener('click', handleBatchIngest);

  // Rescore All Leads
  rescoreAllBtn.addEventListener('click', handleRescoreAll);

  // Toast Close
  toastClose.addEventListener('click', () => toast.classList.remove('show'));
}

// Weights logic
function updateWeightsSum() {
  let sum = 0;
  Object.keys(sliders).forEach(key => {
    sum += parseFloat(sliders[key].value);
  });
  
  sumIndicator.textContent = `Sum: ${sum.toFixed(3)}`;
  
  // Weights check
  if (Math.abs(sum - 1.0) <= 0.001) {
    sumIndicator.className = 'sum-indicator valid';
    saveConfigBtn.removeAttribute('disabled');
  } else {
    sumIndicator.className = 'sum-indicator invalid';
    saveConfigBtn.setAttribute('disabled', 'true');
  }
}

// Fetch Weights and Leads from server
async function loadTenantData() {
  try {
    // 1. Fetch config
    const configRes = await fetch(`${API_BASE}/config?tenant_id=${currentTenant}`);
    if (configRes.ok) {
      const configData = await configRes.json();
      if (configData.success && configData.weights) {
        tenantWeights = configData.weights;
        // Update slider UI
        Object.keys(tenantWeights).forEach(key => {
          sliders[key].value = tenantWeights[key];
          sliderVals[key].textContent = tenantWeights[key].toFixed(2);
        });
        updateWeightsSum();
      }
    }

    // 2. Fetch Leads
    await fetchLeadsList();
  } catch (error) {
    console.error('Error fetching tenant details:', error);
    showToast('Load Error', 'Failed to retrieve tenant details from backend server.', '❌', 'error');
  }
}

async function fetchLeadsList() {
  try {
    const leadsRes = await fetch(`${API_BASE}?tenant_id=${currentTenant}`);
    if (leadsRes.ok) {
      const leadsData = await leadsRes.json();
      if (leadsData.success) {
        renderLeads(leadsData.leads);
      }
    }
  } catch (err) {
    console.error('Error fetching leads:', err);
    showToast('Fetch Error', 'Failed to update leads feed.', '❌', 'error');
  }
}

function renderLeads(leads) {
  leadsCount.textContent = leads.length;
  if (leads.length === 0) {
    leadsList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">⏳</span>
        <p>No leads ingested yet. Ingest a lead to get started.</p>
      </div>
    `;
    return;
  }

  leadsList.innerHTML = leads.map(lead => {
    const score = lead.score;
    let badgeClass = 'cold';
    if (score >= 80) badgeClass = 'hot';
    else if (score >= 50) badgeClass = 'warm';

    const city = lead.raw_data?.city || 'Unknown City';
    const age = lead.raw_data?.age || 'N/A';
    const source = lead.source || 'Direct';

    return `
      <div class="lead-item" id="lead-item-${lead.id}">
        <div class="lead-info-main">
          <div class="lead-name-row">
            <span class="lead-name">${lead.name || 'Unnamed Lead'}</span>
            <span class="lead-source-badge">${source}</span>
          </div>
          <div class="lead-details-row">
            <span class="lead-details-item">📞 ${lead.phone}</span>
            <span class="lead-details-item">📍 ${city} (Age: ${age})</span>
          </div>
        </div>
        <div class="lead-score-area">
          <div class="score-badge ${badgeClass}" title="Score: ${score}">${score}</div>
          <button class="rescore-item-btn" onclick="rescoreSingleLead('${lead.id}')" title="Rescore lead">🔄</button>
        </div>
      </div>
    `;
  }).join('');
}

// API Call - Save weights
async function saveWeightsConfig() {
  const weights = {};
  Object.keys(sliders).forEach(key => {
    weights[key] = parseFloat(sliders[key].value);
  });

  try {
    const res = await fetch(`${API_BASE}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: currentTenant,
        weights,
        changed_by: 'arpan-dashboard'
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Config Saved', 'Scoring weights updated successfully on server.', '✅');
      loadTenantData();
    } else {
      showToast('Save Failed', data.message || 'Validation failed on server.', '❌', 'error');
    }
  } catch (error) {
    console.error('Error saving weights:', error);
    showToast('Network Error', 'Connection failed while saving configurations.', '❌', 'error');
  }
}

// API Call - Ingest Single Lead
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
      showToast('Lead Ingested', `Successfully created lead with score ${data.lead.score}`, '🎉');
      singleIngestForm.reset();
      fetchLeadsList();
    } else if (res.status === 409) {
      showToast('Duplicate Lead', '409: Phone number already exists for this tenant.', '⚠️', 'warning');
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

// In-window helper to load template JSON for testing
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
  showToast('Template Loaded', 'JSON structure populated in text editor.', '📝');
}

// API Call - Batch Ingest
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
  submitBatchBtn.textContent = 'Processing Batch...';

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
      fetchLeadsList();
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

// API Call - Rescore Single Lead
window.rescoreSingleLead = async function(leadId) {
  const itemEl = document.getElementById(`lead-item-${leadId}`);
  if (itemEl) {
    itemEl.style.opacity = '0.5';
  }

  try {
    const res = await fetch(`${API_BASE}/${leadId}/rescore`, {
      method: 'POST'
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Lead Rescored', `Lead rescored from ${data.old_score} ➡️ ${data.new_score}`, '🔄');
      fetchLeadsList();
    } else {
      showToast('Rescore Failed', data.message || 'Unable to update lead score.', '❌', 'error');
      if (itemEl) itemEl.style.opacity = '1';
    }
  } catch (error) {
    console.error('Rescore single lead error:', error);
    showToast('Network Error', 'Failed to connect to rescoring endpoint.', '❌', 'error');
    if (itemEl) itemEl.style.opacity = '1';
  }
};

// API Call - Rescore All Leads
async function handleRescoreAll() {
  const leadItems = leadsList.getElementsByClassName('lead-item');
  if (leadItems.length === 0) {
    showToast('No Leads', 'There are no active leads loaded to rescore.', '⚠️', 'warning');
    return;
  }

  rescoreAllBtn.setAttribute('disabled', 'true');
  rescoreAllBtn.textContent = 'Recalculating...';

  try {
    const res = await fetch(`${API_BASE}?tenant_id=${currentTenant}`);
    if (!res.ok) throw new Error('Failed to fetch lead list');
    const data = await res.json();
    const leads = data.leads;

    // Rescore all in parallel
    const promises = leads.map(l => 
      fetch(`${API_BASE}/${l.id}/rescore`, { method: 'POST' })
        .then(r => r.json())
        .catch(err => ({ success: false }))
    );

    const results = await Promise.all(promises);
    const successful = results.filter(r => r.success).length;

    showToast('Recalculation Complete', `Successfully rescored ${successful} leads.`, '🚀');
    fetchLeadsList();
  } catch (error) {
    console.error('Rescore all error:', error);
    showToast('Recalculation Failed', 'Error batch rescoring tenant leads.', '❌', 'error');
  } finally {
    rescoreAllBtn.removeAttribute('disabled');
    rescoreAllBtn.textContent = 'Rescore All Leads';
  }
}

// Toast Helper
let toastTimer = null;
function showToast(title, body, icon = 'ℹ️', type = 'info') {
  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastIcon.textContent = icon;
  toastTitle.textContent = title;
  toastBody.textContent = body;

  // Set colors based on type
  toast.className = 'toast show';
  if (type === 'error') {
    toast.style.borderLeft = '4px solid #e63946';
  } else if (type === 'warning') {
    toast.style.borderLeft = '4px solid #ffb703';
  } else {
    toast.style.borderLeft = '4px solid #00f5d4';
  }

  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 4500);
}
