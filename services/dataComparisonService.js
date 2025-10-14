const Case = require('../models/Case');
const logger = require('../utils/logger');

class DataComparisonService {
  constructor() {
    this.changeTypes = {
      NEW_CASE: 'NEW_CASE',
      STATUS_CHANGE: 'STATUS_CHANGE',
      HEARING_DATE_CHANGE: 'HEARING_DATE_CHANGE',
      ORDER_UPDATE: 'ORDER_UPDATE',
      GENERAL_UPDATE: 'GENERAL_UPDATE'
    };
  }

  /**
   * Compare new data with existing data and identify changes
   * @param {Array} newCasesData - Array of new case data from API
   * @returns {Promise<Array>} Array of changes detected
   */
  async compareAndDetectChanges(newCasesData) {
    const changes = [];
    
    for (const newCaseData of newCasesData) {
      try {
        const existingCase = await Case.findOne({ caseNumber: newCaseData.caseNumber });
        
        if (!existingCase) {
          // New case detected
          const change = await this.handleNewCase(newCaseData);
          changes.push(change);
        } else {
          // Check for updates in existing case
          const caseChanges = await this.detectCaseChanges(existingCase, newCaseData);
          if (caseChanges.length > 0) {
            changes.push(...caseChanges);
          }
        }
      } catch (error) {
        logger.error(`Error comparing case ${newCaseData.caseNumber}:`, error.message);
      }
    }
    
    return changes;
  }

  /**
   * Handle new case creation
   * @param {Object} newCaseData - New case data
   * @returns {Promise<Object>} Change object
   */
  async handleNewCase(newCaseData) {
    try {
      const newCase = new Case(newCaseData);
      newCase.dataHash = newCase.generateDataHash();
      await newCase.save();
      
      logger.info(`New case added: ${newCaseData.caseNumber}`);
      
      return {
        type: this.changeTypes.NEW_CASE,
        caseNumber: newCaseData.caseNumber,
        caseId: newCase._id,
        message: `New case registered: ${newCaseData.caseNumber}`,
        details: {
          caseTitle: newCaseData.caseTitle,
          caseType: newCaseData.caseType,
          petitioner: newCaseData.petitioner,
          respondent: newCaseData.respondent,
          status: newCaseData.status
        },
        timestamp: new Date()
      };
    } catch (error) {
      logger.error(`Error creating new case ${newCaseData.caseNumber}:`, error.message);
      throw error;
    }
  }

  /**
   * Detect changes in existing case
   * @param {Object} existingCase - Existing case from database
   * @param {Object} newCaseData - New case data from API
   * @returns {Promise<Array>} Array of changes
   */
  async detectCaseChanges(existingCase, newCaseData) {
    const changes = [];
    
    // Generate hash for new data
    const tempCase = new Case(newCaseData);
    const newDataHash = tempCase.generateDataHash();
    
    // If hashes are same, no changes detected
    if (existingCase.dataHash === newDataHash) {
      return changes;
    }
    
    // Detect specific changes
    const specificChanges = this.identifySpecificChanges(existingCase, newCaseData);
    
    // Update the existing case with new data
    await this.updateExistingCase(existingCase, newCaseData, newDataHash);
    
    // Create change objects
    for (const change of specificChanges) {
      changes.push({
        type: change.type,
        caseNumber: existingCase.caseNumber,
        caseId: existingCase._id,
        message: change.message,
        details: change.details,
        oldValue: change.oldValue,
        newValue: change.newValue,
        timestamp: new Date()
      });
    }
    
    return changes;
  }

  /**
   * Identify specific types of changes
   * @param {Object} existingCase - Existing case
   * @param {Object} newCaseData - New case data
   * @returns {Array} Array of specific changes
   */
  identifySpecificChanges(existingCase, newCaseData) {
    const changes = [];
    
    // Status change
    if (existingCase.status !== newCaseData.status) {
      changes.push({
        type: this.changeTypes.STATUS_CHANGE,
        message: `Case status updated for ${existingCase.caseNumber}`,
        details: {
          caseTitle: existingCase.caseTitle,
          oldStatus: existingCase.status,
          newStatus: newCaseData.status
        },
        oldValue: existingCase.status,
        newValue: newCaseData.status
      });
    }
    
    // Next hearing date change
    if (this.compareDates(existingCase.nextHearingDate, newCaseData.nextHearingDate)) {
      changes.push({
        type: this.changeTypes.HEARING_DATE_CHANGE,
        message: `Next hearing date updated for ${existingCase.caseNumber}`,
        details: {
          caseTitle: existingCase.caseTitle,
          oldDate: existingCase.nextHearingDate,
          newDate: newCaseData.nextHearingDate
        },
        oldValue: existingCase.nextHearingDate,
        newValue: newCaseData.nextHearingDate
      });
    }
    
    // Order details change
    if (existingCase.orderDetails !== newCaseData.orderDetails && newCaseData.orderDetails) {
      changes.push({
        type: this.changeTypes.ORDER_UPDATE,
        message: `New order/judgment for ${existingCase.caseNumber}`,
        details: {
          caseTitle: existingCase.caseTitle,
          orderDate: newCaseData.orderDate,
          orderDetails: newCaseData.orderDetails
        },
        oldValue: existingCase.orderDetails,
        newValue: newCaseData.orderDetails
      });
    }
    
    // General updates (other fields)
    const fieldsToCheck = ['caseTitle', 'judge', 'remarks', 'lastHearingDate'];
    for (const field of fieldsToCheck) {
      if (existingCase[field] !== newCaseData[field]) {
        changes.push({
          type: this.changeTypes.GENERAL_UPDATE,
          message: `${field} updated for ${existingCase.caseNumber}`,
          details: {
            caseTitle: existingCase.caseTitle,
            field: field,
            oldValue: existingCase[field],
            newValue: newCaseData[field]
          },
          oldValue: existingCase[field],
          newValue: newCaseData[field]
        });
      }
    }
    
    return changes;
  }

  /**
   * Update existing case with new data
   * @param {Object} existingCase - Existing case
   * @param {Object} newCaseData - New case data
   * @param {string} newDataHash - New data hash
   * @returns {Promise<Object>} Updated case
   */
  async updateExistingCase(existingCase, newCaseData, newDataHash) {
    try {
      const updateData = {
        ...newCaseData,
        dataHash: newDataHash,
        lastUpdated: new Date(),
        isNotified: false // Reset notification flag for new changes
      };
      
      const updatedCase = await Case.findByIdAndUpdate(
        existingCase._id,
        updateData,
        { new: true }
      );
      
      logger.info(`Case updated: ${existingCase.caseNumber}`);
      return updatedCase;
    } catch (error) {
      logger.error(`Error updating case ${existingCase.caseNumber}:`, error.message);
      throw error;
    }
  }

  /**
   * Compare two dates for changes
   * @param {Date} date1 - First date
   * @param {Date} date2 - Second date
   * @returns {boolean} True if dates are different
   */
  compareDates(date1, date2) {
    if (!date1 && !date2) return false;
    if (!date1 || !date2) return true;
    
    return date1.getTime() !== date2.getTime();
  }

  /**
   * Get summary of changes for reporting
   * @param {Array} changes - Array of changes
   * @returns {Object} Summary object
   */
  getChangesSummary(changes) {
    const summary = {
      totalChanges: changes.length,
      newCases: 0,
      statusChanges: 0,
      hearingDateChanges: 0,
      orderUpdates: 0,
      generalUpdates: 0,
      caseNumbers: []
    };
    
    changes.forEach(change => {
      summary.caseNumbers.push(change.caseNumber);
      
      switch (change.type) {
        case this.changeTypes.NEW_CASE:
          summary.newCases++;
          break;
        case this.changeTypes.STATUS_CHANGE:
          summary.statusChanges++;
          break;
        case this.changeTypes.HEARING_DATE_CHANGE:
          summary.hearingDateChanges++;
          break;
        case this.changeTypes.ORDER_UPDATE:
          summary.orderUpdates++;
          break;
        case this.changeTypes.GENERAL_UPDATE:
          summary.generalUpdates++;
          break;
      }
    });
    
    // Remove duplicates from case numbers
    summary.caseNumbers = [...new Set(summary.caseNumbers)];
    
    return summary;
  }

  /**
   * Mark changes as notified
   * @param {Array} changes - Array of changes
   * @returns {Promise<void>}
   */
  async markChangesAsNotified(changes) {
    const caseIds = [...new Set(changes.map(change => change.caseId))];
    
    try {
      await Case.updateMany(
        { _id: { $in: caseIds } },
        { isNotified: true }
      );
      
      logger.info(`Marked ${caseIds.length} cases as notified`);
    } catch (error) {
      logger.error('Error marking cases as notified:', error.message);
      throw error;
    }
  }
}

module.exports = new DataComparisonService();