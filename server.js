const express = require('express');
const multer = require('multer');
const userApi = require('./user-api');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = 8000;

// Middleware
app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/api', userApi);

// File Upload Setup
const upload = multer({ dest: 'uploads/' }); // Save credentials on disk
const tokenUpload = multer({ storage: multer.memoryStorage() }); // Store token in memory
const redirect_uri = 'http://localhost:8000/callback';

// Scopes
const SCOPES = ['https://mail.google.com/'];

// Directory to save token
const TOKEN_DIR = path.join(__dirname, 'tokens');

// Create token directory if it doesn't exist
if (!fs.existsSync(TOKEN_DIR)) {
  fs.mkdirSync(TOKEN_DIR);
}

// Function to get the Gmail API service
async function getService() {
  const credentialsFile = path.join(__dirname, 'credentials.json');
  const tokenFile = path.join(TOKEN_DIR, 'token.pickle');

  if (!fs.existsSync(credentialsFile)) {
    throw new Error("Credentials file 'credentials.json' not found. Upload it first.");
  }

  const credentials = JSON.parse(fs.readFileSync(credentialsFile));
  const { client_secret, client_id} = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

  // Check if the token file exists
  if (fs.existsSync(tokenFile)) {
    const token = fs.readFileSync(tokenFile);
    oAuth2Client.setCredentials(JSON.parse(token));
  } else {
    throw new Error('Token not found. Authenticate first.');
  }

  return google.gmail({ version: 'v1', auth: oAuth2Client });
}

// Route: Upload Credentials File
app.post('/upload-credentials', upload.single('credentials'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const uploadedPath = req.file.path;
  const newPath = path.join(__dirname, 'credentials.json');

  // Move the uploaded file to the project root as 'credentials.json'
  fs.rename(uploadedPath, newPath, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to save credentials file' });
    }
    res.json({ message: 'Credentials uploaded successfully' });
  });
});

// Route: Authenticate User (Generates token.pickle)
app.get('/authenticate', async (req, res) => {
  try {
    const credentialsFile = path.join(__dirname, 'credentials.json');
    const tokenFile = path.join(TOKEN_DIR, 'token.pickle');

    if (!fs.existsSync(credentialsFile)) {
      return res.status(400).json({ error: "Credentials file not found. Upload 'credentials.json' first." });
    }

    const credentials = JSON.parse(fs.readFileSync(credentialsFile));
    const { client_secret, client_id} = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });

    res.json({ authUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Step to handle OAuth2 callback
app.get('/callback', async (req, res) => {
  const code = req.query.code; // Get the authorization code from the query params
  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  try {
    const credentialsFile = path.join(__dirname, 'credentials.json');
    const credentials = JSON.parse(fs.readFileSync(credentialsFile));
    const { client_secret, client_id} = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

    // Exchange the authorization code for an access token
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    // Save the token in the 'tokens' directory
    fs.writeFileSync(path.join(TOKEN_DIR, 'token.pickle'), JSON.stringify(tokens));

    res.send('Authentication successful! You can now use the app.');
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route: Save the token after authentication
app.post('/save-token', async (req, res) => {
  try {
    const code = req.body.code;
    const credentialsFile = path.join(__dirname, 'credentials.json');
    const tokenFile = path.join(TOKEN_DIR, 'token.pickle');

    const credentials = JSON.parse(fs.readFileSync(credentialsFile));
    const { client_secret, client_id } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    // Save the token in the 'tokens' directory
    fs.writeFileSync(tokenFile, JSON.stringify(tokens));
    res.json({ message: 'Token saved successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route: Send Email
app.post('/send-email', upload.single('attachment'), async (req, res) => {
  try {
    const { recipientEmail, subject, emailBody } = req.body;
    const attachment = req.file;

    if (!recipientEmail || !subject || !emailBody) {
      return res.status(400).json({ error: 'Recipient email, subject, and email body are required' });
    }

    const service = await getService();

    const rawMessage = createEmail(recipientEmail, subject, emailBody, attachment);
    const response = await service.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: rawMessage,
      },
    });

    res.json({ message: 'Email sent successfully', response });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Function to create the raw email message
function createEmail(recipientEmail, subject, emailBody, attachment) {
  const boundary = "__boundary__";
  const body = [
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    `Content-Disposition: inline`,
    '',
    Buffer.from(emailBody).toString('base64')
  ].join('\r\n');

  const messageParts = [
    `To: ${recipientEmail}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    'Content-Transfer-Encoding: 7bit',
    '',
    emailBody,
    '',
    `--${boundary}`,
  ];

  if (attachment && attachment.path) {
    const filePath = attachment.path;
    const fileName = attachment.originalname;
    const fileData = fs.readFileSync(filePath);
    const encodedAttachment = Buffer.from(fileData).toString('base64');
    messageParts.push(
      `Content-Type: application/pdf; name="${fileName}"`,
      `Content-Disposition: attachment; filename="${fileName}"`,
      `Content-Transfer-Encoding: base64`,
      '',
      encodedAttachment,
      `--${boundary}--`
    );
  } else {
    console.error('Attachment path is undefined.');
  }

  return Buffer.from(messageParts.join('\r\n')).toString('base64');
}

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
