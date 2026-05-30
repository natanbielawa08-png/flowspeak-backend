const express = require('express');
const twilio = require('twilio');
const app = express();
const PORT = process.env.PORT || 3000;

const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const CONTRACTOR_PHONE_NUMBER = process.env.CONTRACTOR_PHONE_NUMBER;

app.use(express.json());

app.get('/', (req, res) => {
    res.send('FlowSpeak backend is running!');
});

app.post('/retell-webhook', (req, res) => {
    const { event, call } = req.body;
    
    console.log('=== Webhook Received ===');
    console.log('Event:', event);
    
    // LOG THE ENTIRE WEBHOOK TO SEE EVERYTHING
    console.log('=== FULL WEBHOOK BODY ===');
    console.log(JSON.stringify(req.body, null, 2));
    
    res.status(200).json({ received: true });
    
    if (event === 'call_ended' && call) {
        // Check different places where variables might be
        console.log('=== Checking all possible variable locations ===');
        console.log('call.variables:', call.variables);
        console.log('call.custom_analysis_data:', call.call_analysis?.custom_analysis_data);
        console.log('call.user_variables:', call.user_variables);
        
        // Try to find phone number from transcript as fallback
        const transcript = call.transcript || '';
        let extractedPhone = null;
        
        // Look for phone pattern in transcript
        const lines = transcript.split('\n');
        for (const line of lines) {
            if (line.startsWith('User:')) {
                const digits = line.replace(/\D/g, '');
                if (digits.length >= 10) {
                    const sevenIndex = digits.indexOf('07');
                    if (sevenIndex !== -1) {
                        extractedPhone = digits.substring(sevenIndex, sevenIndex + 11);
                        break;
                    }
                }
            }
        }
        
        console.log('=== Extracted Phone from Transcript ===');
        console.log(extractedPhone);
        
        if (extractedPhone && CONTRACTOR_PHONE_NUMBER) {
            const smsBody = `New Lead!\nPhone: ${extractedPhone}`;
            
            twilioClient.messages.create({
                body: smsBody,
                from: TWILIO_PHONE_NUMBER,
                to: CONTRACTOR_PHONE_NUMBER
            })
            .then(() => console.log('✅ SMS sent successfully'))
            .catch(err => console.error('❌ Failed to send SMS:', err.message));
        } else {
            console.log('❌ Cannot send SMS - no phone found');
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
