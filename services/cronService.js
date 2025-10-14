const cron = require('node-cron');
const apiService = require('./apiService');
const dataComparisonService = require('./dataComparisonService');
const whatsappService = require('./whatsappService');
const logger = require('../utils/logger');

class CronService {
  constructor() {
    this.jobs = new Map();
    this.isRunning = false;
    this.lastRunTime = null;
    this.lastRunStatus = null;
    this.runCount = 0;
    this.errorCount = 0;
    
    // Default case numbers to monitor (can be configured via environment)
    this.caseNumbers = process.env.CASE_NUMBERS ? 
      process.env.CASE_NUMBERS.split(',').map(num => num.trim()) : 
      [];
    
    // Default schedule: every 30 minutes during business hours (9 AM to 6 PM)
    this.defaultSchedule = process.env.CRON_SCHEDULE || '*/30 9-18 * * 1-6';
  }

  /**
   * Start the monitoring cron job
   * @param {string} schedule - Cron schedule expression
   * @param {Array} caseNumbers - Array of case numbers to monitor
   */
  startMonitoring(schedule = this.defaultSchedule, caseNumbers = this.caseNumbers) {
    if (this.jobs.has('monitoring')) {
      logger.warn('Monitoring job is already running');
      return;
    }

    if (caseNumbers.length === 0) {
      logger.error('No case numbers provided for monitoring');
      return;
    }

    this.caseNumbers = caseNumbers;

    const job = cron.schedule(schedule, async () => {
      await this.runMonitoringCycle();
    }, {
      scheduled: false,
      timezone: 'Asia/Kolkata'
    });

    this.jobs.set('monitoring', job);
    job.start();

    logger.info(`Monitoring started with schedule: ${schedule}`);
    logger.info(`Monitoring ${caseNumbers.length} cases: ${caseNumbers.join(', ')}`);
  }

  /**
   * Stop the monitoring cron job
   */
  stopMonitoring() {
    const job = this.jobs.get('monitoring');
    if (job) {
      job.stop();
      this.jobs.delete('monitoring');
      logger.info('Monitoring stopped');
    } else {
      logger.warn('No monitoring job to stop');
    }
  }

  /**
   * Run a single monitoring cycle
   * @returns {Promise<Object>} Monitoring cycle results
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
      // Step 1: Fetch latest data from API
      logger.info('Fetching case data from API...');
      const newCasesData = await apiService.fetchCaseData(this.caseNumbers);
      
      if (newCasesData.length === 0) {
        logger.warn('No case data retrieved from API');
        return { status: 'completed', changes: [], message: 'No data retrieved' };
      }

      logger.info(`Retrieved data for ${newCasesData.length} cases`);

      // Step 2: Compare with existing data and detect changes
      logger.info('Comparing data and detecting changes...');
      const changes = await dataComparisonService.compareAndDetectChanges(newCasesData);
      
      logger.info(`Detected ${changes.length} changes`);

      // Step 3: Send notifications if changes found
      let notificationResults = [];
      if (changes.length > 0) {
        logger.info('Sending WhatsApp notifications...');
        notificationResults = await whatsappService.sendNotifications(changes);
        
        // Mark changes as notified
        await dataComparisonService.markChangesAsNotified(changes);
        
        logger.info(`Sent ${notificationResults.length} notifications`);
      }

      // Step 4: Log summary
      const summary = dataComparisonService.getChangesSummary(changes);
      this.logCycleSummary(startTime, summary, notificationResults);

      this.lastRunTime = startTime;
      this.lastRunStatus = 'success';

      return {
        status: 'completed',
        changes: changes,
        summary: summary,
        notifications: notificationResults,
        duration: Date.now() - startTime.getTime()
      };

    } catch (error) {
      this.errorCount++;
      this.lastRunStatus = 'error';
      logger.error(`Monitoring cycle #${this.runCount} failed:`, error.message);
      
      // Send error notification to admin (if configured)
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
   * Log cycle summary
   * @param {Date} startTime - Cycle start time
   * @param {Object} summary - Changes summary
   * @param {Array} notificationResults - Notification results
   */
  logCycleSummary(startTime, summary, notificationResults) {
    const duration = Date.now() - startTime.getTime();
    const successfulNotifications = notificationResults.filter(r => r.success).length;
    
    logger.info(`Monitoring cycle #${this.runCount} completed in ${duration}ms`);
    logger.info(`Summary: ${summary.totalChanges} total changes`);
    logger.info(`- New cases: ${summary.newCases}`);
    logger.info(`- Status changes: ${summary.statusChanges}`);
    logger.info(`- Hearing date changes: ${summary.hearingDateChanges}`);
    logger.info(`- Order updates: ${summary.orderUpdates}`);
    logger.info(`- General updates: ${summary.generalUpdates}`);
    logger.info(`Notifications: ${successfulNotifications}/${notificationResults.length} sent successfully`);
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
   * Add a new case number to monitor
   * @param {string} caseNumber - Case number to add
   */
  addCaseNumber(caseNumber) {
    if (!this.caseNumbers.includes(caseNumber)) {
      this.caseNumbers.push(caseNumber);
      logger.info(`Added case number to monitoring: ${caseNumber}`);
    }
  }

  /**
   * Remove a case number from monitoring
   * @param {string} caseNumber - Case number to remove
   */
  removeCaseNumber(caseNumber) {
    const index = this.caseNumbers.indexOf(caseNumber);
    if (index > -1) {
      this.caseNumbers.splice(index, 1);
      logger.info(`Removed case number from monitoring: ${caseNumber}`);
    }
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
      caseNumbers: this.caseNumbers,
      schedule: this.defaultSchedule
    };
  }

  /**
   * Run monitoring cycle manually (for testing)
   * @returns {Promise<Object>} Cycle results
   */
  async runManually() {
    logger.info('Running monitoring cycle manually...');
    return await this.runMonitoringCycle();
  }

  /**
   * Schedule a one-time run after specified delay
   * @param {number} delayMinutes - Delay in minutes
   */
  scheduleOneTimeRun(delayMinutes = 1) {
    const runTime = new Date(Date.now() + delayMinutes * 60 * 1000);
    const cronExpression = `${runTime.getMinutes()} ${runTime.getHours()} ${runTime.getDate()} ${runTime.getMonth() + 1} *`;
    
    const job = cron.schedule(cronExpression, async () => {
      await this.runMonitoringCycle();
      job.stop(); // Stop after one run
    }, {
      scheduled: false,
      timezone: 'Asia/Kolkata'
    });

    job.start();
    logger.info(`Scheduled one-time run at ${runTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  }

  /**
   * Update monitoring schedule
   * @param {string} newSchedule - New cron schedule
   */
  updateSchedule(newSchedule) {
    this.stopMonitoring();
    this.defaultSchedule = newSchedule;
    this.startMonitoring(newSchedule, this.caseNumbers);
    logger.info(`Updated monitoring schedule to: ${newSchedule}`);
  }

  /**
   * Get next scheduled run time
   * @returns {Date|null} Next run time
   */
  getNextRunTime() {
    const job = this.jobs.get('monitoring');
    if (job) {
      return job.nextDate();
    }
    return null;
  }
}

module.exports = new CronService();