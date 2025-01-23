const express = require("express");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');
const { db } = require('./firebase-admin');
const router = express.Router();
const bodyParser = require('body-parser');

router.post("/checkout-session", async (req, res) => {
  const { planId, userEmail, planName } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price: planId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${process.env.REACT_APP_FRONTEND_URL}/?tab=Account&planName=${planName}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.REACT_APP_FRONTEND_URL}/cancel`,
      metadata: {
        planName: planName,
        userEmail: userEmail,
      },
    });

    res.json({ sessionId: session.id });

  } catch (error) {
    console.error("Error creating checkout session:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/upgrade-plan', async (req, res) => {
    try {
      const { senderEmail, planName } = req.body;
  
      const userQuerySnapshot = await db.collection('users')
        .where('email', '==', senderEmail)
        .get();
  
      if (userQuerySnapshot.empty) {
        return res.status(400).json({ message: 'User not found' });
      }

      const userQuery = await db.collection('users').where('email', '==', senderEmail).get();
      if (!userQuery.empty) {
        const userDoc = userQuery.docs[0];
        await userDoc.ref.update({
          pricingPlan: planName,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log('User plan updated');
      }
  
      res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
      console.error('Error during registration:', error);
      res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
