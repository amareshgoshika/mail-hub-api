const express = require('express');
const admin = require('firebase-admin');
const { db } = require('./firebase-admin');
const router = express.Router();

router.get('/get-pricing-plans', async (req, res) => {
    try {
      const plansSnapshot = await db.collection('pricingPlans').get();
  
      if (plansSnapshot.empty) {
        return res.status(404).json({ message: 'No pricing plans found' });
      }
  
      const pricingPlans = [];
        plansSnapshot.forEach(doc => {
            pricingPlans.push(doc.data());
        });

        pricingPlans.sort((a, b) => {
            return parseInt(a.planNumber, 10) - parseInt(b.planNumber, 10);
        });
  
      res.json({ pricingPlans });
    } catch (error) {
      console.error('Error fetching pricing plans:', error);
      res.status(500).json({ message: 'Server error' });
    }
  });
  
module.exports = router;