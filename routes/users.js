const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

// Import models
const User = require('../models/User');
const Case = require('../models/Case');
const UserCase = require('../models/UserCase');

// Import services
const apiService = require('../services/apiService');
const whatsappService = require('../services/whatsappService');

/**
 * @route POST /api/users/register
 * @desc Register a new user
 * @access Public
 */
router.post('/register', async (req, res) => {
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
        message: 'User with this mobile number already exists',
        userId: existingUser._id
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

    // Send welcome message
    const welcomeMessage = `🎉 Welcome to Allahabad High Court Monitor!\n\n` +
      `Hi ${name},\n\n` +
      `Your account has been successfully created. You can now subscribe to case updates.\n\n` +
      `📱 Mobile: ${mobileNumber}\n` +
      `📧 Email: ${email || 'Not provided'}\n\n` +
      `To subscribe to a case, use the subscription API or contact support.\n\n` +
      `🤖 Allahabad HC Monitor`;

    try {
      await whatsappService.sendMessage(mobileNumber, welcomeMessage);
    } catch (whatsappError) {
      logger.warn(`Failed to send welcome message to ${mobileNumber}:`, whatsappError.message);
    }

    logger.info(`New user registered: ${mobileNumber}`);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        id: user._id,
        mobileNumber: user.mobileNumber,
        name: user.name,
        email: user.email,
        isActive: user.isActive,
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    logger.error('Error registering user:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * @route POST /api/users/:userId/subscribe
 * @desc Subscribe user to a case
 * @access Public
 */
router.post('/:userId/subscribe', async (req, res) => {
  try {
    const { userId } = req.params;
    const { cino, alias, notes, priority, notificationTypes } = req.body;

    // Validate required fields
    if (!cino) {
      return res.status(400).json({
        success: false,
        message: 'CINO is required'
      });
    }

    // Validate user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'User account is inactive'
      });
    }

    // Check if case exists, if not fetch from API and create
    let caseDoc = await Case.findOne({ cino });
    
    if (!caseDoc) {
      logger.info(`Case ${cino} not found in database, fetching from API...`);
      
      try {
        const caseData = await apiService.fetchSingleCase(cino);
        
        if (!caseData) {
          return res.status(404).json({
            success: false,
            message: 'Case not found in Allahabad High Court records'
          });
        }

        // Create new case in database
        caseDoc = new Case(caseData);
        caseDoc.dataHash = caseDoc.generateDataHash();
        await caseDoc.save();
        
        logger.info(`New case created in database: ${cino}`);
        
      } catch (apiError) {
        logger.error(`Error fetching case ${cino} from API:`, apiError.message);
        return res.status(503).json({
          success: false,
          message: 'Unable to fetch case details from court API',
          error: apiError.message
        });
      }
    }

    // Check if subscription already exists
    const existingSubscription = await UserCase.findOne({
      userId: userId,
      caseId: caseDoc._id
    });

    if (existingSubscription) {
      if (existingSubscription.isActive) {
        return res.status(409).json({
          success: false,
          message: 'User is already subscribed to this case',
          subscriptionId: existingSubscription._id
        });
      } else {
        // Reactivate existing subscription
        existingSubscription.isActive = true;
        existingSubscription.alias = alias || existingSubscription.alias;
        existingSubscription.notes = notes || existingSubscription.notes;
        existingSubscription.priority = priority || existingSubscription.priority;
        
        if (notificationTypes) {
          existingSubscription.notificationSettings = {
            ...existingSubscription.notificationSettings,
            ...notificationTypes
          };
        }
        
        await existingSubscription.save();
        
        return res.status(200).json({
          success: true,
          message: 'Subscription reactivated successfully',
          subscription: existingSubscription
        });
      }
    }

    // Create new subscription
    const subscription = new UserCase({
      userId: userId,
      caseId: caseDoc._id,
      cino: caseDoc.cino,
      subscriptionType: 'manual',
      isActive: true,
      alias: alias || caseDoc.caseTitle,
      notes: notes || '',
      priority: priority || 'medium',
      notificationSettings: {
        statusChanges: true,
        hearingDates: true,
        orderUpdates: true,
        generalUpdates: false,
        ...notificationTypes
      }
    });

    await subscription.save();

    // Send confirmation message
    const confirmationMessage = `✅ *Subscription Confirmed*\n\n` +
      `You are now subscribed to case updates:\n\n` +
      `📋 *Case:* ${alias || caseDoc.caseTitle}\n` +
      `🔢 *CINO:* ${cino}\n` +
      `📱 *Priority:* ${priority || 'Medium'}\n\n` +
      `You will receive notifications for:\n` +
      `${subscription.notificationSettings.statusChanges ? '✅' : '❌'} Status changes\n` +
      `${subscription.notificationSettings.hearingDates ? '✅' : '❌'} Hearing date updates\n` +
      `${subscription.notificationSettings.orderUpdates ? '✅' : '❌'} Order updates\n` +
      `${subscription.notificationSettings.generalUpdates ? '✅' : '❌'} General updates\n\n` +
      `🤖 Allahabad HC Monitor`;

    try {
      await whatsappService.sendMessage(user.mobileNumber, confirmationMessage);
    } catch (whatsappError) {
      logger.warn(`Failed to send confirmation message to ${user.mobileNumber}:`, whatsappError.message);
    }

    logger.info(`User ${userId} subscribed to case ${cino}`);

    res.status(201).json({
      success: true,
      message: 'Successfully subscribed to case updates',
      subscription: {
        id: subscription._id,
        cino: subscription.cino,
        alias: subscription.alias,
        priority: subscription.priority,
        notificationSettings: subscription.notificationSettings,
        subscriptionDate: subscription.subscriptionDate
      },
      case: {
        id: caseDoc._id,
        cino: caseDoc.cino,
        caseTitle: caseDoc.caseTitle,
        caseStatus: caseDoc.caseStatus,
        nextHearingDate: caseDoc.nextHearingDate
      }
    });

  } catch (error) {
    logger.error('Error creating subscription:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * @route GET /api/users/:userId/subscriptions
 * @desc Get user's case subscriptions
 * @access Public
 */
router.get('/:userId/subscriptions', async (req, res) => {
  try {
    const { userId } = req.params;
    const { active } = req.query;

    // Validate user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Build query
    const query = { userId };
    if (active !== undefined) {
      query.isActive = active === 'true';
    }

    // Get subscriptions with case details
    const subscriptions = await UserCase.find(query)
      .populate('caseId', 'cino cnr caseTitle caseStatus nextHearingDate stageOfCase lastUpdated')
      .sort({ subscriptionDate: -1 });

    const formattedSubscriptions = subscriptions.map(sub => ({
      id: sub._id,
      cino: sub.cino,
      alias: sub.alias,
      priority: sub.priority,
      isActive: sub.isActive,
      subscriptionDate: sub.subscriptionDate,
      notificationSettings: sub.notificationSettings,
      notificationCount: sub.notificationCount,
      lastNotificationSent: sub.lastNotificationSent,
      case: sub.caseId ? {
        id: sub.caseId._id,
        cino: sub.caseId.cino,
        cnr: sub.caseId.cnr,
        title: sub.caseId.caseTitle,
        status: sub.caseId.caseStatus,
        nextHearingDate: sub.caseId.nextHearingDate,
        stageOfCase: sub.caseId.stageOfCase,
        lastUpdated: sub.caseId.lastUpdated
      } : null
    }));

    res.json({
      success: true,
      subscriptions: formattedSubscriptions,
      total: formattedSubscriptions.length
    });

  } catch (error) {
    logger.error('Error fetching user subscriptions:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * @route PUT /api/users/:userId/subscriptions/:subscriptionId
 * @desc Update subscription settings
 * @access Public
 */
router.put('/:userId/subscriptions/:subscriptionId', async (req, res) => {
  try {
    const { userId, subscriptionId } = req.params;
    const { alias, notes, priority, notificationSettings, isActive } = req.body;

    // Validate user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Find and update subscription
    const subscription = await UserCase.findOne({
      _id: subscriptionId,
      userId: userId
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }

    // Update fields
    if (alias !== undefined) subscription.alias = alias;
    if (notes !== undefined) subscription.notes = notes;
    if (priority !== undefined) subscription.priority = priority;
    if (isActive !== undefined) subscription.isActive = isActive;
    
    if (notificationSettings) {
      subscription.notificationSettings = {
        ...subscription.notificationSettings,
        ...notificationSettings
      };
    }

    await subscription.save();

    logger.info(`Subscription ${subscriptionId} updated for user ${userId}`);

    res.json({
      success: true,
      message: 'Subscription updated successfully',
      subscription: {
        id: subscription._id,
        cino: subscription.cino,
        alias: subscription.alias,
        priority: subscription.priority,
        isActive: subscription.isActive,
        notificationSettings: subscription.notificationSettings
      }
    });

  } catch (error) {
    logger.error('Error updating subscription:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * @route DELETE /api/users/:userId/subscriptions/:subscriptionId
 * @desc Unsubscribe from case updates
 * @access Public
 */
router.delete('/:userId/subscriptions/:subscriptionId', async (req, res) => {
  try {
    const { userId, subscriptionId } = req.params;

    // Validate user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Find subscription
    const subscription = await UserCase.findOne({
      _id: subscriptionId,
      userId: userId
    }).populate('caseId', 'cino caseTitle');

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }

    // Deactivate subscription (soft delete)
    subscription.isActive = false;
    await subscription.save();

    // Send unsubscribe confirmation
    const confirmationMessage = `❌ *Unsubscribed*\n\n` +
      `You have been unsubscribed from:\n\n` +
      `📋 *Case:* ${subscription.alias}\n` +
      `🔢 *CINO:* ${subscription.cino}\n\n` +
      `You will no longer receive updates for this case.\n\n` +
      `🤖 Allahabad HC Monitor`;

    try {
      await whatsappService.sendMessage(user.mobileNumber, confirmationMessage);
    } catch (whatsappError) {
      logger.warn(`Failed to send unsubscribe confirmation to ${user.mobileNumber}:`, whatsappError.message);
    }

    logger.info(`User ${userId} unsubscribed from case ${subscription.cino}`);

    res.json({
      success: true,
      message: 'Successfully unsubscribed from case updates'
    });

  } catch (error) {
    logger.error('Error unsubscribing user:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * @route GET /api/users/:userId/profile
 * @desc Get user profile
 * @access Public
 */
router.get('/:userId/profile', async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get subscription statistics
    const subscriptionStats = await UserCase.aggregate([
      { $match: { userId: user._id } },
      {
        $group: {
          _id: null,
          totalSubscriptions: { $sum: 1 },
          activeSubscriptions: {
            $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
          },
          totalNotifications: { $sum: '$notificationCount' }
        }
      }
    ]);

    const stats = subscriptionStats[0] || {
      totalSubscriptions: 0,
      activeSubscriptions: 0,
      totalNotifications: 0
    };

    res.json({
      success: true,
      user: {
        id: user._id,
        mobileNumber: user.mobileNumber,
        name: user.name,
        email: user.email,
        isActive: user.isActive,
        notificationPreferences: user.notificationPreferences,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      },
      statistics: stats
    });

  } catch (error) {
    logger.error('Error fetching user profile:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * @route PUT /api/users/:userId/profile
 * @desc Update user profile
 * @access Public
 */
router.put('/:userId/profile', async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, email, notificationPreferences } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update fields
    if (name !== undefined) user.name = name;
    if (email !== undefined) user.email = email;
    if (notificationPreferences !== undefined) {
      user.notificationPreferences = {
        ...user.notificationPreferences,
        ...notificationPreferences
      };
    }

    await user.save();

    logger.info(`User profile updated: ${userId}`);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        mobileNumber: user.mobileNumber,
        name: user.name,
        email: user.email,
        notificationPreferences: user.notificationPreferences
      }
    });

  } catch (error) {
    logger.error('Error updating user profile:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * @route POST /api/users/search
 * @desc Search for cases by CINO or case number
 * @access Public
 */
router.post('/search', async (req, res) => {
  try {
    const { cino, caseNumber } = req.body;

    if (!cino && !caseNumber) {
      return res.status(400).json({
        success: false,
        message: 'CINO or case number is required'
      });
    }

    let caseDoc = null;

    // Search in database first
    if (cino) {
      caseDoc = await Case.findOne({ cino });
    } else if (caseNumber) {
      caseDoc = await Case.findOne({ caseNumber });
    }

    // If not found in database, try API
    if (!caseDoc && cino) {
      try {
        const caseData = await apiService.fetchSingleCase(cino);
        if (caseData) {
          caseDoc = {
            ...caseData,
            isFromApi: true
          };
        }
      } catch (apiError) {
        logger.warn(`API search failed for CINO ${cino}:`, apiError.message);
      }
    }

    if (!caseDoc) {
      return res.status(404).json({
        success: false,
        message: 'Case not found'
      });
    }

    res.json({
      success: true,
      case: {
        cino: caseDoc.cino,
        cnr: caseDoc.cnr,
        caseNumber: caseDoc.caseNumber,
        caseTitle: caseDoc.caseTitle,
        caseStatus: caseDoc.caseStatus,
        nextHearingDate: caseDoc.nextHearingDate,
        stageOfCase: caseDoc.stageOfCase,
        petitioners: caseDoc.petitioners,
        respondents: caseDoc.respondents,
        isFromApi: caseDoc.isFromApi || false
      }
    });

  } catch (error) {
    logger.error('Error searching for case:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router;