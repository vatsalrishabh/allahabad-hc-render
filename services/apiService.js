const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');

class ApiService {
  constructor() {
    this.baseUrl = 'https://allahabadhighcourt.in/apps/status_ccms/index.php/get_CaseDetails';
    this.timeout = 30000; // 30 seconds timeout
    this.retryAttempts = 3;
    this.requestDelay = 1000; // 1 second delay between requests to be respectful
  }

  /**
   * Fetch case data for multiple CINOs
   * @param {Array} cinos - Array of CINO numbers to fetch
   * @returns {Promise<Array>} Array of parsed case data
   */
  async fetchCaseData(cinos = []) {
    const results = [];
    
    for (const cino of cinos) {
      try {
        logger.info(`Fetching data for CINO: ${cino}`);
        const caseData = await this.fetchSingleCase(cino);
        if (caseData) {
          results.push(caseData);
        }
        
        // Add delay between requests to be respectful to the server
        if (cinos.indexOf(cino) < cinos.length - 1) {
          await this.delay(this.requestDelay);
        }
      } catch (error) {
        logger.error(`Error fetching case ${cino}:`, error.message);
      }
    }
    
    return results;
  }

  /**
   * Fetch data for a single case with retry mechanism
   * @param {string} cino - CINO number to fetch
   * @returns {Promise<Object|null>} Parsed case data or null
   */
  async fetchSingleCase(cino) {
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const response = await this.makeRequest(cino);
        if (response && response.data) {
          return this.parseHtmlToJson(response.data, cino);
        }
      } catch (error) {
        logger.warn(`Attempt ${attempt} failed for CINO ${cino}:`, error.message);
        if (attempt === this.retryAttempts) {
          throw error;
        }
        // Wait before retry (exponential backoff)
        await this.delay(1000 * Math.pow(2, attempt - 1));
      }
    }
    return null;
  }

  /**
   * Make HTTP POST request to fetch case data
   * @param {string} cino - CINO number
   * @returns {Promise<Object>} HTTP response
   */
  async makeRequest(cino) {
    const formData = new URLSearchParams();
    formData.append('cino', cino);
    formData.append('source', 'undefined');

    const config = {
      method: 'POST',
      url: this.baseUrl,
      data: formData,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin'
      }
    };

    return await axios(config);
  }

  /**
   * Parse HTML response to structured JSON
   * @param {string} htmlData - Raw HTML data
   * @param {string} cino - CINO number
   * @returns {Object} Parsed case data
   */
  parseHtmlToJson(htmlData, cino) {
    try {
      const $ = cheerio.load(htmlData);
      
      // Extract basic case information
      const caseData = {
        cino: cino,
        cnr: this.extractText($, 'td:contains("CNR")').replace('CNR', '').trim(),
        filingNumber: this.extractText($, 'td:contains("Filing No.")').replace('Filing No.', '').trim(),
        filingDate: this.parseDate(this.extractText($, 'td:contains("Filing Date")')),
        registrationDate: this.parseDate(this.extractText($, 'td:contains("Date of Registration")')),
        caseStatus: this.extractText($, 'td:contains("Case Status")').replace('Case Status', '').trim(),
        caseTitle: this.extractCaseTitle($),
        
        // Hearing information
        firstHearingDate: this.parseDate(this.extractText($, 'td:contains("First Hearing Date")')),
        nextHearingDate: this.parseDate(this.extractText($, 'td:contains("Next Hearing Date")')),
        stageOfCase: this.extractText($, 'td:contains("Stage of Case")').replace('Stage of Case', '').trim(),
        
        // Court details
        benchType: this.extractText($, 'td:contains("Bench Type")').replace('Bench Type', '').trim(),
        causelistType: this.extractText($, 'td:contains("Causelist Type")').replace('Causelist Type', '').trim(),
        state: this.extractText($, 'td:contains("State")').replace('State', '').trim(),
        district: this.extractText($, 'td:contains("District")').replace('District', '').trim(),
        coram: this.extractText($, 'td:contains("Coram")').replace('Coram', '').trim(),
        
        // Parties information
        petitioners: this.extractParties($, 'Petitioner'),
        respondents: this.extractParties($, 'Respondent'),
        
        // Legal acts and sections
        acts: this.extractActs($),
        
        // Category details
        category: this.extractCategory($),
        
        // Lower court details
        lowerCourt: this.extractLowerCourtDetails($),
        
        // Crime details
        crimeDetails: this.extractCrimeDetails($),
        
        // IA Applications
        iaApplications: this.extractIAApplications($),
        
        // Listing history
        listingHistory: this.extractListingHistory($),
        
        // Raw data for backup
        rawApiResponse: htmlData,
        lastApiCheck: new Date(),
        apiCheckCount: 1
      };

      // Generate hash for change detection
      caseData.dataHash = this.generateDataHash(caseData);
      
      logger.info(`Successfully parsed case data for CINO: ${cino}`);
      return caseData;
      
    } catch (error) {
      logger.error(`Error parsing HTML for CINO ${cino}:`, error.message);
      throw error;
    }
  }

  /**
   * Extract case title from the HTML
   */
  extractCaseTitle($) {
    // Look for case title in various possible locations
    let title = this.extractText($, 'h2, h3, .case-title, td:contains("APPLICATION")');
    if (!title) {
      // Try to extract from the first table row that contains case type info
      title = $('td').filter((i, el) => {
        const text = $(el).text();
        return text.includes('APPLICATION') || text.includes('PETITION') || text.includes('APPEAL');
      }).first().text().trim();
    }
    return title || 'Case Title Not Found';
  }

  /**
   * Extract parties (petitioners/respondents) information
   */
  extractParties($, partyType) {
    const parties = [];
    const partySection = $(`td:contains("${partyType}")`).parent().next();
    
    if (partySection.length) {
      const partyText = partySection.text();
      const lines = partyText.split('\n').filter(line => line.trim());
      
      lines.forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.includes('Advocate')) {
          const advocateMatch = lines.find(l => l.includes('Advocate') && l.includes(trimmedLine));
          let advocate = { name: '', code: '' };
          
          if (advocateMatch) {
            const advocateText = advocateMatch.replace('Advocate -', '').trim();
            const codeMatch = advocateText.match(/\(([^)]+)\)/);
            advocate.name = advocateText.replace(/\([^)]+\)/, '').trim();
            advocate.code = codeMatch ? codeMatch[1] : '';
          }
          
          parties.push({
            name: trimmedLine,
            advocate: advocate
          });
        }
      });
    }
    
    return parties;
  }

  /**
   * Extract acts and sections
   */
  extractActs($) {
    const acts = [];
    const actsTable = $('table').filter((i, table) => {
      return $(table).text().includes('Under Act(s)') && $(table).text().includes('Under Section(s)');
    });
    
    if (actsTable.length) {
      actsTable.find('tr').each((i, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 2) {
          const actName = $(cells[0]).text().trim();
          const sections = $(cells[1]).text().trim().split(',').map(s => s.trim());
          
          if (actName && actName !== 'Under Act(s)') {
            acts.push({
              actName: actName,
              sections: sections
            });
          }
        }
      });
    }
    
    return acts;
  }

  /**
   * Extract category details
   */
  extractCategory($) {
    const categoryText = this.extractText($, 'td:contains("Category")');
    const subCategoryText = this.extractText($, 'td:contains("Sub Category")');
    
    // Clean up the extracted text
    let mainCategory = categoryText.replace(/Category\s*:?\s*/i, '').trim();
    let subCategory = subCategoryText.replace(/Sub\s*Category\s*:?\s*/i, '').trim();
    
    // If still empty, try alternative extraction
    if (!mainCategory) {
      const categoryCell = $('td').filter((i, el) => {
        return $(el).text().toLowerCase().includes('category');
      }).first();
      if (categoryCell.length > 0) {
        const cellText = categoryCell.text().trim();
        mainCategory = cellText.replace(/Category\s*:?\s*/i, '').trim();
      }
    }
    
    if (!subCategory) {
      const subCategoryCell = $('td').filter((i, el) => {
        return $(el).text().toLowerCase().includes('sub category');
      }).first();
      if (subCategoryCell.length > 0) {
        const cellText = subCategoryCell.text().trim();
        subCategory = cellText.replace(/Sub\s*Category\s*:?\s*/i, '').trim();
      }
    }
    
    return {
      main: mainCategory || '',
      sub: subCategory || ''
    };
  }

  /**
   * Extract lower court details
   */
  extractLowerCourtDetails($) {
    const caseNumberText = this.extractText($, 'td:contains("Case No. and Year")');
    const decisionDateText = this.extractText($, 'td:contains("Decision Date")');
    const districtText = this.extractText($, 'td:contains("District")');
    
    // Clean up the extracted text
    let caseNumber = caseNumberText.replace(/Case\s*No\.\s*and\s*Year\s*:?\s*/i, '').trim();
    let district = districtText.replace(/District\s*:?\s*/i, '').trim();
    
    // Extract case number and year if they're combined
    let year = '';
    if (caseNumber.includes('/')) {
      const parts = caseNumber.split('/');
      if (parts.length === 2) {
        caseNumber = parts[0].trim();
        year = parts[1].trim();
      }
    }
    
    return {
      caseNumber: caseNumber || '',
      year: year || '',
      decisionDate: this.parseDate(decisionDateText),
      district: district || ''
    };
  }

  /**
   * Extract crime details
   */
  extractCrimeDetails($) {
    const districtText = this.extractText($, 'td:contains("District")');
    const policeStationText = this.extractText($, 'td:contains("Police Station")');
    const crimeNumberText = this.extractText($, 'td:contains("Crime No.")');
    const yearText = this.extractText($, 'td:contains("Year")');
    
    // Clean up the extracted text
    let district = districtText.replace(/District\s*:?\s*/i, '').trim();
    let policeStation = policeStationText.replace(/Police\s*Station\s*:?\s*/i, '').trim();
    let crimeNumber = crimeNumberText.replace(/Crime\s*No\.\s*:?\s*/i, '').trim();
    let year = yearText.replace(/Year\s*:?\s*/i, '').trim();
    
    // Extract crime number and year if they're combined
    if (crimeNumber.includes('/') && !year) {
      const parts = crimeNumber.split('/');
      if (parts.length === 2) {
        crimeNumber = parts[0].trim();
        year = parts[1].trim();
      }
    }
    
    return {
      district: district || '',
      policeStation: policeStation || '',
      crimeNumber: crimeNumber || '',
      year: year || ''
    };
  }

  /**
   * Extract IA Applications
   */
  extractIAApplications($) {
    const applications = [];
    const iaTable = $('table').filter((i, table) => {
      return $(table).text().includes('IA Details') || $(table).text().includes('Application(s) Number');
    });
    
    if (iaTable.length) {
      iaTable.find('tr').slice(1).each((i, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 3) {
          const applicationText = $(cells[0]).text().trim();
          const partyText = $(cells[1]).text().trim();
          const filingDateText = $(cells[2]).text().trim();
          const statusText = cells.length > 3 ? $(cells[3]).text().trim() : 'Pending';
          
          // Extract application number and classification
          let applicationNumber = applicationText;
          let classification = '';
          
          if (applicationText.includes('Classification')) {
            const parts = applicationText.split('Classification');
            applicationNumber = parts[0].trim();
            classification = parts[1].replace(':', '').trim();
          }
          
          // Extract applied by advocate from party text
          let party = partyText;
          let appliedBy = '';
          
          if (partyText.includes('Applied by (Advocate)')) {
            const parts = partyText.split('Applied by (Advocate)');
            party = parts[0].replace('Vs', 'vs').trim();
            appliedBy = parts[1].replace(':', '').trim();
          }
          
          applications.push({
            applicationNumber: applicationNumber,
            classification: classification,
            party: party,
            appliedBy: appliedBy,
            filingDate: this.parseDate(filingDateText),
            status: statusText || 'Pending'
          });
        }
      });
    }
    
    return applications;
  }

  /**
   * Extract listing history
   */
  extractListingHistory($) {
    const history = [];
    const historyTable = $('table').filter((i, table) => {
      return $(table).text().includes('Listing History') || $(table).text().includes('Cause List Type');
    });
    
    if (historyTable.length) {
      historyTable.find('tr').slice(1).each((i, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 3) {
          const causeListType = $(cells[0]).text().trim();
          const justiceText = $(cells[1]).text().trim();
          const listingDateText = cells.length > 2 ? $(cells[2]).text().trim() : '';
          const shortOrderText = cells.length > 3 ? $(cells[3]).text().trim() : '';
          
          // Extract bench ID from justice text
          let justice = justiceText;
          let benchId = '';
          
          if (justiceText.includes('(Bench ID:')) {
            const benchMatch = justiceText.match(/\(Bench ID:(\d+)\)/);
            if (benchMatch) {
              benchId = benchMatch[1];
              justice = justiceText.replace(/\(Bench ID:\d+\)/, '').trim();
            }
          }
          
          history.push({
            causeListType: causeListType,
            justice: justice,
            benchId: benchId,
            listingDate: this.parseDate(listingDateText),
            shortOrder: shortOrderText
          });
        }
      });
    }
    
    return history.slice(0, 20); // Keep only last 20 entries
  }

  /**
   * Generate hash for change detection
   */
  generateDataHash(caseData) {
    const crypto = require('crypto');
    const dataString = JSON.stringify({
      caseStatus: caseData.caseStatus,
      nextHearingDate: caseData.nextHearingDate,
      stageOfCase: caseData.stageOfCase,
      coram: caseData.coram,
      iaApplications: caseData.iaApplications,
      listingHistory: caseData.listingHistory?.slice(-5)
    });
    return crypto.createHash('md5').update(dataString).digest('hex');
  }

  /**
   * Extract text from HTML elements using multiple selectors
   * @param {Object} $ - Cheerio instance
   * @param {string} selectors - CSS selectors separated by commas
   * @returns {string} Extracted text
   */
  extractText($, selectors) {
    const selectorArray = selectors.split(',').map(s => s.trim());
    
    for (const selector of selectorArray) {
      const element = $(selector);
      if (element.length > 0) {
        return element.text().trim();
      }
    }
    
    // If no selector matches, try to find by text content in table cells
    const textContent = $('td').filter((i, el) => {
      const cellText = $(el).text().trim();
      return cellText.includes(selectors.replace('td:contains("', '').replace('")', ''));
    }).first();
    
    if (textContent.length > 0) {
      // Try to get the value from the same cell (after the label)
      const cellText = textContent.text().trim();
      const labelText = selectors.replace('td:contains("', '').replace('")', '');
      
      if (cellText.includes(':')) {
        // If there's a colon, get text after it
        const parts = cellText.split(':');
        if (parts.length > 1) {
          return parts.slice(1).join(':').trim();
        }
      } else if (cellText.length > labelText.length) {
        // Remove the label text from the beginning
        return cellText.replace(labelText, '').trim();
      }
      
      // Try to get value from next cell
      const nextCell = textContent.next('td');
      if (nextCell.length > 0) {
        return nextCell.text().trim();
      }
      
      // Try to get value from next sibling
      const nextSibling = textContent.next();
      if (nextSibling.length > 0) {
        return nextSibling.text().trim();
      }
    }
    
    return '';
  }

  /**
   * Parse date string to Date object
   * @param {string} dateString - Date string
   * @returns {Date|null} Parsed date or null
   */
  parseDate(dateString) {
    if (!dateString || dateString.trim() === '') return null;
    
    try {
      // Clean the date string
      let cleanDate = dateString.replace(/[^\d\/\-\.\s]/g, '').trim();
      
      // Handle different date formats
      if (cleanDate.includes('/')) {
        // DD/MM/YYYY or MM/DD/YYYY format
        const parts = cleanDate.split('/');
        if (parts.length === 3) {
          // Assume DD/MM/YYYY format (Indian standard)
          const day = parseInt(parts[0]);
          const month = parseInt(parts[1]) - 1; // Month is 0-indexed
          const year = parseInt(parts[2]);
          
          if (year > 1900 && month >= 0 && month <= 11 && day >= 1 && day <= 31) {
            return new Date(year, month, day);
          }
        }
      } else if (cleanDate.includes('-')) {
        // YYYY-MM-DD format
        const date = new Date(cleanDate);
        return isNaN(date.getTime()) ? null : date;
      } else if (cleanDate.includes('.')) {
        // DD.MM.YYYY format
        const parts = cleanDate.split('.');
        if (parts.length === 3) {
          const day = parseInt(parts[0]);
          const month = parseInt(parts[1]) - 1;
          const year = parseInt(parts[2]);
          
          if (year > 1900 && month >= 0 && month <= 11 && day >= 1 && day <= 31) {
            return new Date(year, month, day);
          }
        }
      }
      
      // Try direct parsing as last resort
      const date = new Date(cleanDate);
      return isNaN(date.getTime()) ? null : date;
      
    } catch (error) {
      logger.warn(`Error parsing date: ${dateString}`, error.message);
      return null;
    }
  }

  /**
   * Delay function for retry mechanism
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise} Promise that resolves after delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate CINO format
   * @param {string} cino - CINO to validate
   * @returns {boolean} True if valid CINO format
   */
  validateCino(cino) {
    if (!cino || typeof cino !== 'string') return false;
    
    // Basic CINO validation - should be numeric and reasonable length
    const cleanCino = cino.trim();
    return /^\d{6,12}$/.test(cleanCino);
  }

  /**
   * Get API statistics
   * @returns {Object} API usage statistics
   */
  getApiStats() {
    return {
      baseUrl: this.baseUrl,
      timeout: this.timeout,
      retryAttempts: this.retryAttempts,
      requestDelay: this.requestDelay
    };
  }

  /**
   * Test API connectivity
   * @returns {Promise<boolean>} True if API is accessible
   */
  async testConnectivity() {
    try {
      const testCino = '123456'; // Test with a dummy CINO
      const response = await this.makeRequest(testCino);
      return response && response.status === 200;
    } catch (error) {
      logger.error('API connectivity test failed:', error.message);
      return false;
    }
  }

  /**
   * Fetch case data using POST method (if required by the API)
   * @param {Object} formData - Form data to submit
   * @returns {Promise<Object>} HTTP response
   */
  async fetchWithFormData(formData) {
    const config = {
      method: 'POST',
      url: `${this.baseUrl}/case-search`,
      data: formData,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      }
    };

    return await axios(config);
  }
}

module.exports = new ApiService();