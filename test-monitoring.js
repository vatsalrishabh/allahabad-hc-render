const mongoose = require('mongoose');
const User = require('./models/User');
const Case = require('./models/Case');
const UserCase = require('./models/UserCase');

async function createTestData() {
  try {
    // Connect to MongoDB
    await mongoose.connect('mongodb://localhost:27017/allahabad-hc-updates');
    console.log('Connected to MongoDB');

    // Find or create test user
    let user = await User.findOne({ mobileNumber: '8123573669' });
    if (!user) {
      user = new User({
        name: 'Test User',
        email: 'test@example.com',
        mobileNumber: '8123573669',
        isActive: true
      });
      await user.save();
      console.log('Created test user:', user._id);
    } else {
      console.log('Found existing user:', user._id);
    }

    // Create or update test case
    let testCase = await Case.findOne({ cino: '804692' });
    if (!testCase) {
      testCase = new Case({
        cino: '804692',
        cnr: 'AIHC010001012024',
        filingNumber: 'W.P.(C) No. 804692 of 2024',
        filingDate: new Date('2024-01-01'),
        registrationDate: new Date('2024-01-02'),
        caseStatus: 'Pending',
        caseTitle: 'Test Case vs State of UP',
        petitioners: [{ name: 'Test Petitioner', type: 'Individual' }],
        respondents: [{ name: 'State of UP', type: 'Government' }],
        nextHearingDate: new Date('2024-12-01'),
        stageOfCase: 'Admission',
        benchType: 'Division Bench',
        lastApiCheck: new Date(),
        apiCheckCount: 1
      });
      testCase.dataHash = testCase.generateDataHash();
      await testCase.save();
      console.log('Created test case:', testCase._id);
    } else {
      console.log('Found existing case:', testCase._id);
    }

    // Create UserCase subscription
    let userCase = await UserCase.findOne({ 
      userId: user._id, 
      caseId: testCase._id 
    });
    
    if (!userCase) {
      userCase = new UserCase({
        userId: user._id,
        caseId: testCase._id,
        cino: '804692',
        alias: 'Test Case 804692',
        priority: 'high',
        notificationTypes: ['whatsapp', 'email'],
        isActive: true
      });
      await userCase.save();
      console.log('Created UserCase subscription:', userCase._id);
    } else {
      console.log('Found existing subscription:', userCase._id);
    }

    console.log('\nTest data created successfully!');
    console.log('User ID:', user._id);
    console.log('Case ID:', testCase._id);
    console.log('UserCase ID:', userCase._id);
    console.log('CINO:', testCase.cino);
    console.log('Mobile Number:', user.mobileNumber);

  } catch (error) {
    console.error('Error creating test data:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

createTestData();