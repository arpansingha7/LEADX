/**
 * Computes the lead score (0-100) dynamically using weights.
 * @param {object} lead The lead object containing source, created_at, and raw_data
 * @param {object} weights The weights configuration object
 * @returns {number} The rounded lead score (0-100)
 */
export function computeLeadScore(lead, weights) {
  const rawData = lead.raw_data || {};
  const campaignName = lead.campaign_name || '';
  const nameLower = campaignName.toLowerCase();

  // Determine industry
  let industry = 'General';
  if (nameLower.includes('real estate') || nameLower.includes('realestate') || nameLower.includes('property') || nameLower.includes('home') || nameLower.includes('housing') ||
      rawData.budget !== undefined || rawData.property_type !== undefined || rawData.location_preference !== undefined) {
    industry = 'Real Estate';
  } else if (nameLower.includes('bfsi') || nameLower.includes('bank') || nameLower.includes('loan') || nameLower.includes('gold loan') || nameLower.includes('credit') || nameLower.includes('finance') ||
             rawData.monthly_income !== undefined || rawData.credit_score !== undefined || rawData.loan_amount !== undefined) {
    industry = 'BFSI';
  } else if (nameLower.includes('education') || nameLower.includes('course') || nameLower.includes('college') || nameLower.includes('school') || nameLower.includes('enrollment') ||
             rawData.course_interest !== undefined || rawData.qualification !== undefined) {
    industry = 'Education';
  }

  // Get active demographic factor keys for this industry
  let demoKeys = [];
  if (industry === 'Real Estate') {
    demoKeys = ['budget', 'property_type', 'location_preference'];
  } else if (industry === 'BFSI') {
    demoKeys = ['monthly_income', 'credit_score', 'loan_amount'];
  } else if (industry === 'Education') {
    demoKeys = ['course_interest', 'qualification'];
  }

  // Check if we have individual factor weights configured
  const hasIndividualWeights = demoKeys.some(key => weights[key] !== undefined && weights[key] !== null);

  let demographicFitWeightedScore = 0;
  let useFallbackdemographicFit = !hasIndividualWeights;

  if (hasIndividualWeights) {
    const W_demo = demoKeys.reduce((sum, key) => sum + (weights[key] ?? 0), 0);
    let demoWeightedScoreSum = 0;
    let W_present = 0;

    demoKeys.forEach(key => {
      if (rawData[key] !== undefined && rawData[key] !== null && weights[key] !== undefined) {
        let score = 70; // default baseline
        if (key === 'monthly_income') {
          const inc = Number(rawData.monthly_income);
          score = inc >= 85000 ? 100 : inc >= 45000 ? 80 : 50;
        } else if (key === 'credit_score') {
          const cs = Number(rawData.credit_score);
          score = cs >= 750 ? 100 : cs >= 650 ? 75 : 40;
        } else if (key === 'loan_amount') {
          const la = Number(rawData.loan_amount);
          score = la >= 100000 && la <= 1500000 ? 100 : 70;
        } else if (key === 'budget') {
          const b = Number(rawData.budget);
          score = b >= 5000000 ? 100 : b >= 2500000 ? 80 : 50;
        } else if (key === 'property_type') {
          const pt = String(rawData.property_type).toLowerCase();
          score = pt.includes('2bhk') || pt.includes('3bhk') || pt.includes('2 bhk') || pt.includes('3 bhk') ? 100 : 70;
        } else if (key === 'location_preference') {
          const loc = String(rawData.location_preference).toLowerCase();
          score = loc.includes('center') || loc.includes('mumbai') || loc.includes('pune') ? 100 : 70;
        } else if (key === 'course_interest') {
          score = 100;
        } else if (key === 'qualification') {
          const q = String(rawData.qualification).toLowerCase();
          score = q.includes('graduate') || q.includes('bachelor') || q.includes('degree') ? 100 : 70;
        }
        
        demoWeightedScoreSum += score * weights[key];
        W_present += weights[key];
      }
    });

    demographicFitWeightedScore = W_present > 0 ? (demoWeightedScoreSum * (W_demo / W_present)) : 0;
  }

  // 1. Demographic Fit fallback calculation (if no individual weights are configured)
  let demographicFitSubscore = 70;
  if (useFallbackdemographicFit) {
    const subscores = [];

    // BFSI parameters
    if (rawData.monthly_income !== undefined && rawData.monthly_income !== null) {
      const inc = Number(rawData.monthly_income);
      subscores.push(inc >= 85000 ? 100 : inc >= 45000 ? 80 : 50);
    }
    if (rawData.credit_score !== undefined && rawData.credit_score !== null) {
      const cs = Number(rawData.credit_score);
      subscores.push(cs >= 750 ? 100 : cs >= 650 ? 75 : 40);
    }
    if (rawData.loan_amount !== undefined && rawData.loan_amount !== null) {
      const la = Number(rawData.loan_amount);
      subscores.push(la >= 100000 && la <= 1500000 ? 100 : 70);
    }

    // Real Estate parameters
    if (rawData.budget !== undefined && rawData.budget !== null) {
      const b = Number(rawData.budget);
      subscores.push(b >= 5000000 ? 100 : b >= 2500000 ? 80 : 50);
    }
    if (rawData.property_type !== undefined && rawData.property_type !== null) {
      const pt = String(rawData.property_type).toLowerCase();
      subscores.push(pt.includes('2bhk') || pt.includes('3bhk') || pt.includes('2 bhk') || pt.includes('3 bhk') ? 100 : 70);
    }
    if (rawData.location_preference !== undefined && rawData.location_preference !== null) {
      const loc = String(rawData.location_preference).toLowerCase();
      subscores.push(loc.includes('center') || loc.includes('mumbai') || loc.includes('pune') ? 100 : 70);
    }

    // Education parameters
    if (rawData.course_interest !== undefined && rawData.course_interest !== null) {
      subscores.push(100);
    }
    if (rawData.qualification !== undefined && rawData.qualification !== null) {
      const q = String(rawData.qualification).toLowerCase();
      subscores.push(q.includes('graduate') || q.includes('bachelor') || q.includes('degree') ? 100 : 70);
    }

    // Fallback defaults if no industry-specific parameters were matched
    if (subscores.length === 0) {
      let ageScore = 70;
      if (rawData.age !== undefined && rawData.age !== null) {
        const age = Number(rawData.age);
        if (age >= 21 && age <= 35) ageScore = 100;
        else if (age >= 18 && age <= 45) ageScore = 70;
        else ageScore = 40;
      }

      let cityScore = 70;
      if (rawData.city) {
        const tier1Cities = ['mumbai', 'delhi', 'bangalore', 'hyderabad', 'chennai', 'pune', 'kolkata', 'ahmedabad'];
        const city = rawData.city.trim().toLowerCase();
        if (tier1Cities.includes(city)) {
          cityScore = 100;
        } else if (city.includes('tier 2') || city.includes('tier2')) {
          cityScore = 70;
        } else {
          cityScore = 40;
        }
      }

      let incomeScore = 70;
      if (rawData.income !== undefined && rawData.income !== null) {
        const income = Number(rawData.income);
        if (income >= 500000) incomeScore = 100;
        else if (income >= 300000) incomeScore = 75;
        else incomeScore = 45;
      }

      subscores.push((ageScore + cityScore + incomeScore) / 3);
    }

    demographicFitSubscore = subscores.reduce((a, b) => a + b, 0) / subscores.length;
  }

  // 2. Source Quality (0-100)
  let sourceQualitySubscore = 50;
  if (lead.source) {
    const source = lead.source.trim().toLowerCase();
    if (source === 'referral') sourceQualitySubscore = 100;
    else if (source === 'organic') sourceQualitySubscore = 85;
    else if (source === 're-engagement') sourceQualitySubscore = 75;
    else if (source === 'paid_ads' || source === 'paid-ads') sourceQualitySubscore = 60;
    else sourceQualitySubscore = 50;
  }

  // 3. Recency (0-100)
  let recencySubscore = 85;
  let minutesSinceSubmission = rawData.minutes_since_submission;

  if (minutesSinceSubmission === undefined && lead.created_at) {
    const createdTime = new Date(lead.created_at).getTime();
    const now = new Date().getTime();
    minutesSinceSubmission = Math.max(0, (now - createdTime) / (1000 * 60));
  }

  if (minutesSinceSubmission !== undefined && minutesSinceSubmission !== null) {
    const mins = Number(minutesSinceSubmission);
    if (mins <= 15) recencySubscore = 100;
    else if (mins <= 60) recencySubscore = 85;
    else if (mins <= 1440) recencySubscore = 60; // 24 hours
    else recencySubscore = 40;
  }

  // 4. Behavioural Signals (0-100)
  let behavioralSubscore = 30;
  let pagePoints = 0;
  if (rawData.pages_visited !== undefined && rawData.pages_visited !== null) {
    pagePoints = Math.min(50, Number(rawData.pages_visited) * 10);
  }
  const videoPoints = (rawData.video_watched === true || rawData.video_watched === 'true' || Number(rawData.video_watched) > 0) ? 30 : 0;
  const coursePoints = (rawData.course_viewed === true || rawData.course_viewed === 'true' || rawData.product_viewed === true) ? 20 : 0;
  behavioralSubscore = pagePoints + videoPoints + coursePoints;
  if (behavioralSubscore === 0) {
    behavioralSubscore = 30; // default baseline
  }
  behavioralSubscore = Math.min(100, behavioralSubscore);

  // 5. Prior Interaction Outcome (0-100)
  let priorInteractionSubscore = 50;
  const priorOutcome = rawData.prior_outcome || lead.status;
  if (priorOutcome) {
    const outcome = priorOutcome.trim().toLowerCase();
    if (outcome === 'callback_requested' || outcome === 'callback') priorInteractionSubscore = 100;
    else if (outcome === 'interested' || outcome === 'converted') priorInteractionSubscore = 95;
    else if (outcome === 'no_answer' || outcome === 'no_response' || outcome === 'not_reachable') priorInteractionSubscore = 30;
    else if (outcome === 'not_interested' || outcome === 'rejected') priorInteractionSubscore = 10;
    else priorInteractionSubscore = 50;
  }

  // Weighted Sum Calculation
  const totalScore = 
    (useFallbackdemographicFit ? (demographicFitSubscore * (weights.demographic_fit ?? 0.25)) : demographicFitWeightedScore) +
    (sourceQualitySubscore * (weights.source_quality ?? (hasIndividualWeights ? 0 : 0.25))) +
    (recencySubscore * (weights.recency ?? (hasIndividualWeights ? 0 : 0.20))) +
    (behavioralSubscore * (weights.behavioural_signals ?? (hasIndividualWeights ? 0 : 0.15))) +
    (priorInteractionSubscore * (weights.prior_interaction ?? (hasIndividualWeights ? 0 : 0.15)));

  // Ensure score is bounded between 0 and 100 and rounded
  return Math.max(0, Math.min(100, Math.round(totalScore)));
}
