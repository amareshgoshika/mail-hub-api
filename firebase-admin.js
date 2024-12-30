// firebase-admin.js
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK with your Firebase service account key
const serviceAccount = require('./firebase-account.json'); // Replace with the path to your Firebase service account key file

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://mailhub-a728a-default-rtdb.firebaseio.com/', // Replace with your Firebase Realtime Database URL
});

// Export the Firestore database instance
const db = admin.firestore();

module.exports = { admin, db };
