const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

// Import models
const User = require('../models/User');
const Case = require('../models/Case');
const UserCase = require('../models/UserCase');
const CinoNumbers = require('../models/CinoNumbers');

// Import services
const apiService = require('../services/apiService');
const whatsappService = require('../services/whatsappService');

// ==================== CINO NUMBERS ROUTES ====================

/**
 * @route GET /api/admin/cino-numbers
 * @desc Get all CINO -> numbers mappings
 */
router.get('/cino-numbers', async (req, res) => {
  try {
    const docs = await CinoNumbers.find().sort({ updatedAt: -1 }).lean();
    res.json({ success: true, data: docs });
  } catch (error) {
    logger.error('Error fetching CINO numbers:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch CINO numbers', error: error.message });
  }
});

/**
 * @route GET /api/admin/cino-numbers/:cino
 * @desc Get numbers for a specific CINO
 */
router.get('/cino-numbers/:cino', async (req, res) => {
  try {
    const { cino } = req.params;
    const doc = await CinoNumbers.findOne({ cino }).lean();
    res.json({ success: true, data: doc || { cino, numbers: [] } });
  } catch (error) {
    logger.error('Error fetching CINO numbers by cino:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch CINO numbers', error: error.message });
  }
});

/**
 * @route POST /api/admin/cino-numbers/:cino/numbers
 * @desc Add a number to a CINO mapping
 */
router.post('/cino-numbers/:cino/numbers', async (req, res) => {
  try {
    const { cino } = req.params;
    const { number } = req.body;
    if (!number) return res.status(400).json({ success: false, message: 'Number is required' });

    const doc = await CinoNumbers.findOneAndUpdate(
      { cino },
      { $addToSet: { numbers: String(number) } },
      { upsert: true, new: true }
    );
    res.json({ success: true, data: doc });
  } catch (error) {
    logger.error('Error adding number to CINO:', error.message);
    res.status(500).json({ success: false, message: 'Failed to add number', error: error.message });
  }
});

/**
 * @route PUT /api/admin/cino-numbers/:cino/numbers
 * @desc Update a number (replace old with new) in a CINO mapping
 */
router.put('/cino-numbers/:cino/numbers', async (req, res) => {
  try {
    const { cino } = req.params;
    const { oldNumber, newNumber } = req.body;
    if (!oldNumber || !newNumber) {
      return res.status(400).json({ success: false, message: 'oldNumber and newNumber are required' });
    }

    const doc = await CinoNumbers.findOne({ cino });
    if (!doc) return res.status(404).json({ success: false, message: 'CINO mapping not found' });

    const idx = doc.numbers.findIndex(n => String(n) === String(oldNumber));
    if (idx === -1) return res.status(404).json({ success: false, message: 'Old number not found' });

    doc.numbers[idx] = String(newNumber);
    await doc.save();
    res.json({ success: true, data: doc });
  } catch (error) {
    logger.error('Error updating number for CINO:', error.message);
    res.status(500).json({ success: false, message: 'Failed to update number', error: error.message });
  }
});

/**
 * @route DELETE /api/admin/cino-numbers/:cino/numbers
 * @desc Remove a number from a CINO mapping
 */
router.delete('/cino-numbers/:cino/numbers', async (req, res) => {
  try {
    const { cino } = req.params;
    const { number } = req.body;
    if (!number) return res.status(400).json({ success: false, message: 'Number is required' });

    const doc = await CinoNumbers.findOneAndUpdate(
      { cino },
      { $pull: { numbers: String(number) } },
      { new: true }
    );
    res.json({ success: true, data: doc || { cino, numbers: [] } });
  } catch (error) {
    logger.error('Error deleting number from CINO:', error.message);
    res.status(500).json({ success: false, message: 'Failed to delete number', error: error.message });
  }
});

/**
 * @route POST /api/admin/cino-numbers
 * @desc Create or replace CINO mapping with full numbers array
 */
router.post('/cino-numbers', async (req, res) => {
  try {
    const { cino, numbers } = req.body;
    if (!cino || !Array.isArray(numbers)) {
      return res.status(400).json({ success: false, message: 'cino and numbers[] are required' });
    }
    const unique = [...new Set(numbers.map(n => String(n)))];
    const doc = await CinoNumbers.findOneAndUpdate(
      { cino },
      { cino, numbers: unique },
      { upsert: true, new: true }
    );
    res.json({ success: true, data: doc });
  } catch (error) {
    logger.error('Error creating cino-numbers mapping:', error.message);
    res.status(500).json({ success: false, message: 'Failed to create mapping', error: error.message });
  }
});

/**
 * @route PUT /api/admin/cino-numbers/:cino
 * @desc Replace numbers array for a specific CINO mapping
 */
router.put('/cino-numbers/:cino', async (req, res) => {
  try {
    const { cino } = req.params;
    const { numbers } = req.body;
    if (!Array.isArray(numbers)) {
      return res.status(400).json({ success: false, message: 'numbers[] is required' });
    }
    const unique = [...new Set(numbers.map(n => String(n)))];
    const doc = await CinoNumbers.findOneAndUpdate(
      { cino },
      { numbers: unique },
      { new: true }
    );
    if (!doc) return res.status(404).json({ success: false, message: 'CINO mapping not found' });
    res.json({ success: true, data: doc });
  } catch (error) {
    logger.error('Error replacing numbers for CINO:', error.message);
    res.status(500).json({ success: false, message: 'Failed to replace numbers', error: error.message });
  }
});

/**
 * @route DELETE /api/admin/cino-numbers/:cino
 * @desc Delete CINO mapping
 */
router.delete('/cino-numbers/:cino', async (req, res) => {
  try {
    const { cino } = req.params;
    const result = await CinoNumbers.deleteOne({ cino });
    res.json({ success: true, data: { deleted: result.deletedCount } });
  } catch (error) {
    logger.error('Error deleting CINO mapping:', error.message);
    res.status(500).json({ success: false, message: 'Failed to delete CINO mapping', error: error.message });
  }
});

/**
 * @route POST /api/admin/cino-numbers/:id/fetch-and-send
 * @desc Fetch case data by CINO and send WhatsApp to all associated numbers
 */
router.post('/cino-numbers/:id/fetch-and-send', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Find the CINO mapping by ID
    const cinoMapping = await CinoNumbers.findById(id);
    if (!cinoMapping) {
      return res.status(404).json({ success: false, message: 'CINO mapping not found' });
    }
    
    const { cino, numbers } = cinoMapping;
    if (!numbers || numbers.length === 0) {
      return res.status(400).json({ success: false, message: 'No numbers associated with this CINO' });
    }
    
    // Fetch latest case data from API
    logger.info(`Fetching case data for CINO: ${cino}`);
    const caseData = await apiService.fetchCaseData(cino);
    if (!caseData) {
      return res.status(404).json({ success: false, message: 'Case data not found or API error' });
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
    const sendResults = [];
    for (const number of numbers) {
      try {
        const result = await whatsappService.sendMessage(number, message);
        sendResults.push({ number, success: true, result });
      } catch (err) {
        logger.error(`Failed to send WhatsApp to ${number}:`, err.message);
        sendResults.push({ number, success: false, error: err.message });
      }
    }
    
    const successCount = sendResults.filter(r => r.success).length;
    
    res.json({ 
      success: true, 
      message: `Case data fetched and sent to ${successCount}/${numbers.length} numbers`,
      caseData,
      sendResults
    });
  } catch (error) {
    logger.error('Error in fetch-and-send:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch and send', error: error.message });
  }
});

/**
 * @route POST /api/admin/cino-numbers/:cino/send
 * @desc Send WhatsApp message for a case to all numbers mapped to CINO
 */
router.post('/cino-numbers/:cino/send', async (req, res) => {
  try {
    const { cino } = req.params;
    const { message } = req.body;

    // Load numbers
    const doc = await CinoNumbers.findOne({ cino }).lean();
    const numbers = doc?.numbers || [];
    if (numbers.length === 0) return res.status(400).json({ success: false, message: 'No numbers mapped to this CINO' });

    // Build message if not provided using Case details
    let msg = message;
    if (!msg) {
      const caseDoc = await Case.findOne({ cino }).lean();
      const title = caseDoc?.caseTitle || 'Allahabad HC Case Update';
      const status = caseDoc?.caseStatus || 'N/A';
      const hearing = caseDoc?.nextHearingDate ? new Date(caseDoc.nextHearingDate).toLocaleDateString('en-IN') : 'Not scheduled';
      msg = `\u{1F3DB}\u{FE0F} Allahabad HC Update\n\n` +
            `\u{1F4CB} Case: ${title}\n` +
            `\u{1F522} CINO: ${cino}\n` +
            `\u{1F4CA} Status: ${status}\n` +
            `\u{1F4C5} Next Hearing: ${hearing}\n\n` +
            `\u{1F517} Check details on Allahabad HC website`;
    }

    const result = await whatsappService.sendMessage(numbers, msg);
    res.json({ success: true, data: { recipients: result.recipients || numbers, response: result.response || null } });
  } catch (error) {
    logger.error('Error sending WhatsApp message for CINO:', error.message);
    res.status(500).json({ success: false, message: 'Failed to send WhatsApp message', error: error.message });
  }
});

// ==================== USER MANAGEMENT ROUTES ====================

/**
 * @route GET /api/admin/users
 * @desc Get all users with pagination
 * @access Public
 */
router.get('/users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const users = await User.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await User.countDocuments();

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          current: page,
          total: Math.ceil(total / limit),
          count: users.length,
          totalUsers: total
        }
      }
    });

  } catch (error) {
    logger.error('Error fetching users:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error.message
    });
  }
});

/**
 * @route GET /api/admin/users/:id
 * @desc Get single user by ID
 * @access Public
 */
router.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).lean();
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get user's subscribed cases
    const userCases = await UserCase.find({ userId: user._id })
      .populate('caseId')
      .lean();

    res.json({
      success: true,
      data: {
        user,
        subscribedCases: userCases
      }
    });

  } catch (error) {
    logger.error('Error fetching user:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user',
      error: error.message
    });
  }
});

/**
 * @route POST /api/admin/users
 * @desc Create new user
 * @access Public
 */
router.post('/users', async (req, res) => {
  try {
    const { mobileNumber, name, email } = req.body;

    // Validate required fields
    if (!mobileNumber || !name) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number and name are required'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ mobileNumber });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User with this mobile number already exists'
      });
    }

    // Create new user
    const user = new User({
      mobileNumber,
      name,
      email,
      isActive: true
    });

    await user.save();

    logger.info(`New user created via admin: ${mobileNumber}`);

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: user
    });

  } catch (error) {
    logger.error('Error creating user:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to create user',
      error: error.message
    });
  }
});

/**
 * @route PUT /api/admin/users/:id
 * @desc Update user
 * @access Public
 */
router.put('/users/:id', async (req, res) => {
  try {
    const { name, email, isActive } = req.body;
    
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { name, email, isActive, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    logger.info(`User updated via admin: ${user.mobileNumber}`);

    res.json({
      success: true,
      message: 'User updated successfully',
      data: user
    });

  } catch (error) {
    logger.error('Error updating user:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to update user',
      error: error.message
    });
  }
});

/**
 * @route DELETE /api/admin/users/:id
 * @desc Delete user
 * @access Public
 */
router.delete('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Delete user's case subscriptions
    await UserCase.deleteMany({ userId: user._id });
    
    // Delete user
    await User.findByIdAndDelete(req.params.id);

    logger.info(`User deleted via admin: ${user.mobileNumber}`);

    res.json({
      success: true,
      message: 'User and associated subscriptions deleted successfully'
    });

  } catch (error) {
    logger.error('Error deleting user:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user',
      error: error.message
    });
  }
});

// ==================== CASE MANAGEMENT ROUTES ====================

/**
 * @route GET /api/admin/cases
 * @desc Get all cases with pagination
 * @access Public
 */
router.get('/cases', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cases = await Case.find()
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Case.countDocuments();

    res.json({
      success: true,
      data: {
        cases,
        pagination: {
          current: page,
          total: Math.ceil(total / limit),
          count: cases.length,
          totalCases: total
        }
      }
    });

  } catch (error) {
    logger.error('Error fetching cases:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cases',
      error: error.message
    });
  }
});

/**
 * @route GET /api/admin/cases/:id
 * @desc Get single case by ID
 * @access Public
 */
router.get('/cases/:id', async (req, res) => {
  try {
    const caseDoc = await Case.findById(req.params.id).lean();
    
    if (!caseDoc) {
      return res.status(404).json({
        success: false,
        message: 'Case not found'
      });
    }

    // Get subscribers for this case
    const subscribers = await UserCase.find({ caseId: caseDoc._id })
      .populate('userId')
      .lean();

    res.json({
      success: true,
      data: {
        case: caseDoc,
        subscribers
      }
    });

  } catch (error) {
    logger.error('Error fetching case:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch case',
      error: error.message
    });
  }
});

/**
 * @route POST /api/admin/cases
 * @desc Add new case by CINO
 * @access Public
 */
router.post('/cases', async (req, res) => {
  try {
    const { cino, numbers } = req.body;

    if (!cino) {
      return res.status(400).json({
        success: false,
        message: 'CINO is required'
      });
    }

    // Check if case already exists
    const existingCase = await Case.findOne({ cino });
    if (existingCase) {
      return res.status(409).json({
        success: false,
        message: 'Case with this CINO already exists',
        data: existingCase
      });
    }

    // Fetch case from API
    logger.info(`Fetching case ${cino} from API...`);
    const caseData = await apiService.fetchSingleCase(cino);
    
    if (!caseData) {
      return res.status(404).json({
        success: false,
        message: 'Case not found in Allahabad High Court records'
      });
    }

    // Create new case in database
    const caseDoc = new Case(caseData);
    caseDoc.dataHash = caseDoc.generateDataHash();
    await caseDoc.save();

    // Optionally store numbers for this CINO
    if (Array.isArray(numbers) && numbers.length > 0) {
      try {
        const unique = [...new Set(numbers.map(n => String(n)))];
        await CinoNumbers.findOneAndUpdate(
          { cino },
          { cino, numbers: unique },
          { upsert: true }
        );
      } catch (err) {
        logger.warn(`Failed to save CINO numbers for ${cino}: ${err.message}`);
      }
    }
    
    logger.info(`New case added via admin: ${cino}`);

    res.status(201).json({
      success: true,
      message: 'Case added successfully',
      data: caseDoc
    });

  } catch (error) {
    logger.error('Error adding case:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to add case',
      error: error.message
    });
  }
});

/**
 * @route PUT /api/admin/cases/:id/refresh
 * @desc Refresh case data from API
 * @access Public
 */
router.put('/cases/:id/refresh', async (req, res) => {
  try {
    const caseDoc = await Case.findById(req.params.id);
    
    if (!caseDoc) {
      return res.status(404).json({
        success: false,
        message: 'Case not found'
      });
    }

    // Fetch fresh data from API
    logger.info(`Refreshing case ${caseDoc.cino} from API...`);
    const freshData = await apiService.fetchSingleCase(caseDoc.cino);
    
    if (!freshData) {
      return res.status(404).json({
        success: false,
        message: 'Case not found in Allahabad High Court records'
      });
    }

    // Update case with fresh data
    Object.assign(caseDoc, freshData);
    caseDoc.dataHash = caseDoc.generateDataHash();
    caseDoc.updatedAt = new Date();
    await caseDoc.save();
    
    logger.info(`Case refreshed via admin: ${caseDoc.cino}`);

    res.json({
      success: true,
      message: 'Case refreshed successfully',
      data: caseDoc
    });

  } catch (error) {
    logger.error('Error refreshing case:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh case',
      error: error.message
    });
  }
});

/**
 * @route DELETE /api/admin/cases/:id
 * @desc Delete case
 * @access Public
 */
router.delete('/cases/:id', async (req, res) => {
  try {
    const caseDoc = await Case.findById(req.params.id);
    
    if (!caseDoc) {
      return res.status(404).json({
        success: false,
        message: 'Case not found'
      });
    }

    // Delete case subscriptions
    await UserCase.deleteMany({ caseId: caseDoc._id });
    
    // Delete case
    await Case.findByIdAndDelete(req.params.id);

    logger.info(`Case deleted via admin: ${caseDoc.cino}`);

    res.json({
      success: true,
      message: 'Case and associated subscriptions deleted successfully'
    });

  } catch (error) {
    logger.error('Error deleting case:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete case',
      error: error.message
    });
  }
});

// ==================== USER-CASE SUBSCRIPTION ROUTES ====================

/**
 * @route GET /api/admin/subscriptions
 * @desc Get all user-case subscriptions with details
 * @access Public
 */
router.get('/subscriptions', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    // Get subscriptions with user and case details
    const subscriptions = await UserCase.find({ isActive: true })
      .populate('userId', 'mobileNumber name email')
      .populate('caseId', 'cino caseTitle caseStatus')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await UserCase.countDocuments({ isActive: true });

    // Format the response to show clear mappings
    const mappings = subscriptions.map(sub => ({
      subscriptionId: sub._id,
      mobileNumber: sub.userId?.mobileNumber || 'N/A',
      userName: sub.userId?.name || 'N/A',
      userEmail: sub.userId?.email || 'N/A',
      cino: sub.cino,
      caseTitle: sub.caseId?.caseTitle || 'N/A',
      caseStatus: sub.caseId?.caseStatus || 'N/A',
      subscriptionType: sub.subscriptionType,
      priority: sub.priority,
      userAlias: sub.userCaseAlias || 'N/A',
      createdAt: sub.createdAt,
      isActive: sub.isActive
    }));

    res.json({
      success: true,
      data: {
        mappings,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit
        }
      }
    });

  } catch (error) {
    logger.error('Error fetching subscriptions:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch subscriptions',
      error: error.message
    });
  }
});

/**
 * @route POST /api/admin/subscriptions
 * @desc Subscribe user to case
 * @access Public
 */
router.post('/subscriptions', async (req, res) => {
  try {
    const { userId, caseId, alias, notes, priority } = req.body;

    if (!userId || !caseId) {
      return res.status(400).json({
        success: false,
        message: 'User ID and Case ID are required'
      });
    }

    // Check if subscription already exists
    const existingSubscription = await UserCase.findOne({ userId, caseId });
    if (existingSubscription) {
      return res.status(409).json({
        success: false,
        message: 'User is already subscribed to this case'
      });
    }

    // Create subscription
    const subscription = new UserCase({
      userId,
      caseId,
      alias,
      notes,
      priority: priority || 'medium',
      isActive: true
    });

    await subscription.save();

    logger.info(`New subscription created via admin: User ${userId} -> Case ${caseId}`);

    res.status(201).json({
      success: true,
      message: 'Subscription created successfully',
      data: subscription
    });

  } catch (error) {
    logger.error('Error creating subscription:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to create subscription',
      error: error.message
    });
  }
});

/**
 * @route DELETE /api/admin/subscriptions/:id
 * @desc Delete subscription
 * @access Public
 */
router.delete('/subscriptions/:id', async (req, res) => {
  try {
    const subscription = await UserCase.findByIdAndDelete(req.params.id);
    
    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }

    logger.info(`Subscription deleted via admin: ${req.params.id}`);

    res.json({
      success: true,
      message: 'Subscription deleted successfully'
    });

  } catch (error) {
    logger.error('Error deleting subscription:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete subscription',
      error: error.message
    });
  }
});

module.exports = router;