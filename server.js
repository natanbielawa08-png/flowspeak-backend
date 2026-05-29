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
        
        // Extract name
        if (line.includes('first name') && i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            const nameMatch = nextLine.match(/User: (?:My first name is )?([A-Za-z]+)/i);
            if (nameMatch) lead.name = nameMatch[1];
        }
        
        // Extract postcode (UK format)
        const postcodeMatch = line.match(/[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}/i);
        if (postcodeMatch && !lead.postcode) {
            lead.postcode = postcodeMatch[0].toUpperCase();
        }
        
        // Extract phone number (handles spaces, dots, and dashes)
        const phoneMatch = line.match(/0[0-9\s\.\-]{10,15}/);
        if (phoneMatch && !lead.phone) {
            // Remove spaces, dots, dashes and keep only digits
            let phoneNumber = phoneMatch[0].replace(/[\s\.\-]/g, '');
            // Make sure it starts with 0 and has 11 digits
            if (phoneNumber.match(/^0[0-9]{10}$/)) {
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
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Retell webhook endpoint: http://localhost:${PORT}/retell-webhook`);
});
