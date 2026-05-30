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
    // Extract name - after "I have" and before "at postcode"
    const nameMatch = text.match(/I have ([A-Za-z\s]+?) at postcode/i);
    let name = nameMatch ? nameMatch[1].trim() : null;
    // Take first word only (first name)
    if (name) name = name.split(' ')[0];
    
    // Extract postcode - look for BS pattern regardless of spaces or words
    // Matches "B S one three - seven D P" or "BS13 7DP"
    const postcodeMatch = text.match(/postcode\s+([A-Z\s\-0-9]{5,20}?)(?:\s+with|\s+booked|$)/i);
    let postcode = null;
    if (postcodeMatch) {
        let raw = postcodeMatch[1];
        // Convert words to letters/numbers
        raw = raw.toUpperCase()
            .replace(/ONE/g, '1')
            .replace(/TWO/g, '2')
            .replace(/THREE/g, '3')
            .replace(/FOUR/g, '4')
            .replace(/FIVE/g, '5')
            .replace(/SIX/g, '6')
            .replace(/SEVEN/g, '7')
            .replace(/EIGHT/g, '8')
            .replace(/NINE/g, '9')
            .replace(/ZERO/g, '0')
            .replace(/BEE/g, 'B')
            .replace(/SEE/g, 'C')
            .replace(/DEE/g, 'D')
            .replace(/PEE/g, 'P')
            .replace(/ESS/g, 'S')
            .replace(/TEE/g, 'T')
            .replace(/EX/g, 'X')
            .replace(/WHY/g, 'Y')
            .replace(/ZED/g, 'Z');
        
        // Remove spaces and dashes
        let clean = raw.replace(/[\s\-]/g, '');
        
        // Format as proper postcode (BS13 7DP)
        if (clean.length === 7) {
            postcode = clean.substring(0, 4) + ' ' + clean.substring(4);
        } else if (clean.length === 6) {
            postcode = clean.substring(0, 3) + ' ' + clean.substring(3);
        }
    }
    
    // Extract phone - find all digits
    const digits = text.replace(/\D/g, '');
    let phone = null;
    const index = digits.indexOf('07');
    if (index !== -1) {
        phone = digits.substring(index, index + 11);
        if (phone.length !== 11) phone = null;
    }
    
    return { name, postcode, phone };
}

app.post('/retell-webhook', (req, res) => {
    const { event, call } = req.body;
    
    console.log('Webhook received:', event);
    res.status(200).send('OK');
    
    if (event === 'call_ended' && call) {
        const transcript = call.transcript || '';
        
        // Find the confirmation line (looks for "To confirm" or "I have")
        const lines = transcript.split('\n');
        let confirmationLine = null;
        
        for (const line of lines) {
            if ((line.includes('confirm') || line.includes('I have')) && line.includes('postcode')) {
                confirmationLine = line;
                break;
            }
        }
        
        if (confirmationLine) {
            console.log('Confirmation line:', confirmationLine);
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
            } else {
                console.log('Missing phone or contractor number');
            }
        } else {
            console.log('No confirmation line found');
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
