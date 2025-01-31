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

  router.get("/search-user", async (req, res) => {
    const { email } = req.query;
  
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }
  
    try {
      const userSnapshot = await db.collection("users").where("email", "==", email).get();
  
      if (userSnapshot.empty) {
        return res.status(404).json({ success: false, message: "User not found" });
      }
  
      let userData;
      userSnapshot.forEach((doc) => {
        userData = { id: doc.id, ...doc.data() };
      });


      const userPaymentSnapshot = await db.collection("payments").where("userEmail", "==", email).get();

      let userPayments = [];
      if (!userPaymentSnapshot.empty) {
        userPaymentSnapshot.forEach((doc) => {
          userPayments.push({ id: doc.id, ...doc.data() });
        });
      }
  
      res.json({ success: true, user: userData, userPayments: userPayments });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
  });

  router.get("/list-of-users", async (req, res) => {
    try {
      const usersCollection = await db.collection("users").get();
      const users = usersCollection.docs.map((doc) => ({
        id: doc.id,
        email: doc.data().email,
      }));
      res.status(200).json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

module.exports = router;
