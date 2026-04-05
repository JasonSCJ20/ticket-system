// Import XSS sanitization library
import xss from 'xss';

// Function to sanitize string input
export function sanitizeString(value) {
  // Return non-string values as-is
  if (typeof value !== 'string') return value;
  // Trim whitespace
  let cleaned = value.trim();
  // Sanitize against XSS
  cleaned = xss(cleaned);
  // Throw error if result is empty
  if (cleaned.length === 0) throw new Error('Invalid input string');
  // Return cleaned string
  return cleaned;
}

// Function to validate priority values
export function validatePriority(priority) {
  // Define allowed priorities
  const allowed = ['low', 'medium', 'high', 'critical'];
  // Convert to lowercase string
  const p = String(priority).toLowerCase();
  // Throw error if not allowed
  if (!allowed.includes(p)) throw new Error('Invalid priority');
  // Return validated priority
  return p;
}
