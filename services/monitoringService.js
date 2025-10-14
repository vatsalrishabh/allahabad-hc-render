const cron = require('node-cron');
const apiService = require('./apiService');
const ChangeDetectionService = require('./changeDetectionService');
const whatsappService = require('./whatsappService');
const logger = require('../utils/logger');

// Import models
const Case = require('../models/Case');
const User = require('../models/User');
const UserCase = require('../models/UserCase');

/**
 * Optimized monitoring service for Allahabad High Court case updates
 */
class MonitoringService {
  constructor() {
    this.apiService = apiService;
    this.changeDetectionService = new ChangeDetectionService();
    this.jobs = new Map();
    this.isRunning = false;
    this.lastRunTime = null;
    this.lastRunStatus = null;
    this.runCount = 0;
    this.errorCount = 0;
    this.batchSize = parseInt(process.env.API_BATCH_SIZE) || 5;
    this.apiDelay = parseInt(process.env.API_DELAY_MS) || 2000;
    
    // Default schedule: every 2 hours during business hours
    this.defaultSchedule = process.env.CRON_SCHEDULE || '0 */2 9-18 * * 1-6';
  }

  /**
   * Start the monitoring service
   * @param {string} schedule - Cron schedule expression
   */
  startMonitoring(schedule = this.defaultSchedule) {
    if (this.jobs.has('monitoring')) {
      logger.warn('Monitoring job is already running');
      return;
    }

    const job = cron.schedule(schedule, async () => {
      await this.runMonitoringCycle();
    }, {
      scheduled: false,
      timezone: 'Asia/Kolkata'
    });

    this.jobs.set('monitoring', job);
    job.start();

    logger.info(`Monitoring started with schedule: ${schedule}`);
  }

  /**
   * Stop the monitoring service
   */
  stopMonitoring() {
    const job = this.jobs.get('monitoring');
    if (job) {
      job.stop();
      this.jobs.delete('monitoring');
      logger.info('Monitoring stopped');
    }
  }

  /**
   * Run a complete monitoring cycle
   * @returns {Promise<Object>} Monitoring results
   */
  async runMonitoringCycle() {
    if (this.isRunning) {
      logger.warn('Monitoring cycle already in progress, skipping...');
      return { status: 'skipped', reason: 'already_running' };
    }

    this.isRunning = true;
    this.runCount++;
    const startTime = new Date();
    
    logger.info(`Starting monitoring cycle #${this.runCount}`);

    try {
      // Step 1: Get all cases that need checking
      const casesToCheck = await this.getCasesToCheck();
      
      if (casesToCheck.length === 0) {
        logger.info('No cases to check');
        return { status: 'completed', message: 'No cases to monitor' };
      }

      logger.info(`Found ${casesToCheck.length} cases to check`);

      // Step 2: Fetch data in batches to minimize API load
      const allChanges = [];
      const batches = this.createBatches(casesToCheck, this.batchSize);
      
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        logger.info(`Processing batch ${i + 1}/${batches.length} (${batch.length} cases)`);
        
        const batchChanges = await this.processBatch(batch);
        allChanges.push(...batchChanges);
        
        // Add delay between batches to be respectful to the API
        if (i < batches.length - 1) {
          await this.delay(this.apiDelay);
        }
      }

      // Step 3: Process notifications for changes
      const notificationResults = await this.processNotifications(allChanges);

      // Step 4: Update statistics and log summary
      const summary = this.generateSummary(allChanges, notificationResults);
      this.logCycleSummary(startTime, summary);

      this.lastRunTime = startTime;
      this.lastRunStatus = 'success';

      return {
        status: 'completed',
        changes: allChanges,
        summary: summary,
        notifications: notificationResults,
        duration: Date.now() - startTime.getTime()
      };

    } catch (error) {
      this.errorCount++;
      this.lastRunStatus = 'error';
      logger.error(`Monitoring cycle #${this.runCount} failed:`, error.message);
      
      await this.sendErrorNotification(error);
      
      return {
        status: 'error',
        error: error.message,
        duration: Date.now() - startTime.getTime()
      };
      
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get cases that need to be checked
   * @returns {Promise<Array>} Array of cases to check
   */
  async getCasesToCheck() {
    try {
      // Get cases that haven't been checked recently or have active subscriptions
      const cutoffTime = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      
      const cases = await Case.find({
        $or: [
          { lastApiCheck: { $lt: cutoffTime } },
          { lastApiCheck: { $exists: false } },
          { isActive: true }
        ]
      }).select('cino cnr caseNumber lastApiCheck apiCheckCount');

      // Also get cases that have active user subscriptions
      const activeCinos = await UserCase.distinct('cino', { isActive: true });
      
      const subscribedCases = await Case.find({
        cino: { $in: activeCinos },
        _id: { $nin: cases.map(c => c._id) }
      }).select('cino cnr caseNumber lastApiCheck apiCheckCount');

      return [...cases, ...subscribedCases];
      
    } catch (error) {
      logger.error('Error getting cases to check:', error.message);
      return [];
    }
  }

  /**
   * Create batches from array of cases
   * @param {Array} cases - Array of cases
   * @param {number} batchSize - Size of each batch
   * @returns {Array} Array of batches
   */
  createBatches(cases, batchSize) {
    const batches = [];
    for (let i = 0; i < cases.length; i += batchSize) {
      batches.push(cases.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Process a batch of cases
   * @param {Array} batch - Batch of cases to process
   * @returns {Promise<Array>} Array of changes detected
   */
  async processBatch(batch) {
    const batchChanges = [];
    
    for (const caseDoc of batch) {
      try {
        const changes = await this.processCase(caseDoc);
        if (changes) {
          batchChanges.push(changes);
        }
      } catch (error) {
        logger.error(`Error processing case ${caseDoc.cino}:`, error.message);
      }
    }
    
    return batchChanges;
  }

  /**
   * Process a single case
   * @param {Object} caseDoc - Case document from database
   * @returns {Promise<Object|null>} Changes detected or null
   */
  async processCase(caseDoc) {
    try {
      // Fetch latest data from API
      const newCaseData = await this.apiService.fetchSingleCase(caseDoc.cino);
      
      if (!newCaseData) {
        logger.warn(`No data received for case ${caseDoc.cino}`);
        return null;
      }

      // Update API check statistics
      await Case.findByIdAndUpdate(caseDoc._id, {
        lastApiCheck: new Date(),
        $inc: { apiCheckCount: 1 }
      });

      // Detect changes using our change detection service
      const changeResult = this.changeDetectionService.detectChanges(caseDoc.toObject(), newCaseData);
      
      if (changeResult.hasChanges) {
        // Update case with new data and change history
        const updatedCase = await this.updateCaseWithChanges(caseDoc, newCaseData, changeResult);
        
        return {
          caseId: caseDoc._id,
          cino: caseDoc.cino,
          caseNumber: caseDoc.caseNumber,
          changes: changeResult,
          updatedCase: updatedCase
        };
      }

      return null;
      
    } catch (error) {
      logger.error(`Error processing case ${caseDoc.cino}:`, error.message);
      throw error;
    }
  }

  /**
   * Update case with detected changes
   * @param {Object} caseDoc - Original case document
   * @param {Object} newCaseData - New case data from API
   * @param {Object} changeResult - Change detection result
   * @returns {Promise<Object>} Updated case document
   */
  async updateCaseWithChanges(caseDoc, newCaseData, changeResult) {
    try {
      const updateData = {
        ...newCaseData,
        previousDataHash: caseDoc.dataHash,
        dataHash: changeResult.newDataHash,
        lastUpdated: new Date(),
        $push: {
          changeHistory: {
            timestamp: new Date(),
            changes: changeResult.changedFields,
            summary: changeResult.changesSummary,
            priority: changeResult.notificationPriority
          }
        }
      };

      const updatedCase = await Case.findByIdAndUpdate(
        caseDoc._id,
        updateData,
        { new: true }
      );

      logger.info(`Updated case ${caseDoc.cino} with ${changeResult.changedFields.length} changes`);
      return updatedCase;
      
    } catch (error) {
      logger.error(`Error updating case ${caseDoc.cino}:`, error.message);
      throw error;
    }
  }

  /**
   * Process notifications for all changes
   * @param {Array} allChanges - Array of all changes detected
   * @returns {Promise<Array>} Notification results
   */
  async processNotifications(allChanges) {
    const notificationResults = [];
    
    for (const changeData of allChanges) {
      try {
        // Get users subscribed to this case
        const subscriptions = await UserCase.find({
          cino: changeData.cino,
          isActive: true
        }).populate('userId');

        if (subscriptions.length === 0) {
          logger.info(`No active subscriptions for case ${changeData.cino}`);
          continue;
        }

        // Send personalized notifications
        for (const subscription of subscriptions) {
          const user = subscription.userId;
          if (!user || !user.isActive) continue;

          const notificationResult = await this.sendPersonalizedNotification(
            user,
            subscription,
            changeData
          );
          
          notificationResults.push(notificationResult);
        }

        // Update case notification tracking
        await Case.findByIdAndUpdate(changeData.caseId, {
          lastNotificationSent: new Date(),
          $inc: { notificationCount: subscriptions.length }
        });

      } catch (error) {
        logger.error(`Error processing notifications for case ${changeData.cino}:`, error.message);
      }
    }
    
    return notificationResults;
  }

  /**
   * Send personalized notification to user
   * @param {Object} user - User document
   * @param {Object} subscription - UserCase subscription
   * @param {Object} changeData - Change data
   * @returns {Promise<Object>} Notification result
   */
  async sendPersonalizedNotification(user, subscription, changeData) {
    try {
      const message = this.generatePersonalizedMessage(user, subscription, changeData);
      
      const result = await whatsappService.sendMessage([user.mobileNumber], message);
      
      // Update subscription notification tracking
      await UserCase.findByIdAndUpdate(subscription._id, {
        lastNotificationSent: new Date(),
        $inc: { notificationCount: 1 }
      });

      return {
        userId: user._id,
        mobileNumber: user.mobileNumber,
        cino: changeData.cino,
        success: result.success,
        messageId: result.messageId,
        timestamp: new Date()
      };
      
    } catch (error) {
      logger.error(`Error sending notification to ${user.mobileNumber}:`, error.message);
      return {
        userId: user._id,
        mobileNumber: user.mobileNumber,
        cino: changeData.cino,
        success: false,
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Generate personalized WhatsApp message
   * @param {Object} user - User document
   * @param {Object} subscription - UserCase subscription
   * @param {Object} changeData - Change data
   * @returns {string} Formatted message
   */
  generatePersonalizedMessage(user, subscription, changeData) {
    const changes = changeData.changes;
    const caseAlias = subscription.alias || changeData.caseNumber || changeData.cino;
    const caseData = changeData.updatedCase || {};
    
    let message = `🏛️ *Allahabad High Court Update*\n\n`;
    message += `👋 Hi ${user.name || 'Test User'},\n\n`;
    message += `📋 *Case:* ${caseAlias}\n`;
    message += `🔢 *CINO:* ${changeData.cino}\n\n`;
    
    // Priority indicator
    const priorityEmoji = {
      'urgent': '🚨',
      'high': '🔴',
      'medium': '🟡',
      'low': '🔵'
    };
    
    message += `${priorityEmoji[changes.notificationPriority] || '🔵'} *Priority:* ${changes.notificationPriority.toUpperCase()}\n\n`;
    
    // Changes summary
    message += `📝 *Changes Detected:*\n`;
    message += changes.changesSummary + '\n\n';
    
    // Add detailed case information
    message += this.formatDetailedCaseInfo(caseData);
    
    // Additional details for critical changes
    if (changes.hasCriticalChanges) {
      message += `⚠️ *Important:* This update contains critical changes that may require your immediate attention.\n\n`;
    }
    
    message += `⏰ *Updated:* ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n\n`;
    message += `💡 *Tip:* You can check the full case details on the Allahabad High Court website.\n\n`;
    message += `---\n`;
    message += `🤖 *Allahabad HC Monitor*`;
    
    return message;
  }

  /**
   * Format detailed case information for WhatsApp message
   * @param {Object} caseData - Case data object
   * @returns {string} Formatted case details
   */
  formatDetailedCaseInfo(caseData) {
    if (!caseData) return '';
    
    let details = `\n📊 *COMPREHENSIVE CASE DETAILS:*\n\n`;
    
    // Case Status and Basic Info
    if (caseData.caseStatus) {
      details += `📋 *Case Status:* ${caseData.caseStatus}\n`;
    }
    
    // Case Title
    if (caseData.caseTitle) {
      details += `📝 *Case Title:* ${caseData.caseTitle}\n`;
    }
    
    // CINO (already displayed in header, but can be repeated for completeness)
    if (caseData.cino) {
      details += `🔢 *CINO:* ${caseData.cino}\n`;
    }
    
    // Generation Date
    details += `🕐 *Generated on:* ${new Date().toLocaleDateString('en-IN')} at ${new Date().toLocaleTimeString('en-IN')}\n\n`;
    
    // Filing Information
    if (caseData.filingNumber) {
      details += `📄 *Filing No.:* ${caseData.filingNumber}\n`;
    }
    if (caseData.filingDate) {
      const filingDate = new Date(caseData.filingDate).toLocaleDateString('en-IN');
      details += `📅 *Filing Date:* ${filingDate}\n`;
    }
    
    // CNR and Registration
    if (caseData.cnr) {
      details += `🔢 *CNR:* ${caseData.cnr}\n`;
    }
    if (caseData.registrationDate) {
      const regDate = new Date(caseData.registrationDate).toLocaleDateString('en-IN');
      details += `📋 *Date of Registration:* ${regDate}\n`;
    }
    
    details += `\n`;
    
    // Hearing Information
    if (caseData.firstHearingDate) {
      const firstHearing = new Date(caseData.firstHearingDate).toLocaleDateString('en-IN');
      details += `📅 *First Hearing Date:* ${firstHearing}\n`;
    }
    if (caseData.nextHearingDate) {
      const nextHearing = new Date(caseData.nextHearingDate).toLocaleDateString('en-IN');
      details += `📅 *Next Hearing Date:* ${nextHearing}\n`;
    } else {
      details += `📅 *Next Hearing Date:* Not scheduled\n`;
    }
    
    // Stage and Court Information
    if (caseData.stageOfCase && caseData.stageOfCase.trim()) {
      details += `⚖️ *Stage of Case:* ${caseData.stageOfCase}\n`;
    }
    if (caseData.coram && caseData.coram.trim()) {
      details += `👨‍⚖️ *Coram:* ${caseData.coram}\n`;
    }
    if (caseData.benchType && caseData.benchType.trim()) {
      details += `🏛️ *Bench Type:* ${caseData.benchType}\n`;
    }
    if (caseData.causelistType && caseData.causelistType.trim()) {
      details += `📋 *Causelist Type:* ${caseData.causelistType}\n`;
    }
    
    // Location Information
    if (caseData.state && caseData.state.trim()) {
      details += `🗺️ *State:* ${caseData.state}\n`;
    }
    if (caseData.district && caseData.district.trim()) {
      details += `📍 *District:* ${caseData.district}\n`;
    }
    
    details += `\n`;
    
    // Parties and Advocates
    if ((caseData.petitioners && caseData.petitioners.length > 0) || 
        (caseData.respondents && caseData.respondents.length > 0)) {
      details += `👥 *PETITIONER/RESPONDENT AND ADVOCATES:*\n\n`;
      
      if (caseData.petitioners && caseData.petitioners.length > 0) {
        details += `🔵 *Petitioner(s):*\n`;
        caseData.petitioners.forEach((petitioner, index) => {
          const name = petitioner.name || petitioner;
          details += `${index + 1}. ${name}\n`;
          if (petitioner.advocate && petitioner.advocate.name) {
            details += `   *Advocate:* ${petitioner.advocate.name}`;
            if (petitioner.advocate.code) {
              details += ` (Code: ${petitioner.advocate.code})`;
            }
            details += `\n`;
          }
        });
        details += `\n`;
      }
      
      if (caseData.respondents && caseData.respondents.length > 0) {
        details += `🔴 *Respondent(s):*\n`;
        caseData.respondents.forEach((respondent, index) => {
          const name = respondent.name || respondent;
          details += `${index + 1}. ${name}\n`;
          if (respondent.advocate && respondent.advocate.name) {
            details += `   *Advocate:* ${respondent.advocate.name}`;
            if (respondent.advocate.code) {
              details += ` (Code: ${respondent.advocate.code})`;
            }
            details += `\n`;
          }
        });
        details += `\n`;
      }
    }
    
    // Acts and Sections
    if (caseData.acts && caseData.acts.length > 0) {
      details += `📜 *ACTS:*\n`;
      details += `*Under Act(s)* | *Under Section(s)*\n`;
      caseData.acts.forEach(act => {
        const actName = act.actName || 'N/A';
        const sections = Array.isArray(act.sections) ? act.sections.join(', ') : (act.sections || 'N/A');
        details += `${actName} | ${sections}\n`;
      });
      details += `\n`;
    }
    
    // Category Details - Fixed to use correct structure
    if (caseData.category) {
      details += `📂 *CATEGORY DETAILS:*\n`;
      if (caseData.category.main) {
        details += `*Category:* ${caseData.category.main}\n`;
      }
      if (caseData.category.sub) {
        details += `*Sub Category:* ${caseData.category.sub}\n`;
      }
      details += `\n`;
    }
    
    // High Court / Lower Court Details - Fixed field name
    if (caseData.lowerCourt) {
      details += `🏛️ *HIGH COURT / LOWER COURT DETAILS:*\n`;
      if (caseData.lowerCourt.caseNumber) {
        details += `*Case No.:* ${caseData.lowerCourt.caseNumber}`;
        if (caseData.lowerCourt.year) {
          details += `/${caseData.lowerCourt.year}`;
        }
        details += `\n`;
      }
      if (caseData.lowerCourt.decisionDate) {
        const decisionDate = new Date(caseData.lowerCourt.decisionDate).toLocaleDateString('en-IN');
        details += `*Decision Date:* ${decisionDate}\n`;
      }
      if (caseData.lowerCourt.district) {
        details += `*District:* ${caseData.lowerCourt.district}\n`;
      }
      details += `\n`;
    }
    
    // Crime Details
    if (caseData.crimeDetails) {
      details += `🚔 *CRIME DETAILS:*\n`;
      if (caseData.crimeDetails.district) {
        details += `*District:* ${caseData.crimeDetails.district}\n`;
      }
      if (caseData.crimeDetails.policeStation) {
        details += `*Police Station:* ${caseData.crimeDetails.policeStation}\n`;
      }
      if (caseData.crimeDetails.crimeNumber) {
        details += `*Crime No.:* ${caseData.crimeDetails.crimeNumber}`;
        if (caseData.crimeDetails.year) {
          details += `/${caseData.crimeDetails.year}`;
        }
        details += `\n`;
      }
      details += `\n`;
    }
    
    // IA Applications - Improved formatting
    if (caseData.iaApplications && caseData.iaApplications.length > 0) {
      details += `📋 *IA DETAILS:*\n`;
      details += `*Application Number* | *Classification* | *Party* | *Applied By* | *Filing Date* | *Status*\n`;
      details += `${'─'.repeat(80)}\n`;
      caseData.iaApplications.forEach(ia => {
        const filingDate = ia.filingDate ? new Date(ia.filingDate).toLocaleDateString('en-IN') : 'N/A';
        const appNumber = ia.applicationNumber || 'N/A';
        const classification = ia.classification || 'N/A';
        const party = ia.party || 'N/A';
        const appliedBy = ia.appliedBy || 'N/A';
        const status = ia.status || 'Pending';
        
        details += `${appNumber} | ${classification} | ${party} | ${appliedBy} | ${filingDate} | ${status}\n`;
      });
      details += `\n`;
    }
    
    // Complete Listing History - Improved formatting
    if (caseData.listingHistory && caseData.listingHistory.length > 0) {
      details += `📅 *LISTING HISTORY:*\n`;
      details += `*Cause List Type* | *Hon'ble Justice* | *Listing Date* | *Short Order*\n`;
      details += `${'─'.repeat(80)}\n`;
      caseData.listingHistory.forEach(listing => {
        const listingDate = listing.listingDate ? 
          new Date(listing.listingDate).toLocaleDateString('en-IN') : 'N/A';
        const causeListType = listing.causeListType || 'N/A';
        let justice = listing.justice || 'N/A';
        if (listing.benchId) {
          justice += ` (Bench ID: ${listing.benchId})`;
        }
        const shortOrder = listing.shortOrder || 'N/A';
        
        details += `${causeListType} | ${justice} | ${listingDate} | ${shortOrder}\n`;
      });
      details += `\n`;
    }
    
    // Disclaimer
    details += `⚠️ *Disclaimer:* Status report is based on data available on CCMS servers.\n\n`;
    
    return details;
  }

  /**
   * Generate monitoring summary
   * @param {Array} allChanges - All changes detected
   * @param {Array} notificationResults - Notification results
   * @returns {Object} Summary object
   */
  generateSummary(allChanges, notificationResults) {
    const summary = {
      totalCasesChecked: 0,
      totalChanges: allChanges.length,
      criticalChanges: 0,
      notificationsSent: 0,
      notificationsFailed: 0,
      changesByPriority: {
        urgent: 0,
        high: 0,
        medium: 0,
        low: 0
      }
    };

    // Count changes by priority
    allChanges.forEach(change => {
      const priority = change.changes.notificationPriority;
      if (summary.changesByPriority[priority] !== undefined) {
        summary.changesByPriority[priority]++;
      }
      
      if (change.changes.hasCriticalChanges) {
        summary.criticalChanges++;
      }
    });

    // Count notification results
    notificationResults.forEach(result => {
      if (result.success) {
        summary.notificationsSent++;
      } else {
        summary.notificationsFailed++;
      }
    });

    return summary;
  }

  /**
   * Log cycle summary
   * @param {Date} startTime - Cycle start time
   * @param {Object} summary - Summary object
   */
  logCycleSummary(startTime, summary) {
    const duration = Date.now() - startTime.getTime();
    
    logger.info(`Monitoring cycle #${this.runCount} completed in ${duration}ms`);
    logger.info(`Summary:`);
    logger.info(`- Total changes: ${summary.totalChanges}`);
    logger.info(`- Critical changes: ${summary.criticalChanges}`);
    logger.info(`- Notifications sent: ${summary.notificationsSent}`);
    logger.info(`- Notifications failed: ${summary.notificationsFailed}`);
    logger.info(`- Changes by priority: ${JSON.stringify(summary.changesByPriority)}`);
  }

  /**
   * Send error notification to admin
   * @param {Error} error - Error object
   */
  async sendErrorNotification(error) {
    try {
      const adminNumbers = process.env.ADMIN_WHATSAPP_NUMBERS ? 
        process.env.ADMIN_WHATSAPP_NUMBERS.split(',') : [];
      
      if (adminNumbers.length === 0) return;

      const message = `🚨 *Allahabad HC Monitor Error*\n\n` +
        `⏰ *Time:* ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n` +
        `🔄 *Cycle:* #${this.runCount}\n` +
        `❌ *Error:* ${error.message}\n\n` +
        `Please check the system logs for more details.`;

      for (const adminNumber of adminNumbers) {
        await whatsappService.sendMessage([adminNumber.trim()], message);
      }
      
    } catch (notificationError) {
      logger.error('Failed to send error notification:', notificationError.message);
    }
  }

  /**
   * Delay execution
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise} Promise that resolves after delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get monitoring status
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isScheduled: this.jobs.has('monitoring'),
      lastRunTime: this.lastRunTime,
      lastRunStatus: this.lastRunStatus,
      runCount: this.runCount,
      errorCount: this.errorCount,
      schedule: this.defaultSchedule,
      batchSize: this.batchSize,
      apiDelay: this.apiDelay
    };
  }

  /**
   * Run monitoring cycle manually
   * @returns {Promise<Object>} Cycle results
   */
  async runManually() {
    logger.info('Running monitoring cycle manually...');
    return await this.runMonitoringCycle();
  }

  /**
   * Update monitoring configuration
   * @param {Object} config - Configuration object
   */
  updateConfig(config) {
    if (config.schedule) {
      this.stopMonitoring();
      this.defaultSchedule = config.schedule;
      this.startMonitoring(config.schedule);
    }
    
    if (config.batchSize) {
      this.batchSize = config.batchSize;
    }
    
    if (config.apiDelay) {
      this.apiDelay = config.apiDelay;
    }
    
    logger.info('Monitoring configuration updated:', config);
  }
}

module.exports = new MonitoringService();