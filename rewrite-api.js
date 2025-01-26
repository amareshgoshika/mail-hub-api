const express = require("express");
const axios = require("axios");
const router = express.Router();
const { db } = require('./firebase-admin');

router.post("/rewrite-api", async (req, res) => {
  const { text, userEmail } = req.body;
  

  if (!text) {
    return res.status(400).json({ error: "Body is required" });
  }

  const userQuerySnapshot = await db.collection('users').where('email', '==', userEmail).get();
    
  if (userQuerySnapshot.empty) {
    return res.status(404).json({ error: 'User not found' });
  }

  const userRef = userQuerySnapshot.docs[0].ref;
  const user = userQuerySnapshot.docs[0].data();
  const userPlan = user.pricingPlan;

  const planQuerySnapshot = await db.collection('pricingPlans').where('name', '==', userPlan).get();
    const plan = planQuerySnapshot.docs[0].data();
    const aiRewrites = plan.aiRewrites;
    const availableAIRewrites = aiRewrites - user.aiRewrites;

    if (availableAIRewrites == 0) {
        return res.status(400).json({ message: 'No credits available' });
    }

  try {
    // Send a POST request to TextCortex API
    const response = await axios.post(
      "https://api.textcortex.com/v1/texts/rewritings",
      {
        formality: "default",
        max_tokens: 2048,
        mode: "voice_active",
        model: "claude-3-haiku",
        n: 1,
        source_lang: "en",
        target_lang: "en",
        temperature: null,
        text: text,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.TEXTCORTEX_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.data && response.data.data && response.data.data.outputs && response.data.data.outputs.length > 0) {
      const rewrittenText = response.data.data.outputs[0].text;

      await userRef.update({
        aiRewrites: user.aiRewrites + 1,
      });

      res.json({
        rewrittenText: rewrittenText,
      });
    } else {
      res.status(500).json({
        error: "No outputs found in the response. Response data: " + JSON.stringify(response.data),
      });
    }
  }  catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ error: "Failed to rewrite text" });
  }
});

module.exports = router;
