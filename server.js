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

function findPhoneNumber(text) {
    if (!text) return null;
    const digits = text.replace(/\D/g, '');
    console.log(`All digits found: "${digits}"`);
    
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
    
    // ALWAYS respond immediately
    res.status(200).json({ received: true });
    
    // Process after responding (no await needed)
    if (event === 'call_ended' && call) {
        try {
            const transcript = call.transcript || '';
            console.log('=== Full Transcript ===');
            console.log(transcript);
            
            const phoneNumber = findPhoneNumber(transcript);
            
            if (phoneNumber && CONTRACTOR_PHONE_NUMBER) {
                twilioClient.messages.create({
                    body: `New Lead!\nPhone: ${phoneNumber}`,
                    from: TWILIO_PHONE_NUMBER,
                    to: CONTRACTOR_PHONE_NUMBER
                })
                .then(() => console.log('✅ SMS sent successfully'))
                .catch(err => console.error('❌ SMS error:', err.message));
            } else {
                console.log('❌ No phone number found');
            }
        } catch (error) {
            console.error('Error:', error.message);
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
