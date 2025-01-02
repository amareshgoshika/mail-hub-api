const express = require('express');
const multer = require('multer');
const userApi = require('./user-api');
const mailFormatsAPI = require('./mail-formats');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = 8000;

const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = ['http://localhost:3000', 'https://mailhub-ui.netlify.app'];
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/api', userApi);
app.use('/mailformats', mailFormatsAPI);

const upload = multer({ dest: 'uploads/' }); // Save credentials on disk
const tokenUpload = multer({ storage: multer.memoryStorage() }); // Store token in memory
const redirect_uri = process.env.REACT_APP_REDIRECT_URL;

const SCOPES = ['https://mail.google.com/'];

const TOKEN_DIR = path.join(__dirname, 'tokens');

if (!fs.existsSync(TOKEN_DIR)) {
  fs.mkdirSync(TOKEN_DIR);
}

async function getService(userEmail) {
  const credentialsFile = path.join(__dirname, 'uploads', userEmail, 'credentials.json');
  const tokenFile = path.join(__dirname, 'uploads', userEmail, 'token.pickle');

  if (!fs.existsSync(credentialsFile)) {
    throw new Error("Credentials file 'credentials.json' not found. Upload it first.");
  }

  const credentials = JSON.parse(fs.readFileSync(credentialsFile));
  const { client_secret, client_id} = credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

  if (fs.existsSync(tokenFile)) {
    const token = fs.readFileSync(tokenFile);
    oAuth2Client.setCredentials(JSON.parse(token));
  } else {
    throw new Error('Token not found. Authenticate first.');
  }

  return google.gmail({ version: 'v1', auth: oAuth2Client });
}

app.post('/upload-credentials', upload.single('credentials'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const { email } = req.body;

  const folderPath = path.join(__dirname, 'uploads', email);

  fs.mkdir(folderPath, { recursive: true }, (mkdirErr) => {
    if (mkdirErr) {
      return res.status(500).json({ error: 'Failed to create user folder' });
    }

    const uploadedPath = req.file.path;
    const newPath = path.join(folderPath, 'credentials.json');

    fs.rename(uploadedPath, newPath, (renameErr) => {
      if (renameErr) {
        return res.status(500).json({ error: 'Failed to save credentials file' });
      }

      res.json({ message: 'Credentials uploaded successfully' });
    });
  });
});

app.post('/authenticate', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const userDir = path.join(__dirname, 'uploads', email);
    const credentialsFile = path.join(userDir, 'credentials.json');

    if (!fs.existsSync(credentialsFile)) {
      return res.status(400).json({ error: "Credentials file not found. Upload 'credentials.json' first." });
    }

    const credentials = JSON.parse(fs.readFileSync(credentialsFile));
    const { client_secret, client_id} = credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      state: email
    });

    res.json({ authUrl, email });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/callback', async (req, res) => {
  const code = req.query.code; 
  const email = req.query.state; 
  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  try {
    const userDir = path.join(__dirname, 'uploads', email);
    const credentialsFile = path.join(userDir, 'credentials.json');
    const credentials = JSON.parse(fs.readFileSync(credentialsFile));
    const { client_secret, client_id } = credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    const tokenFilePath = path.join(userDir, 'token.pickle');

    fs.writeFileSync(path.join(userDir, 'token.pickle'), JSON.stringify(tokens));

    res.send(`
      <html>
        <body>
          <script>
            alert('Token generated successfully.');
            setTimeout(function() {
              window.location.href = '${process.env.REACT_APP_FRONTEND_URL}';
            }, 200); // Redirect after 2 seconds, adjust timing as needed
          </script>
        </body>
      </html>
    `);
    
  } catch (error) {
    console.error('Error in /callback:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/download', (req, res) => {
  const { filePath } = req.query;

  if (!filePath) {
    return res.status(400).send('File path is missing.');
  }

  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      console.error('File not found:', filePath);
      return res.status(404).send('File not found.');
    }

    res.download(filePath, 'token.pickle', (err) => {
      if (err) {
        console.error('Error during download:', err);
        res.status(500).send('Error during file download.');
      }
    });
  });
});


app.post('/save-token', async (req, res) => {
  try {
    const code = req.body.code;
    const credentialsFile = path.join(__dirname, 'credentials.json');
    const tokenFile = path.join(TOKEN_DIR, 'token.pickle');

    const credentials = JSON.parse(fs.readFileSync(credentialsFile));
    const { client_secret, client_id } = credentials.web;
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

app.post('/send-email', upload.single('attachment'), async (req, res) => {
  try {
    const { recipientEmail, subject, emailBody, userEmail } = req.body;
    const attachment = req.file;

    if (!recipientEmail || !subject || !emailBody) {
      return res.status(400).json({ error: 'Recipient email, subject, and email body are required' });
    }

    const service = await getService(userEmail);

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
