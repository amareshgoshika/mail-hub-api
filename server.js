const express = require('express');
const multer = require('multer');
const homeApi = require('./home-api');
const userApi = require('./user-api');
const mailFormatsAPI = require('./mail-formats');
const payments = require('./payments');
const rewriteApi = require('./rewrite-api');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const cors = require('cors');
const bodyParser = require('body-parser');
const { db } = require('./firebase-admin');
const admin = require('firebase-admin');

const app = express();
const PORT = 8000;

const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = ['http://localhost:3000', 'https://mailhub-ui.netlify.app', 'https://maileazy.com'];
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
app.use('/home', homeApi);
app.use('/payments', payments);
app.use('/rewrite', rewriteApi);

const upload = multer({ dest: '/var/data/resumes' });
const redirect_uri = process.env.REACT_APP_REDIRECT_URL;
const persistentDiskPath = '/var/data/resumes';

const SCOPES = ['https://mail.google.com/'];

const TOKEN_DIR = path.join(__dirname, 'tokens');

if (!fs.existsSync(TOKEN_DIR)) {
  fs.mkdirSync(TOKEN_DIR);
}

async function getService(userEmail) {
  const credentialsFile = path.join(persistentDiskPath, userEmail, 'credentials.json');
  const tokenFile = path.join(persistentDiskPath, userEmail, 'token.pickle');

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
  const folderPath = path.join(persistentDiskPath, email);

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

    const userDirPersistentDisk = path.join(persistentDiskPath, email);
    const credentialsFile = path.join(userDirPersistentDisk, 'credentials.json');

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
    const persistentDiskPath = '/var/data/resumes';
    const userDirPersistentDisk = path.join(persistentDiskPath, email);
    const credentialsFile = path.join(userDirPersistentDisk, 'credentials.json');

    if (!fs.existsSync(userDirPersistentDisk)) {
      try {
        fs.mkdirSync(userDirPersistentDisk, { recursive: true });
      } catch (dirError) {
        console.error('Directory creation failed:', dirError);
        return res.status(500).json({ error: 'Failed to create directory on persistent disk' });
      }
    }

    const credentials = JSON.parse(fs.readFileSync(credentialsFile));
    const { client_secret, client_id } = credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    fs.writeFileSync(path.join(userDirPersistentDisk, 'token.pickle'), JSON.stringify(tokens));

    res.send(`
      <html>
        <body>
          <script>
            alert('Token generated successfully. Login To Continue.');
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

app.post('/send-email', upload.single('attachment'), async (req, res) => {
  try {
    const { recipientEmail, subject, emailBody, userEmail } = req.body;
    const attachment = req.file;

    if (!recipientEmail || !subject || !emailBody) {
      return res.status(400).json({ error: 'Recipient email, subject, and email body are required' });
    }

    // Fetch user and check credits
    const userQuerySnapshot = await db.collection('users').where('email', '==', userEmail).get();
    
    if (userQuerySnapshot.empty) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userRef = userQuerySnapshot.docs[0].ref;
    const user = userQuerySnapshot.docs[0].data();
    const userPlan = user.pricingPlan;

    const planQuerySnapshot = await db.collection('pricingPlans').where('name', '==', userPlan).get();
    const plan = planQuerySnapshot.docs[0].data();
    const emailsPerMonth = plan.emailsPerMonth;
    const availableCredits = emailsPerMonth - user.credits;

    if (availableCredits == 0) {
      return res.status(400).json({ message: 'No credits available' });
    }

    // Send email
    const service = await getService(userEmail);
    const rawMessage = createEmail(recipientEmail, subject, emailBody, attachment);
    
    const response = await service.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: rawMessage,
      },
    });

    if (userEmail === "contact.maileazy@gmail.com") {
      const checkCustomerEmailQuery = await db.collection('customerEmails')
        .where('recipientEmail', '==', recipientEmail)
        .get();
    
      if (checkCustomerEmailQuery.empty) {
        await db.collection('customerEmails').add({
          recipientEmail,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    } else {
      const checkVendorEmailQuery = await db.collection('vendorEmails')
        .where('recipientEmail', '==', recipientEmail)
        .get();
    
      if (checkVendorEmailQuery.empty) {
        await db.collection('vendorEmails').add({
          recipientEmail,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      const currentCredits = userDoc.data().credits;

      if (currentCredits > 0) {
        transaction.update(userRef, { credits: currentCredits + 1 });
      } else {
        throw new Error('No credits available to deduct');
      }
    });

    res.json({ message: 'Email sent successfully', response });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function createEmail(recipientEmail, subject, emailBody, attachment) {
  const boundary = "__boundary__";

  const messageParts = [
    `To: ${recipientEmail}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    'Content-Transfer-Encoding: 7bit',
    '',
    emailBody,
    '',
  ];

  if (attachment && attachment.path) {
    const filePath = attachment.path;
    const fileName = attachment.originalname;
    const fileData = fs.readFileSync(filePath);
    const encodedAttachment = Buffer.from(fileData).toString('base64');
    messageParts.push( 
       `--${boundary}`,
      `Content-Type: application/pdf; name="${fileName}"`,
      `Content-Disposition: attachment; filename="${fileName}"`,
      `Content-Transfer-Encoding: base64`,
      '',
      encodedAttachment
    );
  }

  messageParts.push(`--${boundary}--`);
  return Buffer.from(messageParts.join('\r\n')).toString('base64');
}

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
