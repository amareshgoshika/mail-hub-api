const admin = require('firebase-admin');
require('dotenv').config();

const privateKey = process.env.REACT_APP_FIREBASE_PRIVATE_KEY;

if (!privateKey) {
  throw new Error("Firebase private key is not defined.");
}

// Initialize Firebase Admin SDK with environment variables
const serviceAccount = {
  type: 'service_account',
  project_id: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  private_key_id: process.env.REACT_APP_FIREBASE_PRIVATE_KEY_ID,
  private_key: privateKey.replace(/\\n/g, '\n'),
  client_email: process.env.REACT_APP_FIREBASE_CLIENT_EMAIL,
  client_id: process.env.REACT_APP_FIREBASE_CLIENT_ID,
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
});

// Export the Firestore database instance
const db = admin.firestore();
const storage = admin.storage().bucket();

module.exports = { admin, db, storage };
