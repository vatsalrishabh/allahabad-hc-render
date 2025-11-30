const cron = require('node-cron');
const logger = require('../utils/logger');
const CinoNumbers = require('../models/CinoNumbers');
const Case = require('../models/Case');
const apiService = require('./apiService');
const whatsappService = require('./whatsappService');

/**
 * Fetch case data and send WhatsApp messages for all CINO numbers
 */
async function fetchAndSendAll() {
  logger.info('Starting scheduled fetch and send for all CINO numbers');
  
  try {
    // Get all CINO mappings
    const cinoMappings = await CinoNumbers.find().lean();
    logger.info(`Found ${cinoMappings.length} CINO mappings to process`);
    
    let successCount = 0;
    let errorCount = 0;
    
    // Process each CINO mapping
    for (const mapping of cinoMappings) {
      const { _id, cino, numbers } = mapping;
      
      if (!numbers || numbers.length === 0) {
        logger.warn(`Skipping CINO ${cino} - no numbers associated`);
        continue;
      }
      
      try {
        // Fetch case data
        logger.info(`Fetching case data for CINO: ${cino}`);
        const caseData = await apiService.fetchCaseData(cino);
        
        if (!caseData) {
          logger.error(`No case data found for CINO: ${cino}`);
          errorCount++;
          continue;
        }
        
        // Update or create case in database
        await Case.findOneAndUpdate(
          { cino },
          { 
            ...caseData,
            lastUpdated: new Date()
          },
          { upsert: true, new: true }
        );
        
        // Prepare WhatsApp message
        const message = `
*Case Update: ${caseData.caseTitle || cino}*
Status: ${caseData.caseStatus || 'N/A'}
Next Hearing: ${caseData.nextHearingDate ? new Date(caseData.nextHearingDate).toLocaleDateString('en-IN') : 'Not scheduled'}
Last Order: ${caseData.lastOrder || 'N/A'}
        `.trim();
        
        // Send WhatsApp message to all numbers
        for (const number of numbers) {
          try {
            await whatsappService.sendMessage(number, message);
            logger.info(`Successfully sent WhatsApp to ${number} for CINO ${cino}`);
          } catch (err) {
            logger.error(`Failed to send WhatsApp to ${number} for CINO ${cino}:`, err.message);
          }
        }
        
        successCount++;
      } catch (err) {
        logger.error(`Error processing CINO ${cino}:`, err.message);
        errorCount++;
      }
    }
    
    logger.info(`Scheduled task completed. Success: ${successCount}, Errors: ${errorCount}`);
  } catch (error) {
    logger.error('Error in scheduled fetch and send task:', error.message);
  }
}

/**
 * Initialize all scheduled tasks
 */
function initScheduledTasks() {
  // Schedule daily task at 6:00 PM
  cron.schedule('0 18 * * *', () => {
    logger.info('Running scheduled task: Daily case data fetch and WhatsApp sending');
    fetchAndSendAll();
  });
  
  logger.info('Scheduled tasks initialized');
}

module.exports = {
  initScheduledTasks,
  fetchAndSendAll
};