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

// Helper function to try multiple variations of a variable name
function getValue(obj, ...possibleNames) {
    if (!obj) return '';
    for (let name of possibleNames) {
        if (obj[name] !== undefined && obj[name] !== '') {
            return obj[name];
        }
    }
    // If no exact match, try case-insensitive matching on all keys
    for (let key of Object.keys(obj)) {
        const normalizedKey = key.toLowerCase().replace(/ /g, '');
        for (let possibleName of possibleNames) {
            const normalizedPossible = possibleName.toLowerCase().replace(/ /g, '');
            if (normalizedKey === normalizedPossible) {
                return obj[key];
            }
        }
    }
    return '';
}

app.post('/send-sms', (req, res) => {
    const { name, postcode, phone, cleanType, dateTime, bookingType } = req.body;
    
    console.log('=== SMS Request ===');
    console.log('Booking Type:', bookingType);
    console.log('Name:', name);
    console.log('Postcode:', postcode);
    console.log('Phone:', phone);
    console.log('Clean type:', cleanType);
    console.log('Date & Time:', dateTime);
    
    if (phone && CONTRACTOR_PHONE_NUMBER) {
        twilioClient.messages.create({
            body: `New ${bookingType || 'booking'}!\nName: ${name || '?'}\nPostcode: ${postcode || '?'}\nPhone: ${phone}\nClean type: ${cleanType || '?'}\nDate & Time: ${dateTime || '?'}`,
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

app.post('/retell-webhook', (req, res) => {
    res.status(200).send('OK');
});

app.post('/post-call-webhook', (req, res) => {
    const body = req.body;
    
    console.log('🔔 WEBHOOK RECEIVED');
    console.log('Event type:', body.event);
    
    let name = '', postcode = '', phone = '', cleanType = '', dateTime = '', bookingType = '';
    
    // PRIMARY SOURCE: collected_dynamic_variables (from Extract Variable nodes)
    if (body.call && body.call.collected_dynamic_variables) {
        const data = body.call.collected_dynamic_variables;
        
        name = getValue(data, 'name', 'Name', 'full_name', 'fullName');
        postcode = getValue(data, 'postcode', 'Postcode', 'post_code', 'postCode', 'zip', 'postal_code');
        phone = getValue(data, 'phone', 'Phone', 'phone_number', 'phoneNumber', 'mobile', 'Mobile');
        cleanType = getValue(data, 'cleanType', 'CleanType', 'clean_type', 'clean type', 'type_of_cleaning', 'cleaningType');
        dateTime = getValue(data, 'dateTime', 'DateTime', 'date_time', 'date time', 'date_and_time', 'date and time', 'appointment_time');
        bookingType = getValue(data, 'bookingType', 'BookingType', 'booking_type', 'booking type', 'intent', 'call_type', 'callType');
        
        console.log('✅ Found in call.collected_dynamic_variables');
        console.log('📦 Keys received from Retell:', Object.keys(data));
    } else {
        console.log('⚠️ No collected_dynamic_variables found');
    }
    
    // FALLBACK SOURCE: custom_analysis_data (post-call analysis, always available)
    // This catches any fields that might have been missed by Extract Variable nodes
    if (body.call_analysis && body.call_analysis.custom_analysis_data) {
        const fallback = body.call_analysis.custom_analysis_data;
        
        // Only use fallback if primary source didn't have the value
        if (!name) name = getValue(fallback, 'name', 'Name', 'full_name', 'fullName');
        if (!postcode) postcode = getValue(fallback, 'postcode', 'Postcode', 'post_code', 'postCode');
        if (!phone) phone = getValue(fallback, 'phone', 'Phone', 'phone_number', 'phoneNumber', 'mobile');
        if (!cleanType) cleanType = getValue(fallback, 'cleanType', 'CleanType', 'clean_type', 'clean type', 'type_of_cleaning', 'type of cleaning');
        if (!dateTime) dateTime = getValue(fallback, 'dateTime', 'DateTime', 'date_time', 'date time', 'date_and_time', 'date and time');
        if (!bookingType) bookingType = getValue(fallback, 'bookingType', 'BookingType', 'booking_type', 'booking type', 'intent', 'call_type');
        
        console.log('📦 Fallback keys from custom_analysis_data:', Object.keys(fallback));
    }
    
    console.log('=== Extracted Data ===');
    console.log('Booking Type:', bookingType);
    console.log('Name:', name);
    console.log('Postcode:', postcode);
    console.log('Phone:', phone);
    console.log('Clean type:', cleanType);
    console.log('Date & Time:', dateTime);
    
    if (phone && CONTRACTOR_PHONE_NUMBER) {
        twilioClient.messages.create({
            body: `New ${bookingType || 'booking'}!\nName: ${name || '?'}\nPostcode: ${postcode || '?'}\nPhone: ${phone}\nClean type: ${cleanType || '?'}\nDate & Time: ${dateTime || '?'}`,
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
