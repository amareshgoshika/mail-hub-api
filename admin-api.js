const express = require('express');
const router = express.Router();
const { db } = require('./firebase-admin');
const admin = require('firebase-admin');

router.post('/admin-login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const adminRef = db.collection('adminEmails').where('adminEmail', '==', email);
    const snapshot = await adminRef.get();

    if (snapshot.empty) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    let isValid = false;
    snapshot.forEach(doc => {
      const adminData = doc.data();
      if (adminData.password === password) {
        isValid = true;
      }
    });

    if (isValid) {
      res.json({ success: true });
    } else {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

router.post('/save-vendor-emails', async (req, res) => {
  const { emails } = req.body;

  if (!emails || emails.length === 0) {
    return res.status(400).json({ success: false, message: "No emails provided" });
  }

  try {
    const emailsRef = db.collection('vendorEmails');
    const batch = db.batch();
    const uniqueEmails = new Set();

    const snapshot = await emailsRef.get();
    snapshot.forEach((doc) => {
      uniqueEmails.add(doc.data().recipientEmail);
    });

    let newEmails = 0;
    emails.forEach((email) => {
      if (!uniqueEmails.has(email)) {
        const emailDoc = emailsRef.doc();
        batch.set(emailDoc, {
          recipientEmail: email,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        uniqueEmails.add(email);
        newEmails++;
      }
    });

    if (newEmails > 0) {
      await batch.commit();
    }

    res.json({ success: true, message: `${newEmails} new emails successfully saved to Firebase` });
  } catch (error) {
    console.error("Error saving emails:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});


  router.post('/save-customer-emails', async (req, res) => {
    const { emails } = req.body;
  
    if (!emails || emails.length === 0) {
      return res.status(400).json({ success: false, message: "No emails provided" });
    }
  
    try {
      const emailsRef = db.collection('customerEmails');
      const batch = db.batch();
  
      for (const email of emails) {
        const existingQuery = await emailsRef.where('recipientEmail', '==', email).get();
  
        if (existingQuery.empty) {
          const emailDoc = emailsRef.doc();
          batch.set(emailDoc, {
            recipientEmail: email,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      }
  
      await batch.commit();
  
      res.json({ success: true, message: "Emails successfully saved to Firebase" });
    } catch (error) {
      console.error("Error saving emails:", error);
      res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
  });
  

module.exports = router;
