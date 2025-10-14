const logger = require('../utils/logger');
const crypto = require('crypto');

/**
 * Service for detecting and analyzing changes in case data
 */
class ChangeDetectionService {
  constructor() {
    this.significantFields = [
      'caseStatus',
      'nextHearingDate',
      'firstHearingDate',
      'stageOfCase',
      'coram',
      'orderDetails',
      'listingHistory',
      'iaApplications'
    ];
    
    this.criticalFields = [
      'caseStatus',
      'nextHearingDate',
      'stageOfCase'
    ];
  }

  /**
   * Detect changes between old and new case data
   * @param {Object} oldCaseData - Previous case data
   * @param {Object} newCaseData - New case data from API
   * @returns {Object} Change detection result
   */
  detectChanges(oldCaseData, newCaseData) {
    try {
      const changes = {
        hasChanges: false,
        hasCriticalChanges: false,
        changedFields: [],
        criticalChanges: [],
        detailedChanges: {},
        changesSummary: '',
        notificationPriority: 'low'
      };

      // Compare each significant field
      for (const field of this.significantFields) {
        const fieldChange = this.compareField(field, oldCaseData[field], newCaseData[field]);
        
        if (fieldChange.hasChange) {
          changes.hasChanges = true;
          changes.changedFields.push(field);
          changes.detailedChanges[field] = fieldChange;

          // Check if this is a critical change
          if (this.criticalFields.includes(field)) {
            changes.hasCriticalChanges = true;
            changes.criticalChanges.push(field);
          }
        }
      }

      // Set notification priority based on changes
      changes.notificationPriority = this.determineNotificationPriority(changes);
      
      // Generate changes summary
      changes.changesSummary = this.generateChangesSummary(changes);

      // Generate new data hash
      changes.newDataHash = this.generateDataHash(newCaseData);
      changes.oldDataHash = oldCaseData.dataHash || this.generateDataHash(oldCaseData);

      logger.info(`Change detection completed for case. Changes found: ${changes.hasChanges}`);
      return changes;

    } catch (error) {
      logger.error('Error in change detection:', error.message);
      throw error;
    }
  }

  /**
   * Compare individual field values
   * @param {string} fieldName - Name of the field
   * @param {*} oldValue - Old field value
   * @param {*} newValue - New field value
   * @returns {Object} Field comparison result
   */
  compareField(fieldName, oldValue, newValue) {
    const result = {
      hasChange: false,
      oldValue: oldValue,
      newValue: newValue,
      changeType: null,
      description: ''
    };

    // Handle null/undefined values
    if (oldValue === null || oldValue === undefined) {
      oldValue = '';
    }
    if (newValue === null || newValue === undefined) {
      newValue = '';
    }

    // Special handling for different field types
    switch (fieldName) {
      case 'nextHearingDate':
      case 'firstHearingDate':
        result.hasChange = this.compareDates(oldValue, newValue);
        if (result.hasChange) {
          result.changeType = 'date_change';
          result.description = `${fieldName} changed from ${this.formatDate(oldValue)} to ${this.formatDate(newValue)}`;
        }
        break;

      case 'listingHistory':
        result.hasChange = this.compareArrays(oldValue, newValue);
        if (result.hasChange) {
          result.changeType = 'array_change';
          result.description = `New entries added to listing history`;
        }
        break;

      case 'iaApplications':
        result.hasChange = this.compareArrays(oldValue, newValue);
        if (result.hasChange) {
          result.changeType = 'array_change';
          result.description = `IA applications updated`;
        }
        break;

      case 'caseStatus':
      case 'stageOfCase':
      case 'coram':
        result.hasChange = this.compareStrings(oldValue, newValue);
        if (result.hasChange) {
          result.changeType = 'status_change';
          result.description = `${fieldName} changed from "${oldValue}" to "${newValue}"`;
        }
        break;

      default:
        result.hasChange = this.compareStrings(oldValue, newValue);
        if (result.hasChange) {
          result.changeType = 'general_change';
          result.description = `${fieldName} has been updated`;
        }
        break;
    }

    return result;
  }

  /**
   * Compare date values
   * @param {Date|string} oldDate - Old date
   * @param {Date|string} newDate - New date
   * @returns {boolean} True if dates are different
   */
  compareDates(oldDate, newDate) {
    const old = this.normalizeDate(oldDate);
    const newD = this.normalizeDate(newDate);
    
    if (!old && !newD) return false;
    if (!old || !newD) return true;
    
    return old.getTime() !== newD.getTime();
  }

  /**
   * Compare string values (case-insensitive, trimmed)
   * @param {string} oldStr - Old string
   * @param {string} newStr - New string
   * @returns {boolean} True if strings are different
   */
  compareStrings(oldStr, newStr) {
    const old = (oldStr || '').toString().trim().toLowerCase();
    const newS = (newStr || '').toString().trim().toLowerCase();
    return old !== newS;
  }

  /**
   * Compare array values
   * @param {Array} oldArray - Old array
   * @param {Array} newArray - New array
   * @returns {boolean} True if arrays are different
   */
  compareArrays(oldArray, newArray) {
    if (!Array.isArray(oldArray)) oldArray = [];
    if (!Array.isArray(newArray)) newArray = [];
    
    if (oldArray.length !== newArray.length) return true;
    
    // For listing history and IA applications, we mainly care about new entries
    return newArray.length > oldArray.length;
  }

  /**
   * Normalize date to Date object
   * @param {Date|string} date - Date to normalize
   * @returns {Date|null} Normalized date
   */
  normalizeDate(date) {
    if (!date) return null;
    if (date instanceof Date) return date;
    
    try {
      const parsed = new Date(date);
      return isNaN(parsed.getTime()) ? null : parsed;
    } catch (error) {
      return null;
    }
  }

  /**
   * Format date for display
   * @param {Date|string} date - Date to format
   * @returns {string} Formatted date string
   */
  formatDate(date) {
    const normalized = this.normalizeDate(date);
    if (!normalized) return 'Not set';
    
    return normalized.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  /**
   * Determine notification priority based on changes
   * @param {Object} changes - Changes object
   * @returns {string} Priority level
   */
  determineNotificationPriority(changes) {
    if (!changes.hasChanges) return 'none';
    
    if (changes.hasCriticalChanges) {
      // Check for specific critical scenarios
      if (changes.criticalChanges.includes('nextHearingDate')) {
        return 'urgent';
      }
      if (changes.criticalChanges.includes('caseStatus')) {
        return 'high';
      }
      return 'high';
    }
    
    if (changes.changedFields.includes('listingHistory')) {
      return 'medium';
    }
    
    return 'low';
  }

  /**
   * Generate human-readable changes summary
   * @param {Object} changes - Changes object
   * @returns {string} Summary text
   */
  generateChangesSummary(changes) {
    if (!changes.hasChanges) {
      return 'No changes detected';
    }

    const summaryParts = [];
    
    // Critical changes first
    if (changes.hasCriticalChanges) {
      for (const field of changes.criticalChanges) {
        const change = changes.detailedChanges[field];
        summaryParts.push(`🔴 ${change.description}`);
      }
    }

    // Other significant changes
    for (const field of changes.changedFields) {
      if (!changes.criticalChanges.includes(field)) {
        const change = changes.detailedChanges[field];
        summaryParts.push(`🔵 ${change.description}`);
      }
    }

    return summaryParts.join('\n');
  }

  /**
   * Generate data hash for change detection
   * @param {Object} caseData - Case data object
   * @returns {string} MD5 hash
   */
  generateDataHash(caseData) {
    try {
      // Create a normalized object with only significant fields
      const normalizedData = {};
      
      for (const field of this.significantFields) {
        let value = caseData[field];
        
        // Normalize different data types
        if (value instanceof Date) {
          value = value.toISOString();
        } else if (Array.isArray(value)) {
          value = value.map(item => 
            typeof item === 'object' ? JSON.stringify(item) : item
          ).sort();
        } else if (typeof value === 'string') {
          value = value.trim().toLowerCase();
        }
        
        normalizedData[field] = value;
      }

      const dataString = JSON.stringify(normalizedData, Object.keys(normalizedData).sort());
      return crypto.createHash('md5').update(dataString).digest('hex');
      
    } catch (error) {
      logger.error('Error generating data hash:', error.message);
      return '';
    }
  }

  /**
   * Check if changes warrant immediate notification
   * @param {Object} changes - Changes object
   * @returns {boolean} True if immediate notification needed
   */
  requiresImmediateNotification(changes) {
    return changes.notificationPriority === 'urgent' || 
           changes.notificationPriority === 'high';
  }

  /**
   * Get notification delay based on priority
   * @param {string} priority - Notification priority
   * @returns {number} Delay in minutes
   */
  getNotificationDelay(priority) {
    const delays = {
      'urgent': 0,      // Immediate
      'high': 5,        // 5 minutes
      'medium': 30,     // 30 minutes
      'low': 120,       // 2 hours
      'none': 0
    };
    
    return delays[priority] || 0;
  }

  /**
   * Validate change detection input
   * @param {Object} oldData - Old case data
   * @param {Object} newData - New case data
   * @returns {boolean} True if input is valid
   */
  validateInput(oldData, newData) {
    if (!oldData || !newData) {
      logger.warn('Invalid input for change detection: missing data');
      return false;
    }

    if (typeof oldData !== 'object' || typeof newData !== 'object') {
      logger.warn('Invalid input for change detection: data must be objects');
      return false;
    }

    return true;
  }
}

module.exports = ChangeDetectionService;