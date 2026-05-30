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

// SAFEGUARD 1: Phone number validation and correction
function validatePhoneNumber(phone) {
    // Remove all non-digits
    let clean = phone.replace(/\D/g, '');
    
    // UK numbers: 11 digits starting with 07
    if (clean.length === 12 && clean.startsWith('07')) {
        // Remove extra digit (common mistake)
        clean = clean.substring(0, 11);
        console.log(`📞 Fixed: Removed extra digit → ${clean}`);
    }
    
    if (clean.length === 10 && clean.startsWith('7')) {
        // Missing leading zero
        clean = '0' + clean;
        console.log(`📞 Fixed: Added leading zero → ${clean}`);
    }
    
    // Validate final format
    if (clean.match(/^07[0-9]{9}$/)) {
        return clean;
    }
    
    return null;
}

// SAFEGUARD 2: Postcode validation and correction
function validatePostcode(postcode) {
    let clean = postcode.toUpperCase().replace(/\s/g, '');
    
    // Common UK postcode patterns
    const patterns = [
        /^[A-Z]{1,2}[0-9]{1,2}[A-Z]?[0-9][A-Z]{2}$/,  // Standard
        /^[A-Z]{1,2}[0-9]{1,2}[A-Z]?\s[0-9][A-Z]{2}$/ // With space
    ];
    
    // Add space if missing (BS137DP → BS13 7DP)
    if (clean.length === 7 && !clean.includes(' ')) {
        clean = clean.substring(0, 4) + ' ' + clean.substring(4);
        console.log(`📮 Fixed: Formatted postcode → ${clean}`);
    }
    
    // Validate
    for (const pattern of patterns) {
        if (pattern.test(clean)) {
            return clean;
        }
    }
    
    // Fuzzy match for common mistakes
    const corrections = {
        'BS13 70P': 'BS13 7DP',
        'BS13 7OP': 'BS13 7DP',
        'BS1370P': 'BS13 7DP'
    };
    
    if (corrections[clean]) {
        console.log(`📮 Fixed: Corrected postcode ${clean} → ${corrections[clean]}`);
        return corrections[clean];
    }
    
    return null;
}

// SAFEGUARD 3: Name validation (remove extra words)
function validateName(name) {
    if (!name) return null;
    
    // Remove common prefixes
    let clean = name.replace(/^(my name is|it's|this is|im|i am)/i, '').trim();
    
    // Take only first word (first name only)
    clean = clean.split(' ')[0];
    
    // Capitalize first letter
    clean = clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
    
    return clean || null;
}

// SAFEGUARD 4: Detect customer frustration/anger
function detectFrustration(transcript) {
    const frustrationKeywords = [
        'frustrated', 'angry', 'annoying', 'useless', 'stupid',
        'not working', 'doesn\'t understand', 'human', 'person',
        'terrible', 'awful', 'waste of time', 'repeat', 'again'
    ];
    
    const lowerTranscript = transcript.toLowerCase();
    
    for (const keyword of frustrationKeywords) {
        if (lowerTranscript.includes(keyword)) {
            console.log(`⚠️ Frustration detected: "${keyword}"`);
            return true;
        }
    }
    return false;
}

// SAFEGUARD 5: Check if customer asked for a human
function wantsHuman(transcript) {
    const humanKeywords = [
        'human', 'person', 'real person', 'talk to someone',
        'speak to a human', 'agent', 'representative', 'operator'
    ];
    
    const lowerTranscript = transcript.toLowerCase();
    
    for (const keyword of humanKeywords) {
        if (lowerTranscript.includes(keyword)) {
            console.log(`👤 Customer requested human: "${keyword}"`);
            return true;
        }
    }
    return false;
}

// SAFEGUARD 6: Confidence scoring for extracted data
function calculateConfidence(leadInfo) {
    let score = 0;
    let issues = [];
    
    if (leadInfo.name && leadInfo.name.length > 1) {
        score += 25;
    } else {
        issues.push('name missing or too short');
    }
    
    if (leadInfo.postcode) {
        score += 25;
    } else {
        issues.push('postcode missing');
    }
    
    if (leadInfo.phone) {
        score += 25;
    } else {
        issues.push('phone missing');
    }
    
    // Bonus for valid formats
    if (leadInfo.phone && leadInfo.phone.match(/^07[0-9]{9}$/)) {
        score += 15;
    }
    if (leadInfo.postcode && leadInfo.postcode.match(/[A-Z]{1,2}[0-9]{1,2}\s[0-9][A-Z]{2}/)) {
        score += 10;
    }
    
    return { score, issues };
}

// Main extraction function with all safeguards
function extractLeadInfo(transcript) {
    const lead = {
        name: null,
        postcode: null,
        phone: null,
        raw: {
            name: null,
            postcode: null,
            phone: null
        }
    };
    
    const lines = transcript.split('\n');
    let possibleNames = [];
    let possiblePostcodes = [];
    let possiblePhones = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Extract name
        if (line.includes('first name') && i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            if (nextLine.startsWith('User:')) {
                const nameMatch = nextLine.match(/User:\s*(?:My name is |My first name is |It's |This is )?([A-Za-z]+)/i);
                if (nameMatch) {
                    possibleNames.push(nameMatch[1]);
                }
            }
        }
        
        // Only process User lines
        if (line.startsWith('User:')) {
            // Extract postcode
            const postcodeMatch = line.match(/[A-Z]{1,2}[0-9]{1,2}[A-Z]?\s?[0-9][A-Z]{2}/i);
            if (postcodeMatch) {
                possiblePostcodes.push(postcodeMatch[0]);
            }
            
            // Extract phone
            const cleanLine = line.replace(/\s/g, '');
            const phoneMatch = cleanLine.match(/0[0-9]{10,12}/);
            if (phoneMatch) {
                possiblePhones.push(phoneMatch[0]);
            }
        }
    }
    
    // Take last value (self-correction) and validate
    if (possibleNames.length > 0) {
        lead.raw.name = possibleNames[possibleNames.length - 1];
        lead.name = validateName(lead.raw.name);
    }
    
    if (possiblePostcodes.length > 0) {
        lead.raw.postcode = possiblePostcodes[possiblePostcodes.length - 1];
        lead.postcode = validatePostcode(lead.raw.postcode);
    }
    
    if (possiblePhones.length > 0) {
        lead.raw.phone = possiblePhones[possiblePhones.length - 1];
        lead.phone = validatePhoneNumber(lead.raw.phone);
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
        
        // SAFEGUARD 4 & 5: Check for frustration or human request
        const isFrustrated = detectFrustration(call.transcript);
        const wantsHumanAgent = wantsHuman(call.transcript);
        
        if (isFrustrated) {
            console.log('⚠️⚠️⚠️ CUSTOMER SHOWED FRUSTRATION - REVIEW THIS CALL ⚠️⚠️⚠️');
        }
        
        if (wantsHumanAgent) {
            console.log('👤👤👤 CUSTOMER REQUESTED HUMAN AGENT - CONSIDER ESCALATION 👤👤👤');
            // You could trigger an SMS to contractor here
        }
        
        // Extract lead info with all safeguards
        const leadInfo = extractLeadInfo(call.transcript);
        
        // SAFEGUARD 6: Confidence scoring
        const confidence = calculateConfidence(leadInfo);
        
        console.log('=== Extracted Lead Info ===');
        console.log(leadInfo);
        console.log('=== Confidence Score ===');
        console.log(`Score: ${confidence.score}/100`);
        console.log(`Issues: ${confidence.issues.join(', ') || 'None'}`);
        
        // SAFEGUARD: Only send SMS if confidence is high enough
        const MIN_CONFIDENCE = 50;
        
        if (confidence.score >= MIN_CONFIDENCE && leadInfo.phone && CONTRACTOR_PHONE_NUMBER) {
            // Add quality warning to SMS if confidence is medium
            let qualityWarning = '';
            if (confidence.score < 75) {
                qualityWarning = '\n\n⚠️ Please verify this information with the customer.';
            }
            
            const smsBody = `New Lead from FlowSpeak!\n\nName: ${leadInfo.name || 'Not provided'}\nPostcode: ${leadInfo.postcode || 'Not provided'}\nPhone: ${leadInfo.phone}\nConfidence: ${confidence.score}%${qualityWarning}\n\nCheck full conversation in dashboard.`;
            
            twilioClient.messages.create({
                body: smsBody,
                from: TWILIO_PHONE_NUMBER,
                to: CONTRACTOR_PHONE_NUMBER
            })
            .then(() => console.log('SMS sent successfully'))
            .catch(err => console.error('Failed to send SMS:', err));
        } else if (confidence.score < MIN_CONFIDENCE) {
            console.log(`⚠️ Confidence too low (${confidence.score}%). SMS not sent.`);
            console.log('Issues to resolve:', confidence.issues);
            
            // Optionally send alert to contractor about failed extraction
            if (CONTRACTOR_PHONE_NUMBER) {
                const alertBody = `⚠️ FlowSpeak Alert: Could not extract customer info (Confidence: ${confidence.score}%). Issues: ${confidence.issues.join(', ')}. Check dashboard for call recording.`;
                
                twilioClient.messages.create({
                    body: alertBody,
                    from: TWILIO_PHONE_NUMBER,
                    to: CONTRACTOR_PHONE_NUMBER
                })
                .then(() => console.log('Alert SMS sent to contractor'))
                .catch(err => console.error('Failed to send alert:', err));
            }
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
