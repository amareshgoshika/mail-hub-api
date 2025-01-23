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
      const { senderEmail, planName, sessionId } = req.body;
  
      if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required' });
      }
  
      // Retrieve the session from Stripe
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      const invoice = await stripe.invoices.retrieve(session.invoice);
  
      // Handle subscription sessions
      if (session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
  
        const price = subscription.items.data[0].plan.amount;
        const userEmail = senderEmail;
        const transactionDate = new Date(subscription.created * 1000);
        const invoiceNumber = invoice.number;
        const renewalDate = new Date(subscription.current_period_end * 1000).toISOString().split('T')[0];
        const paymentsRef = db.collection("payments").doc(invoiceNumber);

        await paymentsRef.set({
            userEmail: userEmail,
            planName: planName,
            price: price,
            transactionDate: transactionDate,
            invoiceNumber: invoiceNumber,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
  
      const userQuerySnapshot = await db.collection('users')
        .where('email', '==', senderEmail)
        .get();
  
      if (userQuerySnapshot.empty) {
        return res.status(400).json({ message: 'User not found' });
      }
  
      const userDoc = userQuerySnapshot.docs[0];
      await userDoc.ref.update({
        pricingPlan: planName,
        renewalDate: renewalDate,
        subscriptionStatus: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  
      res.status(201).json({ message: 'User plan updated and subscription details saved successfully' });
    }
    } catch (error) {
      console.error('Error during upgrade:', error);
      res.status(500).json({ message: 'Server error' });
    }
  });
  
router.get('/payment-history', async (req, res) => {
    try {
      const { senderEmail } = req.query;
  
      if (!senderEmail) {
        return res.status(400).json({ message: 'Email is required' });
      }
  
      const paymentsSnapshot = await db.collection('payments')
        .where('userEmail', '==', senderEmail)
        .get();
  
      if (paymentsSnapshot.empty) {
        return res.status(404).json({ message: 'No payment history found' });
      }
  
      const paymentHistory = paymentsSnapshot.docs.map(doc => doc.data());
  
      res.status(200).json({ paymentHistory });
    } catch (error) {
      console.error('Error fetching payment history:', error);
      res.status(500).json({ message: 'Server error' });
    }
  });  

module.exports = router;
