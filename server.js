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

// SUPER SIMPLE - just find all digits and look for 07
function findPhoneNumber(text) {
    // Remove everything except digits
    const digits = text.replace(/\D/g, '');
    console.log(`All digits found: "${digits}"`);
    
    // Look for '07' pattern
    const index = digits.indexOf('07');
    if (index !== -1) {
        const phone = digits.substring(index, index + 11);
        if (phone.length === 11 && phone.startsWith('07')) {
            console.log(`✅ Phone found: ${phone}`);
            return phone;
        }
    }
    
    return null;
}

app.post('/retell-webhook', (req, res) => {
    const { event, call } = req.body;
    
    console.log('=== Webhook Received ===');
    console.log('Event:', event);
    
    res.status(200).json({ received: true });
    
    if (event === 'call_ended' && call) {
        // Get the full transcript
        const transcript = call.transcript || '';
        console.log('=== Full Transcript ===');
        console.log(transcript);
        
        // Extract phone number from transcript
        const phoneNumber = findPhoneNumber(transcript);
        
        if (phoneNumber && CONTRACTOR_PHONE_NUMBER) {
            const smsBody = `New Lead!\nPhone: ${phoneNumber}`;
            
            twilioClient.messages.create({
                body: smsBody,
                from: TWILIO_PHONE_NUMBER,
                to: CONTRACTOR_PHONE_NUMBER
            })
            .then(() => console.log('✅ SMS sent successfully'))
            .catch(err => console.error('❌ Failed to send SMS:', err.message));
        } else {
            console.log('❌ No phone number found');
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
