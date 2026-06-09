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

// Endpoint for Retell Code node (kept for compatibility)
app.post('/send-sms', (req, res) => {
    const { name, postcode, phone, cleanType, dateTime } = req.body;
    
    console.log('=== SMS Request ===');
    console.log('Name:', name);
    console.log('Postcode:', postcode);
    console.log('Phone:', phone);
    console.log('Clean type:', cleanType);
    console.log('Date & Time:', dateTime);
    
    if (phone && CONTRACTOR_PHONE_NUMBER) {
        twilioClient.messages.create({
            body: `New lead!\nName: ${name || '?'}\nPostcode: ${postcode || '?'}\nPhone: ${phone}\nClean type: ${cleanType || '?'}\nDate & Time: ${dateTime || '?'}`,
            from: TWILIO_PHONE_NUMBER,
            to: CONTRACTOR_PHONE_NUMBER
        })
        .then(() => {
            console.log('✅ SMS sent');
            res.json({ success: true });
        })
        .catch(err => {
            console.error('❌ SMS error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        });
    } else {
        console.log('❌ Missing phone');
        res.status(400).json({ success: false, error: 'Missing phone' });
    }
});

// Backup webhook
app.post('/retell-webhook', (req, res) => {
    res.status(200).send('OK');
});

// Post-call webhook - FINAL WORKING VERSION
app.post('/post-call-webhook', (req, res) => {
    const body = req.body;
    
    console.log('🔔 WEBHOOK RECEIVED');
    console.log('Event type:', body.event);
    
    let name = '', postcode = '', phone = '', cleanType = '', dateTime = '';
    
    // Data is in call.collected_dynamic_variables
    if (body.call && body.call.collected_dynamic_variables) {
        const data = body.call.collected_dynamic_variables;
        name = data.name || '';
        postcode = data.postcode || '';
        phone = data.phone || '';
        cleanType = data.cleanType || '';
        dateTime = data.dateTime || '';
        console.log('✅ Found in call.collected_dynamic_variables');
    } else {
        console.log('⚠️ No collected_dynamic_variables found');
        console.log('📦 Body keys:', Object.keys(body));
        if (body.call) {
            console.log('📦 call keys:', Object.keys(body.call));
        }
    }
    
    console.log('=== Extracted Data ===');
    console.log('Name:', name);
    console.log('Postcode:', postcode);
    console.log('Phone:', phone);
    console.log('Clean type:', cleanType);
    console.log('Date & Time:', dateTime);
    
    if (phone && CONTRACTOR_PHONE_NUMBER) {
        twilioClient.messages.create({
            body: `New lead!\nName: ${name || '?'}\nPostcode: ${postcode || '?'}\nPhone: ${phone}\nClean type: ${cleanType || '?'}\nDate & Time: ${dateTime || '?'}`,
            from: TWILIO_PHONE_NUMBER,
            to: CONTRACTOR_PHONE_NUMBER
        })
        .then(() => {
            console.log('✅ SMS sent from post-call webhook');
            res.status(200).send('OK');
        })
        .catch(err => {
            console.error('❌ SMS error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        });
    } else {
        console.log('❌ Missing phone or contractor number');
        res.status(200).send('OK');
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
