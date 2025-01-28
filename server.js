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
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = 8000;

app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`Received event: ${event.type}`);

  const handleEvent = async () => {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object;
        console.log(`PaymentIntent succeeded: ${paymentIntent.id}`);
        break;
      }

      case 'checkout.session.completed': {
        const session = event.data.object;

        if (session.metadata && session.metadata.userEmail) {
          const customerEmail = session.metadata.userEmail;
          const planName = session.metadata.planName;

          try {

            await upgradePlan({
              senderEmail: customerEmail,
              planName: planName,
              sessionId: session.id,
            });

          } catch (err) {
            console.error(`Error handling session completion: ${err.message}`);
            throw err;
          }
        } else {
          console.error('Missing metadata in session.');
          throw new Error('Invalid session metadata');
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;

        try {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
          const customer = await stripe.customers.retrieve(invoice.customer);
          const renewalDate = new Date(subscription.current_period_end * 1000).toISOString().split('T')[0];

          const userQuerySnapshot = await admin.firestore().collection('users')
            .where('email', '==', customer.email)
            .get();

          if (!userQuerySnapshot.empty) {
            const batch = admin.firestore().batch();
            userQuerySnapshot.docs.forEach((doc) => {
              batch.update(doc.ref, {
                renewalDate: renewalDate,
                credits: parseInt('1', 10),
                aiRewrites: parseInt('0', 10),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            });
            await batch.commit();
            console.log(`Renewal date updated for ${customer.email}`);
          }
        } catch (err) {
          console.error(`Error processing invoice: ${err.message}`);
          throw err;
        }
        break;
      }

      default:
        console.warn(`Unhandled event type: ${event.type}`);
        await admin.firestore().collection('unhandledWebhookEvents').add({
          eventType: event.type,
          payload: event,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
  };

  try {
    await handleEvent();
    res.json({ received: true });
  } catch (err) {
    res.status(500).send('Internal Server Error');
  }
});

async function upgradePlan({ senderEmail, planName, sessionId }) {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const invoice = await stripe.invoices.retrieve(session.invoice);

    if (session.subscription) {
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      const price = subscription.items.data[0].plan.amount;
      const userEmail = senderEmail;
      const transactionDate = new Date(subscription.created * 1000);
      const invoiceNumber = invoice.number;
      const renewalDate = new Date(subscription.current_period_end * 1000).toISOString().split('T')[0];

      const paymentsRef = db.collection("payments").doc(invoiceNumber);
      const subscriptionId = subscription.id;

      // Save payment information
      await paymentsRef.set({
        userEmail: userEmail,
        planName: planName,
        price: price,
        transactionDate: transactionDate,
        invoiceNumber: invoiceNumber,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const userQuerySnapshot = await db.collection('users')
        .where('email', '==', senderEmail)
        .get();

      if (userQuerySnapshot.empty) {
        throw new Error('User not found');
      }

      const userDoc = userQuerySnapshot.docs[0];
      await userDoc.ref.update({
        pricingPlan: planName,
        renewalDate: renewalDate,
        subscriptionStatus: true,
        subscriptionId: subscriptionId,
        credits: parseInt('0', 10),
        aiRewrites: parseInt('0', 10),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log('User plan updated and subscription details saved successfully');
    }
  } catch (error) {
    console.error('Error during upgrade:', error);
    throw new Error('Server error during plan upgrade');
  }
}

const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = ['http://localhost:3000', 'https://mailhub-ui.netlify.app', 'https://maileazy.com', 'https://maileazy-dev.netlify.app'];
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
