const express = require('express');
const admin = require('firebase-admin');
const { db } = require('./firebase-admin'); // Import Firebase Admin
const router = express.Router();

// POST /register endpoint
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password, credentials } = req.body;

    // Validate input
    if (!name || !email || !phone || !password || !credentials) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Save user data to Firestore along with the Google Drive file URL
    await db.collection('users').add({
      name,
      email,
      phone,
      password,
      credentials,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;