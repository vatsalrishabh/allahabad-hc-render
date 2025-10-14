const mongoose = require('mongoose');

const caseSchema = new mongoose.Schema({
  // Primary identifiers
  cino: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  cnr: {
    type: String,
    required: true,
    index: true
  },
  
  // Filing details
  filingNumber: {
    type: String,
    required: true
  },
  filingDate: {
    type: Date,
    required: true
  },
  registrationDate: {
    type: Date,
    required: true
  },
  
  // Case basic info
  caseStatus: {
    type: String,
    required: true
  },
  caseTitle: {
    type: String,
    required: true
  },
  
  // Hearing information
  firstHearingDate: {
    type: Date
  },
  nextHearingDate: {
    type: Date
  },
  stageOfCase: {
    type: String,
    default: ''
  },
  
  // Court details
  benchType: {
    type: String,
    default: ''
  },
  causelistType: {
    type: String,
    default: ''
  },
  state: {
    type: String,
    default: ''
  },
  district: {
    type: String,
    default: ''
  },
  coram: {
    type: String,
    default: ''
  },
  
  // Parties information
  petitioners: [{
    name: String,
    advocate: {
      name: String,
      code: String
    }
  }],
  respondents: [{
    name: String,
    advocate: {
      name: String,
      code: String
    }
  }],
  
  // Legal acts and sections
  acts: [{
    actName: String,
    sections: [String]
  }],
  
  // Category details
  category: {
    main: String,
    sub: String
  },
  
  // Lower court details
  lowerCourt: {
    caseNumber: String,
    year: String,
    decisionDate: Date,
    district: String
  },
  
  // Crime details (if applicable)
  crimeDetails: {
    district: String,
    policeStation: String,
    crimeNumber: String,
    year: String
  },
  
  // IA (Interlocutory Application) details
  iaApplications: [{
    applicationNumber: String,
    classification: String,
    party: String,
    appliedBy: String,
    filingDate: Date,
    nextDate: Date,
    disposalDate: Date,
    status: String
  }],
  
  // Listing history
  listingHistory: [{
    causeListType: String,
    justice: String,
    benchId: String,
    listingDate: Date,
    shortOrder: String
  }],
  
  // Change tracking
  dataHash: {
    type: String,
    required: true,
    index: true
  },
  previousDataHash: {
    type: String
  },
  changeHistory: [{
    field: String,
    oldValue: mongoose.Schema.Types.Mixed,
    newValue: mongoose.Schema.Types.Mixed,
    changedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Notification tracking
  lastNotificationSent: {
    type: Date
  },
  notificationCount: {
    type: Number,
    default: 0
  },
  
  // Raw data for backup
  rawApiResponse: {
    type: String,
    default: ''
  },
  
  // Status tracking
  isActive: {
    type: Boolean,
    default: true
  },
  lastApiCheck: {
    type: Date,
    default: Date.now
  },
  apiCheckCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual to get users subscribed to this case
caseSchema.virtual('subscribedUsers', {
  ref: 'UserCase',
  localField: '_id',
  foreignField: 'caseId'
});

// Indexes for efficient queries
caseSchema.index({ cino: 1 });
caseSchema.index({ cnr: 1 });
caseSchema.index({ dataHash: 1 });
caseSchema.index({ isActive: 1, lastApiCheck: 1 });
caseSchema.index({ nextHearingDate: 1 });
caseSchema.index({ filingDate: -1 });
caseSchema.index({ 'petitioners.name': 'text', 'respondents.name': 'text', caseTitle: 'text' });

// Method to generate hash for change detection
caseSchema.methods.generateDataHash = function() {
  const crypto = require('crypto');
  const dataString = JSON.stringify({
    caseStatus: this.caseStatus,
    nextHearingDate: this.nextHearingDate,
    stageOfCase: this.stageOfCase,
    coram: this.coram,
    iaApplications: this.iaApplications,
    listingHistory: this.listingHistory?.slice(-5) // Only last 5 entries for hash
  });
  return crypto.createHash('md5').update(dataString).digest('hex');
};

// Method to detect changes and record them
caseSchema.methods.detectAndRecordChanges = function(newData) {
  const changes = [];
  const fieldsToCheck = [
    'caseStatus', 'nextHearingDate', 'stageOfCase', 'coram',
    'iaApplications', 'listingHistory'
  ];
  
  fieldsToCheck.forEach(field => {
    const oldValue = this[field];
    const newValue = newData[field];
    
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes.push({
        field,
        oldValue,
        newValue,
        changedAt: new Date()
      });
    }
  });
  
  if (changes.length > 0) {
    this.changeHistory.push(...changes);
    this.previousDataHash = this.dataHash;
    
    // Keep only last 50 changes to prevent document bloat
    if (this.changeHistory.length > 50) {
      this.changeHistory = this.changeHistory.slice(-50);
    }
  }
  
  return changes;
};

// Method to update notification stats
caseSchema.methods.recordNotificationSent = function() {
  this.lastNotificationSent = new Date();
  this.notificationCount += 1;
  return this.save();
};

// Static method to find cases needing API check
caseSchema.statics.findCasesForApiCheck = function(batchSize = 50) {
  const checkInterval = parseInt(process.env.CASE_CHECK_INTERVAL_MINUTES) || 30;
  const cutoffTime = new Date(Date.now() - checkInterval * 60 * 1000);
  
  return this.find({
    isActive: true,
    $or: [
      { lastApiCheck: { $lt: cutoffTime } },
      { lastApiCheck: { $exists: false } }
    ]
  })
  .sort({ lastApiCheck: 1 })
  .limit(batchSize);
};

// Static method to find cases with recent changes
caseSchema.statics.findCasesWithRecentChanges = function(hoursAgo = 24) {
  const cutoffTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  
  return this.find({
    'changeHistory.changedAt': { $gte: cutoffTime }
  }).populate('subscribedUsers');
};

// Static method to get case statistics
caseSchema.statics.getCaseStatistics = function() {
  return this.aggregate([
    {
      $group: {
        _id: null,
        totalCases: { $sum: 1 },
        activeCases: {
          $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
        },
        casesWithChanges: {
          $sum: { $cond: [{ $gt: [{ $size: '$changeHistory' }, 0] }, 1, 0] }
        },
        totalNotifications: { $sum: '$notificationCount' },
        avgApiChecks: { $avg: '$apiCheckCount' }
      }
    }
  ]);
};

module.exports = mongoose.model('Case', caseSchema);