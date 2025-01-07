const express = require('express');
const admin = require('firebase-admin');
const { db } = require('./firebase-admin'); // Import Firebase Admin
const router = express.Router();

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

    // Save user data to Firestore along with the Google Drive file URL
    await db.collection('users').add({
      name,
      email,
      phone,
      password,
      credits: parseInt('100', 10),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
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

    if (password !== user.password) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    res.json({ message: 'Login successful', user: { email: user.email, name: user.name } });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ message: 'Server error' });
  }
});



module.exports = router;