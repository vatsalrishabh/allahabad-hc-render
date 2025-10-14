# Allahabad High Court Case Monitoring System

A comprehensive Node.js backend service that monitors case status updates from the Allahabad High Court and sends real-time WhatsApp notifications to subscribed users.

## Features

- **Real-time Case Monitoring**: Automatically fetches case updates from Allahabad HC API
- **Intelligent Change Detection**: Detects significant changes in case status, hearing dates, and orders
- **WhatsApp Notifications**: Sends personalized notifications to subscribed users
- **User Management**: Complete user registration and case subscription system
- **Efficient API Usage**: Minimizes API calls through smart caching and change detection
- **Comprehensive Logging**: Detailed logging for monitoring and debugging

## System Architecture

### Models
- **User**: Stores user information and notification preferences
- **Case**: Stores complete case details from Allahabad HC
- **UserCase**: Maps users to their subscribed cases with notification settings

### Services
- **ApiService**: Handles communication with Allahabad HC API
- **ChangeDetectionService**: Intelligent detection of case changes
- **MonitoringService**: Orchestrates the monitoring process
- **WhatsAppService**: Manages WhatsApp notifications
- **DataComparisonService**: Compares case data for changes

## API Endpoints

### User Management
- `POST /api/users/register` - Register a new user
- `POST /api/users/:userId/subscribe` - Subscribe to a case
- `GET /api/users/:userId/subscriptions` - Get user subscriptions
- `PUT /api/users/:userId/subscriptions/:subscriptionId` - Update subscription
- `DELETE /api/users/:userId/subscriptions/:subscriptionId` - Unsubscribe from case
- `GET /api/users/:userId/profile` - Get user profile
- `PUT /api/users/:userId/profile` - Update user profile
- `POST /api/users/search` - Search for cases

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Court Website │    │   MongoDB       │    │   WhatsApp API  │
│                 │    │   Database      │    │                 │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          │ Fetch HTML           │ Store/Compare        │ Send Notifications
          │                      │                      │
          ▼                      ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Node.js Backend Service                     │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │ API Service │ │ Cron Service│ │ Comparison  │ │ WhatsApp  │ │
│  │             │ │             │ │ Service     │ │ Service   │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd AllahabadHC-UPDates
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start MongoDB**
   ```bash
   # Make sure MongoDB is running on your system
   mongod
   ```

5. **Run the application**
   ```bash
   # Development mode
   npm run dev
   
   # Production mode
   npm start
   ```

## Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PORT` | Server port | No | 3000 |
| `MONGODB_URI` | MongoDB connection string | Yes | mongodb://localhost:27017/allahabad-hc-updates |
| `WHATSAPP_API_KEY` | WhatsApp API key for bulk messaging | Yes | - |
| `WHATSAPP_RECIPIENT_NUMBERS` | Comma-separated recipient numbers | Yes | - |
| `CASE_NUMBERS` | Comma-separated case numbers to monitor | Yes | - |
| `CRON_SCHEDULE` | Cron expression for monitoring schedule | No | */30 9-18 * * 1-6 |
| `AUTO_START_MONITORING` | Auto-start monitoring on startup | No | true |

### WhatsApp API Setup

1. Get your WhatsApp API key from the service provider
2. The API endpoint is configured to use: `http://198.38.87.182/api/whatsapp/send-bulk`
3. Add recipient phone numbers in international format (91xxxxxxxxxx)
4. Configure the API key in your environment variables

### Case Numbers Format

Add case numbers in the format used by Allahabad High Court:
```
CASE_NUMBERS=WRIT12345/2024,WRIT12346/2024,CRLMC1234/2024
```

## API Endpoints

### Monitoring Control

- `GET /api/status` - Get monitoring status
- `POST /api/monitoring/start` - Start monitoring
- `POST /api/monitoring/stop` - Stop monitoring
- `POST /api/monitoring/run` - Run monitoring cycle manually
- `PUT /api/monitoring/schedule` - Update monitoring schedule

### Case Management

- `GET /api/cases` - Get all monitored cases (with pagination)
- `GET /api/cases/:caseNumber` - Get specific case details
- `POST /api/cases/add` - Add case number to monitoring
- `DELETE /api/cases/:caseNumber` - Remove case from monitoring

### System

- `GET /health` - Health check
- `GET /api/stats` - System statistics
- `POST /api/test/whatsapp` - Send test WhatsApp message

## Usage Examples

### Start Monitoring via API

```bash
curl -X POST http://localhost:3000/api/monitoring/start \
  -H "Content-Type: application/json" \
  -d '{
    "schedule": "*/15 9-18 * * 1-6",
    "caseNumbers": ["WRIT12345/2024", "WRIT12346/2024"]
  }'
```

### Add Case Number

```bash
curl -X POST http://localhost:3000/api/cases/add \
  -H "Content-Type: application/json" \
  -d '{"caseNumber": "WRIT12347/2024"}'
```

### Get System Status

```bash
curl http://localhost:3000/api/status
```

### Send Test WhatsApp Message

```bash
# Single number
curl -X POST http://localhost:3000/api/test/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "918123456789", "message": "Test message"}'

# Multiple numbers
curl -X POST http://localhost:3000/api/test/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"phoneNumbers": ["918123456789", "919876543210"], "message": "Test message"}'
```

## Monitoring Schedule

The default cron schedule `*/30 9-18 * * 1-6` means:
- Every 30 minutes
- Between 9 AM and 6 PM
- Monday to Saturday

You can customize this using standard cron expressions:
- `0 9,12,15,18 * * 1-6` - At 9 AM, 12 PM, 3 PM, and 6 PM on weekdays
- `*/15 * * * *` - Every 15 minutes (24/7)
- `0 */2 * * *` - Every 2 hours

## Notification Types

The system detects and notifies about:

1. **New Cases** - When a new case is registered
2. **Status Changes** - When case status is updated
3. **Hearing Date Changes** - When next hearing date is modified
4. **Order Updates** - When new orders/judgments are published
5. **General Updates** - Other case information changes

## Logging

Logs are stored in the `logs/` directory:
- `combined.log` - All application logs
- `error.log` - Error logs only
- `monitoring.log` - Monitoring-specific logs

Log levels: `error`, `warn`, `info`, `debug`

## Database Schema

### Case Model

```javascript
{
  caseNumber: String,      // Unique case identifier
  caseTitle: String,       // Case title
  caseType: String,        // Type of case (WRIT, CRLMC, etc.)
  petitioner: String,      // Petitioner name
  respondent: String,      // Respondent name
  judge: String,           // Assigned judge
  status: String,          // Current status
  lastHearingDate: Date,   // Last hearing date
  nextHearingDate: Date,   // Next hearing date
  orderDate: Date,         // Order date
  orderDetails: String,    // Order details
  remarks: String,         // Additional remarks
  dataHash: String,        // Hash for change detection
  isNotified: Boolean,     // Notification status
  createdAt: Date,         // Creation timestamp
  lastUpdated: Date        // Last update timestamp
}
```

## Error Handling

- Automatic retry mechanism for API failures
- Graceful error handling with detailed logging
- Admin notifications for system errors
- Database connection recovery

## Security Best Practices

- Environment variables for sensitive data
- Input validation and sanitization
- Rate limiting (configurable)
- Secure MongoDB connection
- Error message sanitization

## Deployment

### Using PM2 (Recommended)

```bash
npm install -g pm2
pm2 start app.js --name "allahabad-hc-monitor"
pm2 startup
pm2 save
```

### Using Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

## Troubleshooting

### Common Issues

1. **WhatsApp API Errors**
   - Verify access token and phone number ID
   - Check recipient number format (+91xxxxxxxxxx)
   - Ensure WhatsApp Business account is verified

2. **MongoDB Connection Issues**
   - Verify MongoDB is running
   - Check connection string format
   - Ensure database permissions

3. **Court Website Changes**
   - Update HTML parsing selectors in `apiService.js`
   - Check court website structure changes
   - Verify API endpoints

### Debug Mode

Set `LOG_LEVEL=debug` in your `.env` file for detailed logging.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the ISC License.

## Support

For support and questions:
- Check the logs in `logs/` directory
- Review the API documentation above
- Ensure all environment variables are properly configured

## Disclaimer

This tool is for educational and informational purposes. Ensure compliance with the Allahabad High Court's terms of service and applicable laws when using this monitoring service.#   a l l a h a b a d - h c - r e n d e r  
 