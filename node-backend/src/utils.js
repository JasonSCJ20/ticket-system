/**
 * Utility functions for common backend operations
 * Reduces duplication across route handlers and services
 */

import { HTTP_STATUS, ERROR_MESSAGES } from './constants.js';

// ============================================================================
// RESPONSE HELPERS
// ============================================================================

/**
 * Send a successful JSON response
 * @param {Response} res - Express response object
 * @param {*} data - Data to return
 * @param {number} statusCode - HTTP status code (default: 200)
 */
export const sendSuccess = (res, data, statusCode = HTTP_STATUS.OK) => {
  res.status(statusCode).json(data);
};

/**
 * Send an error response
 * @param {Response} res - Express response object
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code (default: 400)
 * @param {*} details - Additional error details
 */
export const sendError = (res, message, statusCode = HTTP_STATUS.BAD_REQUEST, details = null) => {
  const response = { error: message };
  if (details) response.details = details;
  res.status(statusCode).json(response);
};

/**
 * Send a not found response
 * @param {Response} res - Express response object
 * @param {string} resource - Resource type (e.g., 'Ticket', 'User')
 */
export const sendNotFound = (res, resource = 'Resource') => {
  sendError(res, `${resource} not found`, HTTP_STATUS.NOT_FOUND);
};

/**
 * Send an unauthorized response
 * @param {Response} res - Express response object
 */
export const sendUnauthorized = (res) => {
  sendError(res, ERROR_MESSAGES.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
};

/**
 * Send a forbidden response
 * @param {Response} res - Express response object
 */
export const sendForbidden = (res) => {
  sendError(res, ERROR_MESSAGES.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
};

/**
 * Send validation error response
 * @param {Response} res - Express response object
 * @param {*} errors - Validation errors from express-validator
 */
export const sendValidationError = (res, errors) => {
  const errorDetails = errors.array().map((err) => ({
    field: err.param,
    message: err.msg,
  }));
  sendError(res, ERROR_MESSAGES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST, errorDetails);
};

// ============================================================================
// QUERY HELPERS
// ============================================================================

/**
 * Build a standard 'where' clause for Sequelize queries
 * @param {*} model - Sequelize model
 * @param {string} field - Field name
 * @param {*} value - Field value
 * @param {object} Op - Sequelize operators
 * @returns {object} where clause
 */
export const buildWhereClause = (field, value, Op = null) => {
  if (!value) return {};
  return { [field]: value };
};

/**
 * Build pagination options for queries
 * @param {number} page - Page number (1-indexed)
 * @param {number} pageSize - Items per page
 * @returns {object} limit and offset for Sequelize
 */
export const getPaginationOptions = (page = 1, pageSize = 100) => {
  const validPage = Math.max(1, parseInt(page) || 1);
  const validSize = Math.min(1000, Math.max(1, parseInt(pageSize) || 100));
  return {
    limit: validSize,
    offset: (validPage - 1) * validSize,
  };
};

// ============================================================================
// DATABASE HELPERS
// ============================================================================

/**
 * Execute a database operation with error handling
 * @param {Function} operation - Async function to execute
 * @param {string} friendlyName - Name for error messages
 * @returns {Promise<*>} Result of operation or null on error
 */
export const executeDbOperation = async (operation, friendlyName = 'Database operation') => {
  try {
    return await operation();
  } catch (err) {
    console.error(`${friendlyName} failed:`, err.message);
    return null;
  }
};

/**
 * Find or create a record in database
 * @param {*} model - Sequelize model
 * @param {object} where - Where clause for finding
 * @param {object} defaults - Default values for creation
 * @returns {Promise<[*, boolean]>} [instance, wasCreated]
 */
export const findOrCreateRecord = async (model, where, defaults = {}) => {
  return executeDbOperation(
    () => model.findOrCreate({ where, defaults }),
    `findOrCreate on ${model.name || 'model'}`
  );
};

/**
 * Get a single record or return null
 * @param {*} model - Sequelize model
 * @param {object} options - Sequelize query options
 * @returns {Promise<*|null>} Model instance or null
 */
export const getOrNull = async (model, options) => {
  return executeDbOperation(
    () => model.findOne(options),
    `findOne on ${model.name || 'model'}`
  );
};

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate an email address
 * @param {string} email - Email to validate
 * @returns {boolean}
 */
export const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate SCJ ID format
 * @param {string} scjId - SCJ ID to validate
 * @returns {boolean}
 */
export const isValidScjId = (scjId) => {
  const scjRegex = /^\d{8}-\d{5}$/;
  return scjRegex.test(scjId);
};

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {object} { isValid: boolean, message: string }
 */
export const validatePassword = (password) => {
  if (!password || password.length < 12) {
    return { isValid: false, message: 'Password must be at least 12 characters' };
  }
  if (!/[a-z]/.test(password)) {
    return { isValid: false, message: 'Password must contain lowercase letters' };
  }
  if (!/[A-Z]/.test(password)) {
    return { isValid: false, message: 'Password must contain uppercase letters' };
  }
  if (!/[0-9]/.test(password)) {
    return { isValid: false, message: 'Password must contain numbers' };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { isValid: false, message: 'Password must contain special characters' };
  }
  return { isValid: true, message: 'Password is valid' };
};

// ============================================================================
// LOGGING HELPERS
// ============================================================================

/**
 * Format and log API request info
 * @param {Request} req - Express request object
 * @param {string} action - Action being performed
 */
export const logApiCall = (req, action) => {
  const user = req.user?.username || 'anonymous';
  const path = req.path;
  const method = req.method;
  console.log(`[${method}] ${path} - ${action} - User: ${user}`);
};

/**
 * Log error with context
 * @param {Error} err - Error object
 * @param {string} context - Context description
 * @param {object} additional - Additional info to log
 */
export const logError = (err, context, additional = {}) => {
  console.error(`ERROR [${context}]:`, {
    message: err.message,
    stack: err.stack,
    ...additional,
  });
};

// ============================================================================
// OBJECT HELPERS
// ============================================================================

/**
 * Deep clone an object (safe for most use cases)
 * @param {*} obj - Object to clone
 * @returns {*}
 */
export const deepClone = (obj) => {
  return JSON.parse(JSON.stringify(obj));
};

/**
 * Omit specified keys from object
 * @param {object} obj - Object to process
 * @param {string[]} keysToOmit - Keys to remove
 * @returns {object}
 */
export const omitKeys = (obj, keysToOmit) => {
  const result = { ...obj };
  keysToOmit.forEach((key) => delete result[key]);
  return result;
};

/**
 * Pick specified keys from object
 * @param {object} obj - Object to process
 * @param {string[]} keysToPick - Keys to keep
 * @returns {object}
 */
export const pickKeys = (obj, keysToPick) => {
  const result = {};
  keysToPick.forEach((key) => {
    if (key in obj) result[key] = obj[key];
  });
  return result;
};

// ============================================================================
// ASYNC HELPERS
// ============================================================================

/**
 * Execute multiple operations in parallel with batching awareness
 * @param {Function[]} operations - Array of async functions
 * @param {number} batchSize - Max concurrent operations
 * @returns {Promise<*[]>}
 */
export const executeBatched = async (operations, batchSize = 5) => {
  const results = [];
  for (let i = 0; i < operations.length; i += batchSize) {
    const batch = operations.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((op) => op()));
    results.push(...batchResults);
  }
  return results;
};

/**
 * Retry an async operation with exponential backoff
 * @param {Function} operation - Async function to retry
 * @param {number} maxAttempts - Max number of attempts
 * @param {number} delayMs - Initial delay in milliseconds
 * @returns {Promise<*>}
 */
export const retryWithBackoff = async (operation, maxAttempts = 3, delayMs = 100) => {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delay = delayMs * Math.pow(2, attempt - 1); // Exponential backoff
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
};

// ============================================================================
// AUDIT HELPERS
// ============================================================================

/**
 * Build standardized audit log entry
 * @param {Request} req - Express request object
 * @param {object} details - Audit details
 * @returns {object} Standardized audit entry
 */
export const buildAuditEntry = (req, details) => {
  return {
    userId: req.user?.id || null,
    userName: req.user?.username || 'system',
    action: details.action,
    entityType: details.entityType,
    entityId: details.entityId,
    details: details.details || null,
    timestamp: new Date(),
    ipAddress: req.ip || req.connection.remoteAddress,
  };
};

export default {
  sendSuccess,
  sendError,
  sendNotFound,
  sendUnauthorized,
  sendForbidden,
  sendValidationError,
  buildWhereClause,
  getPaginationOptions,
  executeDbOperation,
  findOrCreateRecord,
  getOrNull,
  isValidEmail,
  isValidScjId,
  validatePassword,
  logApiCall,
  logError,
  deepClone,
  omitKeys,
  pickKeys,
  executeBatched,
  retryWithBackoff,
  buildAuditEntry,
};
