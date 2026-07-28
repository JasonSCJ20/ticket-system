// Pattern-based request inspection. This is a starting ruleset covering the
// most common, highest-signal attack patterns — not a full OWASP Core Rule
// Set reimplementation. Each rule returns null on no match, or a finding
// descriptor on match.

const SQLI_PATTERNS = [
  /(\bunion\b.{0,40}\bselect\b)/i,
  /(\bor\b\s+['"]?1['"]?\s*=\s*['"]?1['"]?)/i,
  /(--|\#|\/\*).{0,5}$/,
  /(\bdrop\b\s+\btable\b)/i,
  /(\bexec(\s|\()\s*(x?p_)?\w+)/i,
  /(;\s*(select|insert|update|delete|drop)\s)/i,
];

const XSS_PATTERNS = [
  /<script[\s>]/i,
  /on(error|load|click|mouseover)\s*=/i,
  /javascript\s*:/i,
  /<img[^>]+src\s*=\s*["']?javascript:/i,
];

const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\/\.\.\//,
  /\.\.%2f/i,
  /\/etc\/passwd/i,
  /\.\.\\\.\.\\/,
];

function scanText(text, patterns) {
  if (!text) return false;
  return patterns.some((pattern) => pattern.test(text));
}

// Inspects a single request's path, query string, and (if already parsed by
// an upstream body-parser) body for known attack signatures. Returns the
// first match — a request rarely needs more than one reason to flag.
export function inspectRequest(req) {
  const path = req.path || req.url || '';
  const query = req.query ? JSON.stringify(req.query) : '';
  const body = req.body ? JSON.stringify(req.body) : '';
  const combined = `${path} ${query} ${body}`;

  if (scanText(combined, SQLI_PATTERNS)) {
    return {
      category: 'intrusion_attempt',
      severity: 'high',
      title: 'Possible SQL injection attempt',
      description: 'Request contained a pattern consistent with SQL injection (e.g. UNION SELECT, tautology, statement chaining).',
    };
  }
  if (scanText(combined, XSS_PATTERNS)) {
    return {
      category: 'intrusion_attempt',
      severity: 'medium',
      title: 'Possible cross-site scripting attempt',
      description: 'Request contained a pattern consistent with XSS (inline script tag, event-handler injection, or a javascript: URI).',
    };
  }
  if (scanText(combined, PATH_TRAVERSAL_PATTERNS)) {
    return {
      category: 'intrusion_attempt',
      severity: 'high',
      title: 'Possible path traversal attempt',
      description: 'Request path contained a pattern consistent with directory traversal.',
    };
  }
  return null;
}
