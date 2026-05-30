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

function extractFromConfirmation(text) {
    // Look for pattern: "I have NAME at postcode POSTCODE with phone number PHONE"
    const nameMatch = text.match(/I have ([A-Za-z]+)/i);
    const postcodeMatch = text.match(/postcode ([A-Z0-9\s]{6,8})/i);
    const phoneMatch = text.match(/phone number ([0-9\s]{10,12})/i);
    
    return {
        name: nameMatch ? nameMatch[1] : null,
        postcode: postcodeMatch ? postcodeMatch[1].trim().toUpperCase() : null,
        phone: phoneMatch ? phoneMatch[1].replace(/\s/g, '') : null
    };
}

app.post('/retell-webhook', (req, res) => {
    const { event, call } = req.body;
    
    console.log('Webhook received:', event);
    res.status(200).send('OK');
    
    if (event === 'call_ended' && call) {
        const transcript = call.transcript || '';
        console.log('Transcript:', transcript);
        
        // Find the confirmation message (last Agent message before User says Yes)
        const lines = transcript.split('\n');
        let confirmationLine = null;
        
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('confirm') && lines[i].includes('I have')) {
                confirmationLine = lines[i];
                break;
            }
        }
        
        if (confirmationLine) {
            const lead = extractFromConfirmation(confirmationLine);
            console.log('Extracted:', lead);
            
            if (lead.phone && CONTRACTOR_PHONE_NUMBER) {
                twilioClient.messages.create({
                    body: `New lead!\nName: ${lead.name}\nPostcode: ${lead.postcode}\nPhone: ${lead.phone}`,
                    from: TWILIO_PHONE_NUMBER,
                    to: CONTRACTOR_PHONE_NUMBER
                })
                .then(() => console.log('SMS sent'))
                .catch(err => console.error('SMS error:', err.message));
            }
        } else {
            console.log('No confirmation found');
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
