/**
 * Validates a single lead's fields during ingestion.
 * @param {object} lead The lead data object
 * @returns {object} { isValid: boolean, errors: string[] }
 */
export function validateLead(lead) {
  const errors = [];

  if (!lead) {
    return { isValid: false, errors: ['Lead payload is required'] };
  }

  // tenant_id validation
  if (!lead.tenant_id || typeof lead.tenant_id !== 'string' || lead.tenant_id.trim() === '') {
    errors.push('tenant_id is required and must be a non-empty string');
  }

  // phone validation
  if (!lead.phone || typeof lead.phone !== 'string' || lead.phone.trim() === '') {
    errors.push('phone is required and must be a non-empty string');
  } else {
    const cleanedPhone = cleanPhone(lead.phone);
    if (cleanedPhone.length < 8 || cleanedPhone.length > 15) {
      errors.push('phone must contain between 8 and 15 digits');
    }
  }

  // source validation
  if (!lead.source || typeof lead.source !== 'string' || lead.source.trim() === '') {
    errors.push('source is required and must be a non-empty string');
  }

  // email validation (optional)
  if (lead.email) {
    if (typeof lead.email !== 'string') {
      errors.push('email must be a string');
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(lead.email.trim())) {
        errors.push('email is invalid');
      }
    }
  }

  // name validation (optional)
  if (lead.name !== undefined && lead.name !== null && typeof lead.name !== 'string') {
    errors.push('name must be a string');
  }

  // raw_data validation (optional)
  if (lead.raw_data !== undefined && lead.raw_data !== null && (typeof lead.raw_data !== 'object' || Array.isArray(lead.raw_data))) {
    errors.push('raw_data must be a JSON object');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Cleans phone number by removing spaces, dashes, parentheses and keeping only digits and a possible leading +
 * @param {string} phone
 * @returns {string}
 */
export function cleanPhone(phone) {
  if (!phone) return '';
  // Keep digits and leading plus sign
  const cleaned = phone.replace(/[^\d+]/g, '');
  // If there's a + it should only be at the beginning
  if (cleaned.startsWith('+')) {
    return '+' + cleaned.substring(1).replace(/\+/g, '');
  }
  return cleaned.replace(/\+/g, '');
}

/**
 * Validates the scoring weights configuration.
 * Weights must sum to 1.0 ± 0.001 and none can be negative.
 * @param {object} weights
 * @returns {object} { isValid: boolean, errors: string[] }
 */
export function validateScoringWeights(weights) {
  const errors = [];
  const requiredKeys = [
    'demographic_fit',
    'source_quality',
    'recency',
    'behavioural_signals',
    'prior_interaction'
  ];

  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) {
    return { isValid: false, errors: ['Weights configuration must be an object'] };
  }

  // Check required weight keys
  for (const key of requiredKeys) {
    if (weights[key] === undefined || weights[key] === null) {
      errors.push(`Weight field '${key}' is required`);
    } else if (typeof weights[key] !== 'number' || isNaN(weights[key])) {
      errors.push(`Weight field '${key}' must be a valid number`);
    } else if (weights[key] < 0 || weights[key] > 1) {
      errors.push(`Weight field '${key}' must be between 0 and 1`);
    }
  }

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  // Verify weights sum to 1.0 +/- 0.001
  const sum = requiredKeys.reduce((acc, key) => acc + weights[key], 0);
  if (Math.abs(sum - 1.0) > 0.001) {
    errors.push(`Scoring weights must sum to 1.0 (got ${sum.toFixed(4)})`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}
