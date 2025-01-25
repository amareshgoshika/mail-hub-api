const express = require('express');
const { db } = require('./firebase-admin');
const router = express.Router();
const path = require('path');
const { google } = require('googleapis');
const fs = require('fs');

const redirect_uri = process.env.REACT_APP_REDIRECT_URL;
const persistentDiskPath = '/var/data/resumes';

async function getService(adminMail) {
  const credentialsFile = path.join(persistentDiskPath, adminMail, 'credentials.json');
  const tokenFile = path.join(persistentDiskPath, adminMail, 'token.pickle');

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

router.get('/get-pricing-plans', async (req, res) => {
    try {
      const plansSnapshot = await db.collection('pricingPlans').get();
  
      if (plansSnapshot.empty) {
        return res.status(404).json({ message: 'No pricing plans found' });
      }
  
      const pricingPlans = [];
        plansSnapshot.forEach(doc => {
            pricingPlans.push(doc.data());
        });

        pricingPlans.sort((a, b) => {
            return parseInt(a.planNumber, 10) - parseInt(b.planNumber, 10);
        });
  
      res.json({ pricingPlans });
    } catch (error) {
      console.error('Error fetching pricing plans:', error);
      res.status(500).json({ message: 'Server error' });
    }
  });
  
  router.post('/send-contact-us-email', async (req, res) => {
    try {
      const {subject: name, userEmail, emailBody } = req.body;

      const adminMail = "contact.maileazy@gmail.com"
  
      if (!name || !emailBody) {
        return res.status(400).json({ error: 'Recipient email, subject, and email body are required' });
      }
  
      const service = await getService(adminMail);
      const rawMessage = createEmail(adminMail, "CF: " + name + " " + userEmail, emailBody);
      
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
  
  function createEmail(adminMail, name, emailBody) {
    const boundary = "__boundary__";
  
    const messageParts = [
      `To: ${adminMail}`,
      `Subject: ${name}`,
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
  
    messageParts.push(`--${boundary}--`);
    return Buffer.from(messageParts.join('\r\n')).toString('base64');
  }


module.exports = router;