const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
    res.send('FlowSpeak backend is running!');
});

app.post('/retell-webhook', (req, res) => {
    const { event, call } = req.body;
    
    console.log('=== Webhook Received ===');
    console.log('Event:', event);
    
    // Respond immediately
    res.status(200).json({ received: true });
    
    // Process after responding
    if (event === 'call_ended' && call) {
        // Print the ENTIRE call_analysis object
        console.log('=== Full call_analysis ===');
        console.log(JSON.stringify(call.call_analysis, null, 2));
        
        // Try to extract custom data
        const customData = call.call_analysis?.custom_analysis_data || {};
        console.log('=== Custom Analysis Data ===');
        console.log(JSON.stringify(customData, null, 2));
        
        // Also print the transcript to see what was said
        console.log('=== Transcript ===');
        console.log(call.transcript);
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Retell webhook endpoint: http://localhost:${PORT}/retell-webhook`);
});
