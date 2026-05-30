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
    
    // Respond immediately
    res.status(200).json({ received: true });
    
    if (event === 'call_ended' && call) {
        console.log('=== Full Transcript ===');
        console.log(call.transcript);
        
        // READ VARIABLES DIRECTLY FROM RETELL (MOST RELIABLE)
        const variables = call.variables || {};
        const retellPhone = variables['phone number']; // Note the space in the name
        const retellName = variables['name'];
        const retellPostcode = variables['postcode'];
        
        console.log('=== Variables from Retell ===');
        console.log(`Name from Retell: ${retellName}`);
        console.log(`Postcode from Retell: ${retellPostcode}`);
        console.log(`Phone from Retell: ${retellPhone}`);
        
        // Use Retell's extracted data if available
        let leadInfo = {
            name: retellName,
            postcode: retellPostcode,
            phone: retellPhone
        };
        
        // If Retell didn't provide variables, fall back to transcript parsing
        if (!leadInfo.phone) {
            console.log('No phone variable found, falling back to transcript parsing...');
            leadInfo = extractFromTranscript(call.transcript);
        }
        
        console.log('=== Final Lead Info ===');
        console.log(leadInfo);
        
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
            console.log('❌ Cannot send SMS - missing phone');
            console.log(`Phone: ${leadInfo.phone}`);
        }
    }
});

// Fallback: parse transcript (keep this as backup)
function extractFromTranscript(transcript) {
    const lead = { name: null, postcode: null, phone: null };
    const lines = transcript.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.toLowerCase().includes('first name') && i + 1 < lines.length && lines[i + 1].startsWith('User:')) {
            const nameText = lines[i + 1].substring(5);
            const words = nameText.split(' ');
            for (const word of words) {
                if (word.match(/^[A-Za-z]{2,}$/)) {
                    lead.name = word;
                    break;
                }
            }
        }
        
        if (line.startsWith('User:')) {
            const userText = line.substring(5);
            const digits = userText.replace(/\D/g, '');
            
            if (digits.length >= 10) {
                const sevenIndex = digits.indexOf('07');
                if (sevenIndex !== -1) {
                    let potentialPhone = digits.substring(sevenIndex);
                    if (potentialPhone.length >= 11) {
                        lead.phone = potentialPhone.substring(0, 11);
                    }
                }
            }
            
            const upperText = userText.toUpperCase();
            const postcodeMatch = upperText.match(/[A-Z]{1,2}[0-9]{1,2}[A-Z]?\s?[0-9][A-Z]{2}/);
            if (postcodeMatch) {
                lead.postcode = postcodeMatch[0];
                if (lead.postcode.length === 7 && !lead.postcode.includes(' ')) {
                    lead.postcode = lead.postcode.substring(0, 4) + ' ' + lead.postcode.substring(4);
                }
            }
        }
    }
    
    if (lead.name) {
        lead.name = lead.name.charAt(0).toUpperCase() + lead.name.slice(1).toLowerCase();
    }
    if (lead.postcode) {
        lead.postcode = lead.postcode.toUpperCase();
    }
    
    return lead;
}

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
