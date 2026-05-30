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

// SIMPLIFIED EXTRACTION - just look for digits
function extractLeadInfo(transcript) {
    const lead = { name: null, postcode: null, phone: null };
    const lines = transcript.split('\n');
    let lastPhone = null;
    let lastPostcode = null;
    let lastName = null;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Get name - look for "first name" question followed by User response
        if (line.toLowerCase().includes('first name') && i + 1 < lines.length && lines[i + 1].startsWith('User:')) {
            const nameText = lines[i + 1].substring(5);
            // Take first word that looks like a name (2+ letters)
            const words = nameText.split(' ');
            for (const word of words) {
                if (word.match(/^[A-Za-z]{2,}$/)) {
                    lastName = word;
                    break;
                }
            }
        }
        
        // Process User lines for phone and postcode
        if (line.startsWith('User:')) {
            const userText = line.substring(5);
            
            // PHONE: extract ALL digits, then find UK pattern
            const digits = userText.replace(/\D/g, '');
            console.log(`Digits found in line: "${digits}"`);
            
            if (digits.length >= 10) {
                // Look for '07' pattern (UK mobile)
                const sevenIndex = digits.indexOf('07');
                if (sevenIndex !== -1) {
                    let potentialPhone = digits.substring(sevenIndex);
                    if (potentialPhone.length >= 11) {
                        lastPhone = potentialPhone.substring(0, 11);
                    } else if (potentialPhone.length === 10) {
                        lastPhone = '0' + potentialPhone;
                    }
                    console.log(`Phone extracted: ${lastPhone}`);
                }
            }
            
            // POSTCODE: look for UK postcode pattern
            const upperText = userText.toUpperCase();
            const postcodeMatch = upperText.match(/[A-Z]{1,2}[0-9]{1,2}[A-Z]?\s?[0-9][A-Z]{2}/);
            if (postcodeMatch) {
                lastPostcode = postcodeMatch[0];
                console.log(`Postcode extracted: ${lastPostcode}`);
            }
        }
    }
    
    // Clean up postcode (add space if missing)
    if (lastPostcode && lastPostcode.length === 7 && !lastPostcode.includes(' ')) {
        lastPostcode = lastPostcode.substring(0, 4) + ' ' + lastPostcode.substring(4);
    }
    
    // Clean up name
    if (lastName) {
        lead.name = lastName.charAt(0).toUpperCase() + lastName.slice(1).toLowerCase();
    }
    
    lead.postcode = lastPostcode ? lastPostcode.toUpperCase() : null;
    lead.phone = lastPhone;
    
    console.log('=== FINAL EXTRACTED ===');
    console.log(`Name: ${lead.name}`);
    console.log(`Postcode: ${lead.postcode}`);
    console.log(`Phone: ${lead.phone}`);
    
    return lead;
}

app.post('/retell-webhook', (req, res) => {
    const { event, call } = req.body;
    
    console.log('=== Webhook Received ===');
    console.log('Event:', event);
    
    // Respond immediately
    res.status(200).json({ received: true });
    
    if (event === 'call_ended' && call) {
        console.log('=== Full Transcript ===');
        console.log(call.transcript);
        
        const leadInfo = extractLeadInfo(call.transcript);
        
        if (leadInfo.phone && CONTRACTOR_PHONE_NUMBER) {
            const smsBody = `New Lead!\n\nName: ${leadInfo.name || 'Not provided'}\nPostcode: ${leadInfo.postcode || 'Not provided'}\nPhone: ${leadInfo.phone}`;
            
            twilioClient.messages.create({
                body: smsBody,
                from: TWILIO_PHONE_NUMBER,
                to: CONTRACTOR_PHONE_NUMBER
            })
            .then(() => console.log('✅ SMS sent successfully'))
            .catch(err => console.error('❌ Failed to send SMS:', err.message));
        } else {
            console.log('❌ Cannot send SMS - missing phone or contractor number');
            console.log(`Phone extracted: ${leadInfo.phone}`);
            console.log(`Contractor number: ${CONTRACTOR_PHONE_NUMBER}`);
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Retell webhook endpoint: http://localhost:${PORT}/retell-webhook`);
});
