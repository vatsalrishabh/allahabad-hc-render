const axios = require('axios');
const logger = require('../utils/logger').whatsapp;

class WhatsAppService {
  constructor() {
    this.apiKey = process.env.WHATSAPP_API_KEY;
    this.apiUrl = 'http://198.38.87.182/api/whatsapp/send-bulk';
    this.recipientNumbers = process.env.WHATSAPP_RECIPIENT_NUMBERS?.split(',').map(num => num.trim()) || [];
    this.adminNumbers = process.env.WHATSAPP_ADMIN_NUMBERS?.split(',').map(num => num.trim()) || [];
    this.timeout = 30000;
  }

  /**
   * Send WhatsApp notifications for case changes
   * @param {Array} changes - Array of case changes
   * @returns {Promise<Array>} Array of notification results
   */
  async sendNotifications(changes) {
    if (!this.accessToken || !this.phoneNumberId) {
      logger.error('WhatsApp API credentials not configured');
      return [];
    }

    if (changes.length === 0) {
      logger.info('No changes to notify');
      return [];
    }

    const results = [];
    
    // Group changes by case number for better messaging
    const groupedChanges = this.groupChangesByCaseNumber(changes);
    
    for (const [caseNumber, caseChanges] of Object.entries(groupedChanges)) {
      try {
        const message = this.formatMessage(caseNumber, caseChanges);
        const notificationResults = await this.sendToAllRecipients(message);
        results.push(...notificationResults);
      } catch (error) {
        logger.error(`Error sending notification for case ${caseNumber}:`, error.message);
      }
    }
    
    return results;
  }

  /**
   * Group changes by case number
   * @param {Array} changes - Array of changes
   * @returns {Object} Grouped changes
   */
  groupChangesByCaseNumber(changes) {
    return changes.reduce((grouped, change) => {
      if (!grouped[change.caseNumber]) {
        grouped[change.caseNumber] = [];
      }
      grouped[change.caseNumber].push(change);
      return grouped;
    }, {});
  }

  /**
   * Format message for WhatsApp
   * @param {string} caseNumber - Case number
   * @param {Array} changes - Array of changes for this case
   * @returns {string} Formatted message
   */
  formatMessage(caseNumber, changes) {
    const firstChange = changes[0];
    let message = `🏛️ *Allahabad HC Update*\n\n`;
    message += `📋 *Case:* ${caseNumber}\n`;
    
    if (firstChange.details.caseTitle) {
      message += `📝 *Title:* ${firstChange.details.caseTitle}\n\n`;
    }

    changes.forEach((change, index) => {
      switch (change.type) {
        case 'NEW_CASE':
          message += `🆕 *New Case Registered*\n`;
          message += `👥 *Petitioner:* ${change.details.petitioner}\n`;
          message += `👥 *Respondent:* ${change.details.respondent}\n`;
          message += `📊 *Status:* ${change.details.status}\n`;
          break;
          
        case 'STATUS_CHANGE':
          message += `🔄 *Status Updated*\n`;
          message += `📊 *Old Status:* ${change.details.oldStatus}\n`;
          message += `📊 *New Status:* ${change.details.newStatus}\n`;
          break;
          
        case 'HEARING_DATE_CHANGE':
          message += `📅 *Hearing Date Updated*\n`;
          if (change.details.oldDate) {
            message += `📅 *Previous Date:* ${this.formatDate(change.details.oldDate)}\n`;
          }
          if (change.details.newDate) {
            message += `📅 *New Date:* ${this.formatDate(change.details.newDate)}\n`;
          }
          break;
          
        case 'ORDER_UPDATE':
          message += `⚖️ *New Order/Judgment*\n`;
          if (change.details.orderDate) {
            message += `📅 *Order Date:* ${this.formatDate(change.details.orderDate)}\n`;
          }
          if (change.details.orderDetails) {
            message += `📄 *Details:* ${change.details.orderDetails.substring(0, 200)}${change.details.orderDetails.length > 200 ? '...' : ''}\n`;
          }
          break;
          
        case 'GENERAL_UPDATE':
          message += `📝 *${change.details.field} Updated*\n`;
          if (change.details.newValue) {
            message += `🔄 *New Value:* ${change.details.newValue}\n`;
          }
          break;
      }
      
      if (index < changes.length - 1) {
        message += `\n`;
      }
    });

    message += `\n⏰ *Updated:* ${this.formatDate(new Date())}\n`;
    message += `\n🔗 Check full details on Allahabad HC website`;
    
    return message;
  }

  /**
   * Send message to all configured recipients
   * @param {string} message - Message to send
   * @returns {Promise<Array>} Array of results
   */
  async sendToAllRecipients(message) {
    const results = [];
    
    for (const recipientNumber of this.recipientNumbers) {
      try {
        const result = await this.sendMessage([recipientNumber.trim()], message);
        results.push({
          recipient: recipientNumber,
          success: true,
          messageId: result.messageId,
          timestamp: new Date()
        });
        
        logger.info(`WhatsApp message sent to ${recipientNumber}`);
        
        // Add delay between messages to avoid rate limiting
        await this.delay(1000);
        
      } catch (error) {
        logger.error(`Failed to send WhatsApp message to ${recipientNumber}:`, error.message);
        results.push({
          recipient: recipientNumber,
          success: false,
          error: error.message,
          timestamp: new Date()
        });
      }
    }
    
    return results;
  }

  /**
   * Send WhatsApp message to multiple numbers
   * @param {Array|string} numbers - Array of recipient phone numbers or single number
   * @param {string} message - Message text
   * @returns {Promise<Object>} API response
   */
  async sendMessage(numbers, message) {
    if (!this.apiKey) {
      throw new Error('WhatsApp API key not configured');
    }

    if (!numbers) {
      logger.warn('No recipient numbers provided');
      return { success: false, error: 'No recipients' };
    }

    try {
      // Ensure numbers is an array
      const numbersArray = Array.isArray(numbers) ? numbers : [numbers];
      
      if (numbersArray.length === 0) {
        logger.warn('Empty recipients array');
        return { success: false, error: 'No recipients' };
      }
      
      // Clean and validate phone numbers
      const cleanNumbers = numbersArray.map(number => this.validatePhoneNumber(number));
      
      const response = await axios.post(
        this.apiUrl,
        {
          numbers: cleanNumbers,
          message: message
        },
        {
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json'
          },
          timeout: this.timeout
        }
      );

      logger.info(`WhatsApp bulk message sent successfully to ${cleanNumbers.length} recipients`);
      
      return {
        success: true,
        recipients: cleanNumbers,
        response: response.data
      };
      
    } catch (error) {
      logger.error(`Failed to send WhatsApp bulk message:`, error.message);
      
      return {
        success: false,
        error: error.message,
        recipients: numbers
      };
    }
  }

  /**
   * Send template message (for structured notifications)
   * @param {string} recipientNumber - Recipient phone number
   * @param {string} templateName - Template name
   * @param {Array} parameters - Template parameters
   * @returns {Promise<Object>} API response
   */
  async sendTemplateMessage(recipientNumber, templateName, parameters = []) {
    const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;
    
    const payload = {
      messaging_product: 'whatsapp',
      to: recipientNumber,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: 'en'
        },
        components: [
          {
            type: 'body',
            parameters: parameters.map(param => ({
              type: 'text',
              text: param
            }))
          }
        ]
      }
    };

    const config = {
      method: 'POST',
      url: url,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      data: payload,
      timeout: this.timeout
    };

    const response = await axios(config);
    return {
      messageId: response.data.messages[0].id,
      status: 'sent'
    };
  }

  /**
   * Format date for display
   * @param {Date} date - Date to format
   * @returns {string} Formatted date string
   */
  formatDate(date) {
    if (!date) return 'Not specified';
    
    const options = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata'
    };
    
    return new Date(date).toLocaleString('en-IN', options);
  }

  /**
   * Delay function
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise} Promise that resolves after delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate WhatsApp phone number format
   * @param {string} phoneNumber - Phone number to validate
   * @returns {string} Cleaned phone number
   */
  validatePhoneNumber(phoneNumber) {
    if (!phoneNumber) {
      throw new Error('Phone number is required');
    }

    // Remove all non-digit characters
    let cleanNumber = phoneNumber.replace(/\D/g, '');
    
    // Add country code if not present (assuming India +91)
    if (!cleanNumber.startsWith('91') && cleanNumber.length === 10) {
      cleanNumber = '91' + cleanNumber;
    }
    
    // Validate Indian phone number format
    if (!/^91[6-9]\d{9}$/.test(cleanNumber)) {
      throw new Error(`Invalid phone number format: ${phoneNumber}`);
    }
    
    return cleanNumber;
  }

  /**
   * Send message to single number (wrapper for bulk API)
   * @param {string} number - Single phone number
   * @param {string} message - Message text
   * @returns {Promise<Object>} API response
   */
  async sendSingleMessage(number, message) {
    return await this.sendMessage([number], message);
  }

  /**
   * Get delivery status of a message
   * @param {string} messageId - Message ID
   * @returns {Promise<Object>} Delivery status
   */
  async getMessageStatus(messageId) {
    try {
      const url = `${this.apiUrl}/${messageId}`;
      const config = {
        method: 'GET',
        url: url,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        },
        timeout: this.timeout
      };

      const response = await axios(config);
      return response.data;
    } catch (error) {
      logger.error(`Error getting message status for ${messageId}:`, error.message);
      throw error;
    }
  }

  /**
   * Send test message to verify WhatsApp integration
   * @param {string} testNumber - Optional test number, uses first recipient if not provided
   * @returns {Promise<Object>} Test result
   */
  async sendTestMessage(testNumber = null) {
    try {
      const targetNumbers = testNumber ? [testNumber] : [this.recipientNumbers[0]];
      
      if (!targetNumbers[0]) {
        throw new Error('No test number provided and no recipient numbers configured');
      }

      const testMessage = `🧪 Test Message from Allahabad HC Monitor\n\nTime: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n\nIf you receive this message, WhatsApp integration is working correctly! ✅`;

      const result = await this.sendMessage(targetNumbers, testMessage);
      
      if (result.success) {
        logger.info(`Test message sent successfully to ${targetNumbers[0]}`);
        
        return {
          success: true,
          recipients: result.recipients,
          response: result.response,
          timestamp: new Date().toISOString()
        };
      } else {
        throw new Error(result.error);
      }
      
    } catch (error) {
      logger.error('Failed to send test message:', error.message);
      
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = new WhatsAppService();