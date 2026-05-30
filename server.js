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

function validatePhoneNumber(phone) {
    if (!phone) return null;
    
    const wordMap = {
        'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
        'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9', 'oh': '0'
    };
    
    let converted = phone.toLowerCase();
    for (const [word, digit] of Object.entries(wordMap)) {
        converted = converted.replace(new RegExp(`\\b${word}\\b`, 'g'), digit);
    }
    
    let clean = converted.replace(/\D/g, '');
    
    if (clean.length === 12 && clean.startsWith('07')) {
        clean = clean.substring(0, 11);
    }
    if (clean.length === 10 && clean.startsWith('7')) {
        clean = '0' + clean;
    }
    
    return clean.match(/^07[0-9]{9}$/) ? clean : null;
}

function validatePostcode(postcode) {
    if (!postcode) return null;
    
    const wordMap = {
        'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
        'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9',
        'bee': 'B', 'see': 'C', 'dee': 'D', 'gee': 'G', 'pee': 'P',
        'are': 'R', 'ess': 'S', 'tee': 'T', 'why': 'Y', 'ex': 'X',
        'zed': 'Z', 'aitch': 'H', 'jay': 'J', 'kay': 'K', 'ell': 'L',
        'em': 'M', 'en': 'N', 'cue': 'Q', 'you': 'U', 'vee': 'V', 'double you': 'W'
    };
    
    let converted = postcode.toLowerCase();
    for (const [word, letter] of Object.entries(wordMap)) {
        converted = converted.replace(new RegExp(`\\b${word}\\b`, 'g'), letter);
    }
    
    let clean = converted.replace(/\s/g, '').toUpperCase();
    
    if (clean.length === 7 && !clean.includes(' ')) {
        clean = clean.substring(0, 4) + ' ' + clean.substring(4);
    }
    
    return clean.match(/^[A-Z]{1,2}[0-9]{1,2}[A-Z]?\s[0-9][A-Z]{2}$/) ? clean : null;
}

function validateName(name) {
    if (!name) return null;
    let clean = name.replace(/^(my name is|it's|this is|im|i am)/i, '').trim();
    clean = clean.split(' ')[0];
    return clean ? clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase() : null;
}

function extractLeadInfo(transcript) {
    const lead = { name: null, postcode: null, phone: null };
    const lines = transcript.split('\n');
    let lastPhone = null, lastPostcode = null, lastName = null;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.toLowerCase().includes('first name') && i + 1 < lines.length && lines[i + 1].startsWith('User:')) {
            const match = lines[i + 1].match(/User:\s*(?:My name is |My first name is )?([A-Za-z]+)/i);
            if (match) lastName = match[1];
        }
        
        if (line.startsWith('User:')) {
            const userText = line.substring(5);
            
            const phoneMatch = userText.match(/0[0-9\s\.\-]{9,15}/);
            if (phoneMatch) lastPhone = phoneMatch[0];
            
            const postcodeMatch = userText.match(/[A-Z]{1,2}[0-9]{1,2}[A-Z]?\s?[0-9][A-Z]{2}|\b(?:BS|B|BA|SN|GL)[0-9]{1,2}\s?[0-9][A-Z]{2}/i);
            if (postcodeMatch) lastPostcode = postcodeMatch[0];
        }
    }
    
    lead.name = validateName(lastName);
    lead.postcode = validatePostcode(lastPostcode);
    lead.phone = validatePhoneNumber(lastPhone);
    
    return lead;
}

app.post('/retell-webhook', (req, res) => {
    const { event, call } = req.body;
    console.log('=== Webhook Received ===', event);
    res.status(200).json({ received: true });
    
    if (event === 'call_ended' && call) {
        console.log('=== Transcript ===\n', call.transcript);
        const leadInfo = extractLeadInfo(call.transcript);
        console.log('=== Extracted ===\n', leadInfo);
        
        if (leadInfo.phone && CONTRACTOR_PHONE_NUMBER) {
            const smsBody = `New Lead!\nName: ${leadInfo.name || '?'}\nPostcode: ${leadInfo.postcode || '?'}\nPhone: ${leadInfo.phone}`;
            twilioClient.messages.create({
                body: smsBody,
                from: TWILIO_PHONE_NUMBER,
                to: CONTRACTOR_PHONE_NUMBER
            })
            .then(() => console.log('✅ SMS sent'))
            .catch(err => console.error('❌ SMS failed:', err.message));
        } else {
            console.log('❌ No phone extracted');
        }
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
