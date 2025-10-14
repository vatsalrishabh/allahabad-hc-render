const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  mobileNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    validate: {
      validator: function(v) {
        return /^[6-9]\d{9}$/.test(v); // Indian mobile number validation
      },
      message: 'Please enter a valid Indian mobile number'
    }
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    validate: {
      validator: function(v) {
        return !v || /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(v);
      },
      message: 'Please enter a valid email address'
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  notificationPreferences: {
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
      default: true
    }
  },
  registrationDate: {
    type: Date,
    default: Date.now
  },
  lastNotificationSent: {
    type: Date
  },
  totalNotificationsSent: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual to get user's cases
userSchema.virtual('cases', {
  ref: 'UserCase',
  localField: '_id',
  foreignField: 'userId'
});

// Index for efficient queries
userSchema.index({ mobileNumber: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ registrationDate: -1 });

// Instance method to check if user wants specific notification type
userSchema.methods.wantsNotification = function(type) {
  return this.isActive && this.notificationPreferences[type];
};

// Instance method to update notification stats
userSchema.methods.recordNotificationSent = function() {
  this.lastNotificationSent = new Date();
  this.totalNotificationsSent += 1;
  return this.save();
};

// Static method to find active users for a case
userSchema.statics.findActiveUsersForCase = function(caseId) {
  return this.aggregate([
    {
      $lookup: {
        from: 'usercases',
        localField: '_id',
        foreignField: 'userId',
        as: 'userCases'
      }
    },
    {
      $match: {
        isActive: true,
        'userCases.caseId': mongoose.Types.ObjectId(caseId),
        'userCases.isActive': true
      }
    },
    {
      $project: {
        mobileNumber: 1,
        name: 1,
        notificationPreferences: 1
      }
    }
  ]);
};

module.exports = mongoose.model('User', userSchema);