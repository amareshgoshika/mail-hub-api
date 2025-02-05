const express = require('express');
const admin = require('firebase-admin');
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const jwt = require('jsonwebtoken');
const { db } = require('./firebase-admin'); // Import Firebase Admin
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
  
function createEmail(adminMail, name, email, emailBody) {
  const boundary = "__boundary__";
  const staticFromName = "MailEazy Notifications";

  const messageParts = [
    `From: "${staticFromName}" <${email}>`,
    `To: ${adminMail}`,
    `Subject: ${name}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
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

// POST /register endpoint
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    // Validate input
    if (!name || !email || !phone || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const userQuerySnapshot = await db.collection('users')
      .where('email', '==', email)
      .get();

    if (!userQuerySnapshot.empty) {
      return res.status(400).json({ message: 'User is already registered' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Save user data to Firestore along with the Google Drive file URL
    await db.collection('users').add({
      name,
      email,
      phone,
      password: hashedPassword,
      credits: parseInt('1', 10),
      pricingPlan: "welcome",
      subscriptionStatus: false,
      renewalDate: "",
      aiRewrites: parseInt('1', 10),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const adminMail = "contact.maileazy@gmail.com";
    const emailBody = `
                    Congratulations! A new user has registered into MailEazy.<br>
                    <b>Name:</b> ${name}<br>
                    <b>Email:</b> ${email}<br>
                    <b>Phone:</b> ${phone}
                  `;
                      const service = await getService(adminMail);
    const rawMessage = createEmail(adminMail, "NR: " + name + " " + email, email, emailBody);
      
      const response = await service.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: rawMessage,
        },
      });

    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const userSnapshot = await db.collection('users').where('email', '==', email).get();

    if (userSnapshot.empty) {
      return res.status(400).json({ message: 'User not found' });
    }

    const user = userSnapshot.docs[0].data();

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    res.json({ message: 'Login successful', user: { email: user.email, name: user.name, credits: user.credits } });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/update-profile', async (req, res) => {
  try {
    const { name, phone, email } = req.body;

    const userQuerySnapshot = await db.collection('users')
      .where('email', '==', email)
      .get();

    if (userQuerySnapshot.empty) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userDoc = userQuerySnapshot.docs[0];
    const userData = userDoc.data();

    const updatedData = {
      name: name || userData.name,
      phone: phone || userData.phone,
    };

    await userDoc.ref.update(updatedData);

    res.status(200).json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post("/change-password", async (req, res) => {
  const { email, currentPassword, newPassword } = req.body;

  if (!email || !currentPassword || !newPassword) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    const userQuerySnapshot = await db.collection("users").where("email", "==", email).get();

    if (userQuerySnapshot.empty) {
      return res.status(400).json({ message: "User not found" });
    }

    const userDoc = userQuerySnapshot.docs[0];
    const userData = userDoc.data();
    const isPasswordValid = await bcrypt.compare(currentPassword, userData.password);

    if (!isPasswordValid) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    await userDoc.ref.update({ password: hashedNewPassword });
    res.status(200).json({ message: "Password changed successfully" });
    
  } catch (error) {
    console.error("Error changing password:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    const userSnapshot = await db.collection("users").where("email", "==", email).get();

    if (userSnapshot.empty) {
      return res.status(400).json({ message: "User not found" });
    }

    const userDoc = userSnapshot.docs[0];
    const resetToken = crypto.randomBytes(32).toString("hex");
    const tokenExpiry = Date.now() + 3600000;

    await userDoc.ref.update({
      resetToken,
      tokenExpiry,
    });

    const transporter = nodemailer.createTransport({
      service: "Gmail",
      auth: {
        user: "contact.maileazy@gmail.com",
        pass: "jxep mfpl vlle unfz",
      },
    });

    const resetLink = `${process.env.REACT_APP_FRONTEND_URL}/reset-password?token=${resetToken}`;
    const mailOptions = {
      from: "contact.maileazy@gmail.com",
      to: email,
      subject: "Password Reset",
      text: `You requested a password reset. Click the link below to reset your password:\n\n${resetLink}\n\nIf you didn't request this, please ignore this email.`,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({ message: "Password reset email sent" });
  } catch (error) {
    console.error("Error sending reset email:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/reset-password/:token", async (req, res) => {
  const { token } = req.params;

  try {
    const userSnapshot = await db.collection("users").where("resetToken", "==", token).get();
    if (userSnapshot.empty) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    const userDoc = userSnapshot.docs[0];
    const tokenExpiry = userDoc.data().tokenExpiry;

    if (Date.now() > tokenExpiry) {
      return res.status(400).json({ message: "Token has expired" });
    }

    res.status(200).json({ message: "Token is valid", email: userDoc.data().email });
  } catch (error) {
    res.status(400).json({ message: "Error verifying token" });
  }
});

router.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;

  try {
    const userSnapshot = await db.collection("users").where("resetToken", "==", token).get();
    if (userSnapshot.empty) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    const userDoc = userSnapshot.docs[0];
    const tokenExpiry = userDoc.data().tokenExpiry;

    if (Date.now() > tokenExpiry) {
      return res.status(400).json({ message: "Token has expired" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await userDoc.ref.update({ password: hashedPassword, resetToken: null, tokenExpiry: null });

    res.status(200).json({ message: "Password updated successfully" });
  } catch (error) {
    res.status(400).json({ message: "Error updating password" });
  }
});

router.get('/get-user-details', async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const userSnapshot = await db.collection('users').where('email', '==', email).get();

    if (userSnapshot.empty) {
      return res.status(400).json({ message: 'User not found' });
    }

    const user = userSnapshot.docs[0].data();

    res.json({ name: user.name, email: user.email, password: user.password, phone: user.phone, credits: user.credits, pricingPlan: user.pricingPlan, renewalDate: user.renewalDate, subscriptionStatus: user.subscriptionStatus, aiRewrites: user.aiRewrites, subscriptionId: user.subscriptionId, });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/get-user-accounts', async (req, res) => {
  try {
    const { planName } = req.query;

    const pricingSnapshot = await db.collection('pricingPlans').where('name', '==', planName).get();
    if (pricingSnapshot.empty) {
      return res.status(400).json({ message: 'No pricing plan available' });
    }
    const pricingPlanData = pricingSnapshot.docs[0].data();

    res.json({price: pricingPlanData.price, emailsPerDay: pricingPlanData.emailsPerDay, emailsPerMonth: pricingPlanData.emailsPerMonth, aiRewrites: pricingPlanData.aiRewrites,  });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;