const express = require('express');
const admin = require('firebase-admin');
const { db, storage } = require('./firebase-admin'); 
const router = express.Router();

router.post('/save-mail-formats', async (req, res) => {
  try {
    const { formatName, subject, body, userEmail, attachmentURL  } = req.body;

    // Validate input
    if (!formatName || !subject || !body || !userEmail) {
      return res.status(400).json({ message: 'Format Name, Subject, and Body are required' });
    }

    // Save mail format to Firestore
    const docRef = await db.collection('mailFormats').add({
      formatName,
      subject,
      body,
      userEmail,
      attachmentURL: attachmentURL || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(201).json({ message: 'Mail format saved successfully', id: docRef.id });
  } catch (error) {
    console.error('Error saving mail format:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/get-mail-formats', async (req, res) => {
    const userEmail = req.query.email;

    if (!userEmail) {
        return res.status(400).json({ message: 'User email is required' });
    }

    try {
        const snapshot = await db.collection('mailFormats')
        .where('userEmail', '==', userEmail)
        .get();
        
        if (snapshot.empty) {
        return res.status(404).json({ message: 'No mail formats found for this email' });
        }
        
        const mailFormats = [];
        snapshot.forEach(doc => {
        mailFormats.push({
            id: doc.id,
            ...doc.data(),
        });
        });

        res.status(200).json(mailFormats);
    } catch (error) {
        console.error('Error fetching mail formats:', error);
        res.status(500).json({ message: 'Failed to fetch mail formats' });
    }
});

router.delete('/delete-mail-format', async (req, res) => {
  const { id } = req.query;
  const { attachmentURL } = req.body;


  if (!id) {
    return res.status(400).json({ message: 'Mail format ID is required' });
  }

  try {
    const mailFormatRef = db.collection('mailFormats').doc(id);
    const doc = await mailFormatRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: 'Mail format not found' });
    }

    if (attachmentURL) {
      const decodedURL = decodeURIComponent(attachmentURL);
      const filePath = decodedURL.split('/o/')[1].split('?')[0]; 
      const fileRef = storage.file(filePath);
      await fileRef.delete();
    }
   
    await mailFormatRef.delete();

    res.status(200).json({ message: 'Mail format deleted successfully' });
  } catch (error) {
    console.error('Error deleting mail format:', error);
      res.status(500).json({ message: 'Failed to delete mail format' });
  }
});

router.put('/update-mail-format', async (req, res) => {
  try {
    const { id, formatName, subject, body, userEmail, attachmentURL } = req.body;

    if (!id || !formatName || !subject || !body || !userEmail) {
      return res.status(400).json({ message: 'ID, Format Name, Subject, Body, and User Email are required' });
    }

    const mailFormatRef = db.collection('mailFormats').doc(id);
    const doc = await mailFormatRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: 'Mail format not found' });
    }

    const updatedData = {
      formatName,
      subject,
      body,
      userEmail,
      attachmentURL: attachmentURL || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await mailFormatRef.update(updatedData);

    res.status(200).json({ message: 'Mail format updated successfully' });
  } catch (error) {
    console.error('Error updating mail format:', error);
    res.status(500).json({ message: 'Failed to update mail format' });
  }
});


module.exports = router;