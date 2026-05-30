const express = require('express');
const twilio = require('twilio');
const app = express();
const PORT = process.env.PORT || 3000;

// Twilio configuration
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

// Function to extract name, postcode, phone from transcript
function extractLeadInfo(transcript) {
    const lead = {
        name: null,
        postcode: null,
        phone: null
    };
    
    const lines = transcript.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Extract name - look for User response after name request
        if (line.includes('first name') && i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            if (nextLine.startsWith('User:')) {
                const nameMatch = nextLine.match(/User:\s*([A-Za-z]+)/i);
                if (nameMatch && !lead.name) {
                    lead.name = nameMatch[1];
                }
            }
        }
        
        // Only process User lines for postcode and phone
        if (line.startsWith('User:')) {
            // Extract postcode (UK format) - looks for patterns like BS13 7DP or BS137DP
            const postcodeMatch = line.match(/[A-Z]{1,2}[0-9]{1,2}[A-Z]?\s?[0-9][A-Z]{2}/i);
            if (postcodeMatch && !lead.postcode) {
                let postcode = postcodeMatch[0].toUpperCase();
                // Add space if missing (BS137DP -> BS13 7DP)
                if (postcode.length === 7 && !postcode.includes(' ')) {
                    postcode = postcode.substring(0, 4) + ' ' + postcode.substring(4);
                }
                lead.postcode = postcode;
            }
            
            // Extract phone number - looks for 0 followed by 10-11 digits
            // Remove spaces first, then find the number
            const cleanLine = line.replace(/\s/g, '');
            const phoneMatch = cleanLine.match(/0[0-9]{10,11}/);
            if (phoneMatch && !lead.phone) {
                let phoneNumber = phoneMatch[0];
                // If 12 digits, take first 11
                if (phoneNumber.length === 12) {
                    phoneNumber = phoneNumber.substring(0, 11);
                }
                lead.phone = phoneNumber;
            }
        }
    }
    
    return lead;
}

app.post('/retell-webhook', (req, res) => {
    const { event, call } = req.body;

    console.log('=== Webhook Received ===');
    console.log('Event:', event);

    // Respond immediately
    res.status(200).json({ received: true });

    // Process after responding
    if (event === 'call_ended' && call) {
        // Log the full transcript
        console.log('=== Full Transcript ===');
        console.log(call.transcript);
        
        // Extract lead info from transcript
        const leadInfo = extractLeadInfo(call.transcript);
        console.log('=== Extracted Lead Info ===');
        console.log(leadInfo);
        
        // Send SMS to contractor if we have a phone number
        if (leadInfo.phone && CONTRACTOR_PHONE_NUMBER) {
            const smsBody = `New Lead from FlowSpeak!\n\nName: ${leadInfo.name || 'Not provided'}\nPostcode: ${leadInfo.postcode || 'Not provided'}\nPhone: ${leadInfo.phone}\n\nCheck full conversation in dashboard.`;
            
            twilioClient.messages.create({
                body: smsBody,
                from: TWILIO_PHONE_NUMBER,
                to: CONTRACTOR_PHONE_NUMBER
            })
            .then(() => console.log('SMS sent successfully'))
            .catch(err => console.error('Failed to send SMS:', err));
        } else {
            console.log('No phone number found or missing contractor number');
            console.log('leadInfo.phone:', leadInfo.phone);
            console.log('CONTRACTOR_PHONE_NUMBER:', CONTRACTOR_PHONE_NUMBER);
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Retell webhook endpoint: http://localhost:${PORT}/retell-webhook`);
});
