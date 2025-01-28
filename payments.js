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
      // success_url: `${process.env.REACT_APP_FRONTEND_URL}/?tab=Account&planName=${planName}&session_id={CHECKOUT_SESSION_ID}`,
      success_url: `${process.env.REACT_APP_FRONTEND_URL}/?tab=Account`,
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
        const subscriptionId = subscription.id;

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
        subscriptionId: subscriptionId,
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
        .orderBy('transactionDate', 'desc')
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

router.post('/cancel-subscription', async (req, res) => {
  const { subscriptionId, userEmail } = req.body;

  try {
    if (!subscriptionId || !userEmail) {
      return res.status(400).json({ message: 'Subscription ID and User Email are required' });
    }

    const canceledSubscription = await stripe.subscriptions.cancel(subscriptionId);

    if (canceledSubscription.status !== 'canceled') {
      return res.status(500).json({ message: 'Failed to cancel subscription in Stripe' });
    }

    const userQuerySnapshot = await db.collection('users')
      .where('email', '==', userEmail)
      .get();

    if (userQuerySnapshot.empty) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userDoc = userQuerySnapshot.docs[0];
    await userDoc.ref.update({
      subscriptionStatus: false,
      pricingPlan: "welcome",
      renewalDate: null,
      credits: parseInt('1', 10),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).json({ message: 'Subscription canceled and user data updated successfully' });

  } catch (error) {
    console.error('Error canceling subscription:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});  

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle successful checkout session (initial subscription payment)
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    try {
      // Retrieve subscription details
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      const invoice = await stripe.invoices.retrieve(session.invoice);

      // Extract necessary data
      const price = subscription.items.data[0].plan.amount;
      const userEmail = session.metadata.email;
      const planName = session.metadata.planName;
      const transactionDate = new Date(subscription.created * 1000);
      const invoiceNumber = invoice.number;
      const renewalDate = new Date(subscription.current_period_end * 1000).toISOString().split('T')[0];
      const subscriptionId = subscription.id;

      // Save payment details to Firestore
      const paymentsRef = db.collection('payments').doc(invoiceNumber);
      // await paymentsRef.set({
      //   userEmail: userEmail,
      //   planName: planName,
      //   price: price,
      //   transactionDate: transactionDate,
      //   invoiceNumber: invoiceNumber,
      //   createdAt: admin.firestore.FieldValue.serverTimestamp(),
      //   updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      // });

      // Update user details in Firestore
      const userQuerySnapshot = await db.collection('users')
        .where('email', '==', userEmail)
        .get();

      if (!userQuerySnapshot.empty) {
        const userDoc = userQuerySnapshot.docs[0];
        await userDoc.ref.update({
          pricingPlan: planName,
          renewalDate: renewalDate,
          subscriptionStatus: true,
          testing: true,
          subscriptionId: subscriptionId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      console.log(`Updated user ${userEmail} with new subscription`);
    } catch (error) {
      console.error('Error processing checkout.session.completed:', error);
      return res.status(500).send('Internal Server Error');
    }
  }

  // Handle recurring subscription payments
  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object;

    try {
      const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
      const customer = await stripe.customers.retrieve(invoice.customer);

      // Update user's renewal date in Firestore
      const userQuerySnapshot = await db.collection('users')
        .where('email', '==', customer.email)
        .get();

      if (!userQuerySnapshot.empty) {
        const userDoc = userQuerySnapshot.docs[0];
        const renewalDate = new Date(subscription.current_period_end * 1000).toISOString().split('T')[0];

        await userDoc.ref.update({
          renewalDate: renewalDate,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`Updated renewal date for user ${customer.email}`);
      }
    } catch (error) {
      console.error('Error processing invoice.payment_succeeded:', error);
      return res.status(500).send('Internal Server Error');
    }
  }

  res.json({ received: true });
});

module.exports = router;
