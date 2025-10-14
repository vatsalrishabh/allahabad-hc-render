const mongoose = require('mongoose');

const userCaseSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  caseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Case',
    required: true,
    index: true
  },
  cino: {
    type: String,
    required: true,
    index: true
  },
  
  // Subscription details
  subscriptionType: {
    type: String,
    enum: ['full', 'status_only', 'hearing_only', 'order_only'],
    default: 'full'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  
  // User-specific case details
  userCaseAlias: {
    type: String,
    trim: true,
    maxlength: 100
  },
  userNotes: {
    type: String,
    trim: true,
    maxlength: 500
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  
  // Notification preferences for this specific case
  notificationSettings: {
    statusChange: {
      type: Boolean,
      default: true
    },
    hearingDate: {
      type: Boolean,
      default: true
    },
    orderUpdate: {
      type: Boolean,
      default: true
    },
    listingUpdate: {
      type: Boolean,
      default: false
    },
    iaUpdate: {
      type: Boolean,
      default: false
    }
  },
  
  // Tracking
  subscriptionDate: {
    type: Date,
    default: Date.now
  },
  lastNotificationSent: {
    type: Date
  },
  notificationCount: {
    type: Number,
    default: 0
  },
  
  // Additional metadata
  source: {
    type: String,
    enum: ['manual', 'api', 'bulk_import', 'admin'],
    default: 'manual'
  },
  tags: [{
    type: String,
    trim: true,
    maxlength: 50
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes for efficient queries
userCaseSchema.index({ userId: 1, caseId: 1 }, { unique: true });
userCaseSchema.index({ userId: 1, isActive: 1 });
userCaseSchema.index({ caseId: 1, isActive: 1 });
userCaseSchema.index({ cino: 1, userId: 1 });
userCaseSchema.index({ subscriptionDate: -1 });
userCaseSchema.index({ priority: 1, isActive: 1 });

// Virtual to populate user details
userCaseSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

// Virtual to populate case details
userCaseSchema.virtual('case', {
  ref: 'Case',
  localField: 'caseId',
  foreignField: '_id',
  justOne: true
});

// Instance method to check if user wants specific notification for this case
userCaseSchema.methods.wantsNotification = function(type) {
  return this.isActive && this.notificationSettings[type];
};

// Instance method to record notification sent
userCaseSchema.methods.recordNotificationSent = function() {
  this.lastNotificationSent = new Date();
  this.notificationCount += 1;
  return this.save();
};

// Instance method to update notification preferences
userCaseSchema.methods.updateNotificationSettings = function(settings) {
  Object.keys(settings).forEach(key => {
    if (this.notificationSettings.hasOwnProperty(key)) {
      this.notificationSettings[key] = settings[key];
    }
  });
  return this.save();
};

// Static method to find active subscriptions for a case
userCaseSchema.statics.findActiveSubscriptionsForCase = function(caseId) {
  return this.find({
    caseId: caseId,
    isActive: true
  }).populate('user', 'mobileNumber name notificationPreferences');
};

// Static method to find user's active case subscriptions
userCaseSchema.statics.findUserActiveSubscriptions = function(userId) {
  return this.find({
    userId: userId,
    isActive: true
  }).populate('case', 'cino cnr caseTitle caseStatus nextHearingDate');
};

// Static method to find subscriptions by CINO
userCaseSchema.statics.findSubscriptionsByCino = function(cino) {
  return this.find({
    cino: cino,
    isActive: true
  }).populate('user', 'mobileNumber name')
    .populate('case', 'caseTitle caseStatus');
};

// Static method to get user subscription statistics
userCaseSchema.statics.getUserSubscriptionStats = function(userId) {
  return this.aggregate([
    { $match: { userId: mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: '$isActive',
        count: { $sum: 1 },
        totalNotifications: { $sum: '$notificationCount' }
      }
    }
  ]);
};

// Static method to get case subscription statistics
userCaseSchema.statics.getCaseSubscriptionStats = function(caseId) {
  return this.aggregate([
    { $match: { caseId: mongoose.Types.ObjectId(caseId) } },
    {
      $group: {
        _id: '$isActive',
        count: { $sum: 1 },
        totalNotifications: { $sum: '$notificationCount' }
      }
    }
  ]);
};

// Static method to find high priority cases for a user
userCaseSchema.statics.findHighPriorityCases = function(userId) {
  return this.find({
    userId: userId,
    isActive: true,
    priority: { $in: ['high', 'urgent'] }
  }).populate('case', 'cino caseTitle caseStatus nextHearingDate');
};

// Static method to bulk update notification settings
userCaseSchema.statics.bulkUpdateNotificationSettings = function(userId, settings) {
  return this.updateMany(
    { userId: userId, isActive: true },
    { $set: { notificationSettings: settings } }
  );
};

// Pre-save middleware to ensure CINO is set from case
userCaseSchema.pre('save', async function(next) {
  if (this.isNew && !this.cino && this.caseId) {
    try {
      const Case = mongoose.model('Case');
      const caseDoc = await Case.findById(this.caseId).select('cino');
      if (caseDoc) {
        this.cino = caseDoc.cino;
      }
    } catch (error) {
      console.error('Error setting CINO in UserCase:', error);
    }
  }
  next();
});

module.exports = mongoose.model('UserCase', userCaseSchema);