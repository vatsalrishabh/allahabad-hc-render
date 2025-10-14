require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const logger = require('./utils/logger');
const cronService = require('./services/cronService');
const apiService = require('./services/apiService');
const whatsappService = require('./services/whatsappService');
const dataComparisonService = require('./services/dataComparisonService');
const monitoringService = require('./services/monitoringService');
const Case = require('./models/Case');
const User = require('./models/User');
const UserCase = require('./models/UserCase');

// Import routes
const userRoutes = require('./routes/users');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory and use admin.html as default
app.use(express.static('public', { index: 'admin.html' }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  next();
});

// Routes
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);

// Database connection
const connectDatabase = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/allahabad-hc-updates';
    logger.info(`Attempting to connect to MongoDB at: ${mongoUri}`);
    
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
      socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
    });
    logger.info('Connected to MongoDB successfully');
  } catch (error) {
    logger.error('MongoDB connection failed:', error.message);
    logger.info('Continuing without MongoDB connection for testing purposes');
    // Don't exit for testing - just log the error
  }
};

// API Routes

// Health check endpoint
app.get('/health', (req, res) => {
  try {
    const status = monitoringService.getStatus();
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      monitoring: status,
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
  } catch (error) {
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      monitoring: { status: 'not_initialized' },
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
  }
});

// Get monitoring status
app.get('/api/status', (req, res) => {
  try {
    const status = monitoringService.getStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('Error getting status:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start monitoring
app.post('/api/monitoring/start', async (req, res) => {
  try {
    const { schedule } = req.body;
    await monitoringService.startMonitoring(schedule);
    
    logger.info('Monitoring started via API');
    res.json({
      success: true,
      message: 'Monitoring started successfully'
    });
  } catch (error) {
    logger.error('Error starting monitoring:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Stop monitoring
app.post('/api/monitoring/stop', (req, res) => {
  try {
    monitoringService.stopMonitoring();
    
    logger.info('Monitoring stopped via API');
    res.json({
      success: true,
      message: 'Monitoring stopped successfully'
    });
  } catch (error) {
    logger.error('Error stopping monitoring:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Manual monitoring run
app.post('/api/monitoring/run', async (req, res) => {
  try {
    logger.info('Manual monitoring run triggered via API');
    await monitoringService.runMonitoringCycle();
    
    res.json({
      success: true,
      message: 'Monitoring cycle completed successfully'
    });
  } catch (error) {
    logger.error('Error running monitoring cycle:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add case number to monitoring
app.post('/api/cases/add', (req, res) => {
  try {
    const { caseNumber } = req.body;
    
    if (!caseNumber) {
      return res.status(400).json({
        success: false,
        error: 'Case number is required'
      });
    }
    
    cronService.addCaseNumber(caseNumber);
    
    logger.info(`Case number added via API: ${caseNumber}`);
    res.json({
      success: true,
      message: `Case number ${caseNumber} added to monitoring`
    });
  } catch (error) {
    logger.error('Error adding case number:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Remove case number from monitoring
app.delete('/api/cases/:caseNumber', (req, res) => {
  try {
    const { caseNumber } = req.params;
    cronService.removeCaseNumber(caseNumber);
    
    logger.info(`Case number removed via API: ${caseNumber}`);
    res.json({
      success: true,
      message: `Case number ${caseNumber} removed from monitoring`
    });
  } catch (error) {
    logger.error('Error removing case number:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get all monitored cases from database
app.get('/api/cases', async (req, res) => {
  try {
    const { page = 1, limit = 10, status, caseNumber } = req.query;
    
    const query = {};
    if (status) query.status = new RegExp(status, 'i');
    if (caseNumber) query.caseNumber = new RegExp(caseNumber, 'i');
    
    const cases = await Case.find(query)
      .sort({ lastUpdated: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-rawHtmlData'); // Exclude raw HTML for performance
    
    const total = await Case.countDocuments(query);
    
    res.json({
      success: true,
      data: {
        cases,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    logger.error('Error fetching cases:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get specific case details
app.get('/api/cases/:caseNumber', async (req, res) => {
  try {
    const { caseNumber } = req.params;
    const caseData = await Case.findOne({ caseNumber });
    
    if (!caseData) {
      return res.status(404).json({
        success: false,
        error: 'Case not found'
      });
    }
    
    res.json({
      success: true,
      data: caseData
    });
  } catch (error) {
    logger.error('Error fetching case details:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Send test WhatsApp notification
app.post('/api/test/whatsapp', async (req, res) => {
  try {
    const { phoneNumber, phoneNumbers, message } = req.body;
    
    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Message is required'
      });
    }
    
    // Support both single number and multiple numbers
    let numbers = [];
    if (phoneNumbers && Array.isArray(phoneNumbers)) {
      numbers = phoneNumbers;
    } else if (phoneNumber) {
      numbers = [phoneNumber];
    } else {
      return res.status(400).json({
        success: false,
        error: 'Phone number(s) required. Use "phoneNumber" for single or "phoneNumbers" array for multiple'
      });
    }
    
    const result = await whatsappService.sendMessage(numbers, message);
    
    logger.info(`Test WhatsApp message sent to ${numbers.length} recipient(s)`);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error sending test WhatsApp message:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Update monitoring schedule
app.put('/api/monitoring/schedule', (req, res) => {
  try {
    const { schedule } = req.body;
    
    if (!schedule) {
      return res.status(400).json({
        success: false,
        error: 'Schedule is required'
      });
    }
    
    cronService.updateSchedule(schedule);
    
    logger.info(`Monitoring schedule updated via API: ${schedule}`);
    res.json({
      success: true,
      message: 'Schedule updated successfully'
    });
  } catch (error) {
    logger.error('Error updating schedule:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get system statistics
app.get('/api/stats', async (req, res) => {
  try {
    const totalCases = await Case.countDocuments();
    const newCasesToday = await Case.countDocuments({
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
    });
    const updatedToday = await Case.countDocuments({
      lastUpdated: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
    });
    const unnotifiedCases = await Case.countDocuments({ isNotified: false });
    
    const status = cronService.getStatus();
    
    res.json({
      success: true,
      data: {
        totalCases,
        newCasesToday,
        updatedToday,
        unnotifiedCases,
        monitoring: status
      }
    });
  } catch (error) {
    logger.error('Error fetching statistics:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', error.message, { stack: error.stack });
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Graceful shutdown
const gracefulShutdown = () => {
  logger.info('Received shutdown signal, closing server gracefully...');
  
  // Stop monitoring
  try {
    monitoringService.stopMonitoring();
    logger.info('Monitoring service stopped');
  } catch (error) {
    logger.error('Error stopping monitoring service:', error.message);
  }
  
  // Close database connection
  mongoose.connection.close(() => {
    logger.info('MongoDB connection closed');
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
const startServer = async () => {
  try {
    // Connect to database
    await connectDatabase();
    
    // Start the server
    app.listen(PORT, async () => {
      logger.info(`Server started on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      
      // Auto-start monitoring if configured
      if (process.env.AUTO_START_MONITORING === 'true') {
        try {
          await monitoringService.startMonitoring();
          logger.info('Auto-started monitoring service on server startup');
        } catch (error) {
          logger.error('Failed to auto-start monitoring:', error.message);
        }
      }
    });
    
  } catch (error) {
    logger.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', {
    message: error.message,
    stack: error.stack,
    name: error.name
  });
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the application
startServer();

module.exports = app;