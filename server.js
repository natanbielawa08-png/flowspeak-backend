const express = require('express');
const twilio = require('twilio');
const chrono = require('chrono-node');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;

// ===== Trust proxy for HTTPS behind Render load balancer =====
app.set('trust proxy', 1);
// ===== END trust proxy =====

// ===== Capture raw body for webhook signature validation using verify =====
const rawBodyBuffer = (req, res, buf, encoding) => {
    if (buf && buf.length) {
        req.rawBody = buf.toString(encoding || 'utf8');
    }
};

app.use(express.json({ 
    limit: '10mb',
    verify: rawBodyBuffer
}));
app.use(express.urlencoded({ 
    extended: true, 
    limit: '10mb',
    verify: rawBodyBuffer
}));
// ===== END raw body capture =====

const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

// ===== Twilio message options =====
// Set DISABLE_TWILIO_RISK_CHECK=true in Render while Twilio's
// fraud protection is incorrectly blocking legitimate messages.
function getTwilioOptions(messageData) {
    const options = { ...messageData };

    if (process.env.DISABLE_TWILIO_RISK_CHECK === 'true') {
        options.riskCheck = 'disable';
    }

    return options;
}
// ===== END Twilio message options =====

const CONTRACTOR_PHONE_NUMBER = process.env.CONTRACTOR_PHONE_NUMBER;

// ===== STARTUP: Environment validation =====
function validateEnvironment() {
    const required = [
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN',
        'TWILIO_PHONE_NUMBER',
        'CONTRACTOR_PHONE_NUMBER',
        'CAL_API_KEY'
    ];
    
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        console.error('❌ Missing required environment variables:');
        missing.forEach(key => console.error(`   - ${key}`));
        console.error('\nPlease set these variables and restart the server.');
        process.exit(1);
    }
    
    console.log('✅ All required environment variables are set');
    
    // Optional: Log which optional features are enabled
    if (process.env.DISABLE_TWILIO_RISK_CHECK === 'true') {
        console.log('⚠️ Twilio risk-check is DISABLED (DISABLE_TWILIO_RISK_CHECK=true)');
    } else {
        console.log('✅ Twilio risk-check is ENABLED');
    }
    
    if (process.env.RETELL_API_KEY) {
        console.log('✅ Retell webhook validation is ENABLED');
    } else {
        console.log('⚠️ RETELL_API_KEY not set - Retell webhook validation disabled');
    }
}

validateEnvironment();
// ===== END STARTUP =====

// Track processed calls to prevent duplicate SMS
const processedCalls = new Set();

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

// ===== Phone number normalization =====
// Converts UK phone numbers to E.164 format for consistent comparison
function normalizePhoneNumber(phone) {
    if (!phone) return '';

    // Keep digits only
    let cleaned = String(phone).replace(/\D/g, '');

    // Convert international dialing prefix 00 to +
    // Example: 00447306666123 → +447306666123
    if (cleaned.startsWith('0044')) {
        cleaned = cleaned.substring(4);

        if (cleaned.startsWith('0')) {
            cleaned = cleaned.substring(1);
        }

        return `+44${cleaned}`;
    }

    // UK country code without +
    // Example: 447306666123 → +447306666123
    if (cleaned.startsWith('44')) {
        cleaned = cleaned.substring(2);

        if (cleaned.startsWith('0')) {
            cleaned = cleaned.substring(1);
        }

        return `+44${cleaned}`;
    }

    // UK national format
    // Example: 07306666123 → +447306666123
    if (cleaned.startsWith('0') && cleaned.length === 11) {
        return `+44${cleaned.substring(1)}`;
    }

    // UK number missing its leading zero
    // Example: 7306666123 → +447306666123
    if (cleaned.startsWith('7') && cleaned.length === 10) {
        return `+44${cleaned}`;
    }

    // Unknown/non-UK format: return digits for consistent comparison
    return cleaned;
}
// ===== END Phone number normalization =====

// ===== ADDED: Address validation and formatting =====
function validateAndFormatAddress(street, houseNumber) {
    // Check if we have enough address information
    const hasStreet = street && street.trim().length > 2;
    const hasHouseNumber = houseNumber && houseNumber.trim().length > 0;
    
    // If we have both, format nicely
    if (hasStreet && hasHouseNumber) {
        return {
            complete: true,
            formatted: `${houseNumber.trim()} ${street.trim()}`,
            street: street.trim(),
            houseNumber: houseNumber.trim()
        };
    }
    
    // If we have only street but no house number
    if (hasStreet && !hasHouseNumber) {
        return {
            complete: false,
            missing: 'houseNumber',
            message: "I have the street name but need the house/flat number. Could you please provide that?",
            street: street.trim(),
            houseNumber: ''
        };
    }
    
    // If we have only house number but no street
    if (!hasStreet && hasHouseNumber) {
        return {
            complete: false,
            missing: 'street',
            message: "I have the house/flat number but need the street name. Could you please provide that?",
            street: '',
            houseNumber: houseNumber.trim()
        };
    }
    
    // If we have neither
    return {
        complete: false,
        missing: 'both',
        message: "I need your full address - both the street name and house/flat number. Could you please tell me?",
        street: '',
        houseNumber: ''
    };
}
// ===== END ADDED =====

// ===== Webhook signature validation =====

// Twilio webhook signature validation
function validateTwilioWebhook(req) {
    const twilioSignature = req.headers['x-twilio-signature'] || '';
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    
    if (!twilioSignature) {
        console.log('❌ Missing X-Twilio-Signature header');
        return false;
    }
    
    try {
        // validateRequest is the most widely supported method
        // It handles both form-urlencoded and JSON bodies correctly
        return twilio.validateRequest(
            process.env.TWILIO_AUTH_TOKEN,
            twilioSignature,
            url,
            req.body
        );
    } catch (err) {
        console.error('❌ Twilio signature validation error:', err.message);
        return false;
    }
}

// Retell webhook signature validation
function validateRetellWebhook(req) {
    const signature = req.headers['x-retell-signature'] || '';
    const apiKey = process.env.RETELL_API_KEY;

    if (!apiKey) {
        console.error('❌ RETELL_API_KEY is not configured');
        return false;
    }

    const match = signature.match(/^v=(\d+),d=([a-fA-F0-9]+)$/);

    if (!match) {
        console.log('❌ Invalid X-Retell-Signature format');
        return false;
    }

    const timestamp = match[1];
    const receivedDigest = match[2].toLowerCase();

    // Reject signatures older/newer than five minutes
    const timestampMs = Number(timestamp);

    if (
        !Number.isFinite(timestampMs) ||
        Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000
    ) {
        console.log('❌ Retell webhook timestamp is outside allowed window');
        return false;
    }

    const rawBody = req.rawBody || '';

    const expectedDigest = crypto
        .createHmac('sha256', apiKey)
        .update(rawBody + timestamp)
        .digest('hex');

    const receivedBuffer = Buffer.from(receivedDigest, 'hex');
    const expectedBuffer = Buffer.from(expectedDigest, 'hex');

    if (receivedBuffer.length !== expectedBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

// ===== END Webhook signature validation =====

app.post('/send-sms', (req, res) => {
    const { name, postcode, phone, cleanType, dateTime, bookingType, street, houseNumber } = req.body;
    
    console.log('=== SMS Request ===');
    console.log('Booking Type:', bookingType);
    console.log('Name:', name);
    console.log('Postcode:', postcode);
    console.log('Phone:', phone);
    console.log('Clean type:', cleanType);
    console.log('Date & Time:', dateTime);
    console.log('Street:', street);
    console.log('House/Flat Number:', houseNumber);
    
    if (phone && CONTRACTOR_PHONE_NUMBER) {
        // Build address string if street and house number are available
        let addressStr = '';
        const addressPart = `${houseNumber || ''} ${street || ''}`.trim();
        if (addressPart) {
            addressStr = `\nAddress: ${addressPart}`;
        }
        
        // CHANGED: Wrapped in getTwilioOptions and added address fields
        twilioClient.messages.create(getTwilioOptions({
            body: `New ${bookingType || 'booking'}!\nName: ${name || '?'}\nPostcode: ${postcode || 'Not provided'}\nPhone: ${phone}\nClean type: ${cleanType || '?'}\nDate & Time: ${dateTime || '?'}${addressStr}`,
            from: TWILIO_PHONE_NUMBER,
            to: CONTRACTOR_PHONE_NUMBER
        }))
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
    // Validate Retell signature
    if (!validateRetellWebhook(req)) {
        console.log('❌ Invalid Retell webhook signature - request rejected');
        return res.status(401).send('Unauthorized');
    }
    res.status(200).send('OK');
});

app.post('/post-call-webhook', async (req, res) => {
    // Validate Retell signature
    if (!validateRetellWebhook(req)) {
        console.log('❌ Invalid Retell webhook signature - request rejected');
        return res.status(401).send('Unauthorized');
    }
    
    const body = req.body;
    const callId = body.call?.call_id || body.call_id;
    const eventType = body.event;

    if (eventType !== 'call_analyzed') {
        console.log(`⏭️ Ignoring event type: ${eventType} for call ${callId}`);
        return res.status(200).send('OK');
    }

    if (callId) {
        if (processedCalls.has(callId)) {
            console.log(`⏭️ Skipping duplicate call_analyzed webhook for call: ${callId}`);
            return res.status(200).send('OK');
        }
        processedCalls.add(callId);
        setTimeout(() => processedCalls.delete(callId), 3600000);
    }
    
    console.log('🔔 WEBHOOK RECEIVED');
    console.log('Event type:', body.event);
    if (callId) console.log('Call ID:', callId);
    
    let name = '', postcode = '', phone = '', cleanType = '', dateTime = '', bookingType = '';
    let street = '', houseNumber = ''; // ADDED: New fields for address
    
    if (body.call && body.call.collected_dynamic_variables) {
        const data = body.call.collected_dynamic_variables;
        
        name = getValue(data, 'name', 'Name', 'full_name', 'fullName');
        postcode = getValue(data, 'postcode', 'Postcode', 'post_code', 'postCode', 'zip', 'postal_code', 'zipCode');
        phone = getValue(data, 'phone', 'Phone', 'phone_number', 'phoneNumber', 'mobile', 'Mobile');
        cleanType = getValue(data, 'cleanType', 'CleanType', 'clean_type', 'clean type', 'type_of_cleaning', 'cleaningType');
        dateTime = getValue(data, 'dateTime', 'DateTime', 'date_time', 'date time', 'date_and_time', 'date and time', 'appointment_time');
        bookingType = getValue(data, 'bookingType', 'BookingType', 'booking_type', 'booking type', 'intent', 'call_type', 'callType');
        street = getValue(data, 'street', 'Street', 'street_name', 'streetName', 'address', 'Address');
        houseNumber = getValue(data, 'houseNumber', 'HouseNumber', 'house_number', 'house_no', 'houseNo', 'house', 'House', 'number', 'flat', 'Flat', 'apartment', 'Apartment');
        
        console.log('✅ Found in call.collected_dynamic_variables');
        console.log('📦 Keys received from Retell:', Object.keys(data));
        console.log('📦 Postcode value:', postcode);
        console.log('📦 Street:', street);
        console.log('📦 House/Flat Number:', houseNumber);
    } else {
        console.log('⚠️ No collected_dynamic_variables found');
    }
    
    if (body.call_analysis && body.call_analysis.custom_analysis_data) {
        const fallback = body.call_analysis.custom_analysis_data;
        
        console.log('📦 Checking custom_analysis_data for data');
        console.log('📦 Keys in custom_analysis_data:', Object.keys(fallback));
        
        const mappedData = {};
        
        for (const [key, value] of Object.entries(fallback)) {
            const lowerKey = key.toLowerCase().replace(/[_\s]/g, '');
            
            if (lowerKey === 'name' || lowerKey === 'fullname') {
                mappedData.name = value;
            } else if (lowerKey === 'postcode' || lowerKey === 'postalcode' || lowerKey === 'zip' || lowerKey === 'zipcode') {
                mappedData.postcode = value;
            } else if (lowerKey === 'phone' || lowerKey === 'phonenumber' || lowerKey === 'phone_number' || lowerKey === 'mobile' || lowerKey === 'mobilenumber') {
                mappedData.phone = value;
            } else if (lowerKey === 'cleantype' || lowerKey === 'cleaningtype' || lowerKey === 'typeofcleaning' || lowerKey === 'typeofcleaning') {
                mappedData.cleanType = value;
            } else if (lowerKey === 'datetime' || lowerKey === 'dateandtime' || lowerKey === 'date_time' || lowerKey === 'appointmenttime' || lowerKey === 'appointment_time') {
                mappedData.dateTime = value;
            } else if (lowerKey === 'bookingtype' || lowerKey === 'bookingtype' || lowerKey === 'intent' || lowerKey === 'calltype' || lowerKey === 'call_type') {
                mappedData.bookingType = value;
            } else if (lowerKey === 'street' || lowerKey === 'streetname' || lowerKey === 'address') {
                mappedData.street = value;
            } else if (lowerKey === 'housenumber' || lowerKey === 'houseno' || lowerKey === 'house' || lowerKey === 'number' || lowerKey === 'flat' || lowerKey === 'apartment') {
                mappedData.houseNumber = value;
            }
            
            if (key === 'name') mappedData.name = value;
            if (key === 'postcode') mappedData.postcode = value;
            if (key === 'phone_number') mappedData.phone = value;
            if (key === 'cleanType') mappedData.cleanType = value;
            if (key === 'dateTime') mappedData.dateTime = value;
            if (key === 'bookingType') mappedData.bookingType = value;
            if (key === 'street') mappedData.street = value;
            if (key === 'houseNumber') mappedData.houseNumber = value;
        }
        
        if (!name && mappedData.name) name = mappedData.name;
        if (!postcode && mappedData.postcode) postcode = mappedData.postcode;
        if (!phone && mappedData.phone) phone = mappedData.phone;
        if (!cleanType && mappedData.cleanType) cleanType = mappedData.cleanType;
        if (!dateTime && mappedData.dateTime) dateTime = mappedData.dateTime;
        if (!bookingType && mappedData.bookingType) bookingType = mappedData.bookingType;
        if (!street && mappedData.street) street = mappedData.street;
        if (!houseNumber && mappedData.houseNumber) houseNumber = mappedData.houseNumber;
        
        if (!postcode) postcode = getValue(fallback, 'postcode', 'post_code', 'postal_code', 'zip');
        if (!dateTime) dateTime = getValue(fallback, 'dateTime', 'date_time', 'appointment_time', 'appointmentTime');
        if (!cleanType) cleanType = getValue(fallback, 'cleanType', 'clean_type', 'cleaningType', 'cleaning_type');
        if (!bookingType) bookingType = getValue(fallback, 'bookingType', 'booking_type', 'intent', 'call_type');
        if (!street) street = getValue(fallback, 'street', 'street_name', 'streetName', 'address', 'Address');
        if (!houseNumber) houseNumber = getValue(fallback, 'houseNumber', 'house_number', 'house_no', 'houseNo', 'house', 'number', 'flat', 'apartment');
        
        console.log('📦 Extracted from custom_analysis_data:', {
            name,
            postcode,
            phone,
            cleanType,
            dateTime,
            bookingType,
            street,
            houseNumber
        });
    }
    
    console.log('=== Extracted Data ===');
    console.log('Booking Type:', bookingType);
    console.log('Name:', name);
    console.log('Postcode:', postcode);
    console.log('Phone:', phone);
    console.log('Clean type:', cleanType);
    console.log('Date & Time:', dateTime);
    console.log('Street:', street);
    console.log('House/Flat Number:', houseNumber);

    // ===== ADDED: Address validation check =====
    const addressValidation = validateAndFormatAddress(street, houseNumber);
    if (!addressValidation.complete) {
        console.log('⚠️ Incomplete address:', addressValidation.message);
        console.log('   Missing:', addressValidation.missing);
        console.log('   Street so far:', addressValidation.street);
        console.log('   House number so far:', addressValidation.houseNumber);
        // You could store this in a flag to trigger Retell AI to ask for missing parts
        // Or log it for monitoring
    } else {
        console.log('✅ Complete address:', addressValidation.formatted);
    }
    // ===== END ADDED =====
    
    // ===== REMOVED: Contractor SMS (now sent exclusively from Cal.com webhook) =====
    // Contractor SMS removed to prevent duplicates. See /cal-webhook endpoint.
    // ===== END REMOVED =====
    
    // ===== REMOVED: Customer SMS (now sent from verified action endpoints) =====
    // Customer SMS removed to prevent false confirmations.
    // - Bookings: Sent from /cal-webhook when BOOKING_CREATED is received
    // - Cancellations: Sent from /cal/cancel-booking when cancellation succeeds
    // - Reschedules: Sent from /cal/reschedule-booking when reschedule succeeds
    // ===== END REMOVED =====
    
    res.status(200).send('OK');
});

// ========== SMS CONVERSATION ==========

const smsConversations = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [key, state] of smsConversations) {
        if (now - state.lastUpdated > 86400000) {
            smsConversations.delete(key);
        }
    }
}, 3600000);

function getSmsConversation(from, to) {
    const key = `${from}:${to}`;
    if (!smsConversations.has(key)) {
        smsConversations.set(key, {
            from,
            to,
            step: 'greeting',
            collectedData: {},
            pendingCancellation: null, // ADDED: Store booking info for confirmation
            lastUpdated: Date.now()
        });
    }
    return smsConversations.get(key);
}

function getBaseUrl(req) {
    return `${req.protocol}://${req.get('host')}`;
}

// ====== SMS HANDLER FUNCTIONS (MOVED HERE) ======

async function handleBookingSms(req, from, to, body, conversation) {
    const message = body.trim();
    const data = conversation.collectedData;
    const step = conversation.step;
    
    console.log(`📋 SMS step: ${step}`);
    
    switch (step) {
        case 'greeting':
            // CHANGED: Wrapped in getTwilioOptions
            await twilioClient.messages.create(getTwilioOptions({
                body: "👋 Hi! I'd be happy to help you book a cleaning. What's your full name?",
                from: TWILIO_PHONE_NUMBER,
                to: from
            }));
            conversation.step = 'collecting_name';
            break;
            
        case 'collecting_name':
            data.name = message;
            // CHANGED: Wrapped in getTwilioOptions
            await twilioClient.messages.create(getTwilioOptions({
                body: `Thanks ${data.name}! What's your postcode?`,
                from: TWILIO_PHONE_NUMBER,
                to: from
            }));
            conversation.step = 'collecting_postcode';
            break;
            
        case 'collecting_postcode':
            data.postcode = message;
            // CHANGED: Now ask for street first, then house number
            await twilioClient.messages.create(getTwilioOptions({
                body: "Great! What's your street name?",
                from: TWILIO_PHONE_NUMBER,
                to: from
            }));
            conversation.step = 'collecting_street';
            break;
            
        case 'collecting_street':
            data.street = message;
            await twilioClient.messages.create(getTwilioOptions({
                body: "And what's your house or flat number?",
                from: TWILIO_PHONE_NUMBER,
                to: from
            }));
            conversation.step = 'collecting_house_number';
            break;
            
        case 'collecting_house_number':
            data.houseNumber = message;
            // Then proceed to ask for clean type
            await twilioClient.messages.create(getTwilioOptions({
                body: "What type of cleaning do you need? (deep clean, regular clean, end of tenancy)",
                from: TWILIO_PHONE_NUMBER,
                to: from
            }));
            conversation.step = 'collecting_clean_type';
            break;
            
        case 'collecting_clean_type':
            data.cleanType = message;
            // CHANGED: Wrapped in getTwilioOptions
            await twilioClient.messages.create(getTwilioOptions({
                body: "Got it! When would you like the appointment? Please give me a date and time (e.g., tomorrow at 2 PM, or Friday 10 AM)",
                from: TWILIO_PHONE_NUMBER,
                to: from
            }));
            conversation.step = 'collecting_date_time';
            break;
            
        case 'collecting_date_time':
            data.dateTime = message;
            data.bookingType = 'booking';
            
            const phone = from;
            const name = data.name;
            const postcode = data.postcode;
            
            try {
                // Check if this is a question about availability
                if (message.toLowerCase().includes('available') || 
                    message.toLowerCase().includes('free') || 
                    message.toLowerCase().includes('opening') ||
                    message.toLowerCase().includes('what times')) {
                    
                    // CHANGED: Wrapped in getTwilioOptions
                    await twilioClient.messages.create(getTwilioOptions({
                        body: "I can check availability for you! What date are you looking for? Please give me a specific date and time (e.g., Friday at 2pm).",
                        from: TWILIO_PHONE_NUMBER,
                        to: from
                    }));
                    return;
                }
                
                // Special: Handle "closest available" or "nearest" requests
                if (message.toLowerCase().includes('closest') || 
                    message.toLowerCase().includes('nearest') || 
                    message.toLowerCase().includes('soonest') ||
                    message.toLowerCase().includes('earliest')) {
                    
                    const suggestions = [
                        new Date(Date.now() + 86400000 * 2).toLocaleString('en-GB', { 
                            weekday: 'short', 
                            day: '2-digit', 
                            month: 'short', 
                            hour: '2-digit', 
                            minute: '2-digit' 
                        }),
                        new Date(Date.now() + 86400000 * 3).toLocaleString('en-GB', { 
                            weekday: 'short', 
                            day: '2-digit', 
                            month: 'short', 
                            hour: '2-digit', 
                            minute: '2-digit' 
                        })
                    ];
                    
                    // CHANGED: Wrapped in getTwilioOptions
                    await twilioClient.messages.create(getTwilioOptions({
                        body: `I can help find the nearest available time. Would you prefer one of these?\n\n1️⃣ ${suggestions[0]}\n2️⃣ ${suggestions[1]}\n\nOr tell me a specific time that works for you.`,
                        from: TWILIO_PHONE_NUMBER,
                        to: from
                    }));
                    return;
                }
                
                // Parse date with chrono-node
                let isoTime = null;
                try {
                    const parsedDate = chrono.parseDate(message, new Date(), { 
                        timezone: 'Europe/London' 
                    });
                    
                    if (parsedDate) {
                        isoTime = parsedDate.toISOString();
                        console.log('✅ Parsed date:', message, '→', isoTime);
                    } else {
                        console.log('⚠️ Could not parse date from SMS:', message);
                    }
                } catch (e) {
                    console.log('⚠️ Date parsing error:', e.message);
                }
                
                if (!isoTime) {
                    // CHANGED: Wrapped in getTwilioOptions
                    await twilioClient.messages.create(getTwilioOptions({
                        body: "I couldn't understand that date/time. Could you please give it in a clearer format? (e.g., Friday at 2 PM, tomorrow at 10am, or 2026-07-09T14:00:00Z)",
                        from: TWILIO_PHONE_NUMBER,
                        to: from
                    }));
                    return;
                }
                
                // Check if the time is in the past
                const now = new Date();
                const requestedDate = new Date(isoTime);
                if (requestedDate < now) {
                    // CHANGED: Wrapped in getTwilioOptions
                    await twilioClient.messages.create(getTwilioOptions({
                        body: "❌ That time is in the past. Could you please choose a future date and time? (e.g., tomorrow at 2 PM)",
                        from: TWILIO_PHONE_NUMBER,
                        to: from
                    }));
                    return;
                }
                
                const baseUrl = getBaseUrl(req);
                
                // Call your booking endpoint with source: 'sms'
                const bookingResponse = await fetch(`${baseUrl}/cal/book-appointment`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: name,
                        phone: phone,
                        postcode: postcode,
                        time: isoTime,
                        street: data.street || '',
                        houseNumber: data.houseNumber || '',
                        source: 'sms'  // Explicitly mark as SMS-originated
                    })
                });
                
                const bookingResult = await bookingResponse.json();
                console.log('📥 Booking result:', JSON.stringify(bookingResult, null, 2));
                
                if (bookingResult.success) {
                    const dateObj = new Date(isoTime);
                    const formattedDate = dateObj.toLocaleString('en-GB', {
                        weekday: 'short',
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    
                    // CHANGED: Wrapped in getTwilioOptions
                    await twilioClient.messages.create(getTwilioOptions({
                        body: `✅ Booking confirmed!\n\nName: ${name}\nPostcode: ${postcode}\nClean type: ${data.cleanType}\nDate & Time: ${formattedDate}\n\n📱 To cancel or reschedule, just reply "cancel" or "reschedule"`,
                        from: TWILIO_PHONE_NUMBER,
                        to: from
                    }));
                    
                    conversation.step = 'booking_complete';
                    console.log('✅ SMS booking complete for:', phone);
                    
                    // Contractor SMS now sent exclusively from Cal.com webhook to prevent duplicates
                    // See /cal-webhook endpoint for contractor notification logic
                    
                } else {
                    // Handle specific Cal.com errors
                    const errorMessage = bookingResult.error?.message || '';
                    console.log('❌ Cal.com error:', errorMessage);
                    
                    if (errorMessage.includes('already has booking') || errorMessage.includes('not available')) {
                        // CHANGED: Wrapped in getTwilioOptions
                        await twilioClient.messages.create(getTwilioOptions({
                            body: "❌ That time is already booked or you have a booking at that time. Could you please suggest a different time? (e.g., Friday at 4pm)",
                            from: TWILIO_PHONE_NUMBER,
                            to: from
                        }));
                    } else if (errorMessage.includes('past')) {
                        // CHANGED: Wrapped in getTwilioOptions
                        await twilioClient.messages.create(getTwilioOptions({
                            body: "❌ That time is in the past. Could you please choose a future date and time? (e.g., tomorrow at 2 PM)",
                            from: TWILIO_PHONE_NUMBER,
                            to: from
                        }));
                    } else if (errorMessage.includes('working hours') || errorMessage.includes('outside')) {
                        // CHANGED: Wrapped in getTwilioOptions
                        await twilioClient.messages.create(getTwilioOptions({
                            body: "❌ Our working hours are 9am to 5pm, Monday to Friday. Could you please choose a time within these hours?",
                            from: TWILIO_PHONE_NUMBER,
                            to: from
                        }));
                    } else {
                        // CHANGED: Wrapped in getTwilioOptions
                        await twilioClient.messages.create(getTwilioOptions({
                            body: "❌ Sorry, I couldn't book that time. Please try a different date and time.",
                            from: TWILIO_PHONE_NUMBER,
                            to: from
                        }));
                    }
                }
                
            } catch (error) {
                console.error('❌ SMS booking error:', error.message);
                // CHANGED: Wrapped in getTwilioOptions
                await twilioClient.messages.create(getTwilioOptions({
                    body: "❌ Something went wrong. Please try again or call us at 07306666123",
                    from: TWILIO_PHONE_NUMBER,
                    to: from
                }));
            }
            break;
            
        default:
            conversation.step = 'greeting';
            conversation.collectedData = {};
            conversation.pendingCancellation = null;
            // CHANGED: Wrapped in getTwilioOptions
            await twilioClient.messages.create(getTwilioOptions({
                body: "Hi! Would you like to book a cleaning? Just reply 'yes' or tell me what you need.",
                from: TWILIO_PHONE_NUMBER,
                to: from
            }));
    }
}

// ===== NEW: Start cancellation flow =====
async function startCancellationFlow(req, from, to, conversation) {
    const phone = normalizePhoneNumber(from);
    const baseUrl = getBaseUrl(req);
    
    console.log('📱 Starting cancellation flow for:', from, '(normalized:', phone, ')');
    
    try {
        const searchResponse = await fetch(`${baseUrl}/cal/search-bookings-by-phone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
        });
        
        const searchResult = await searchResponse.json();
        
        if (!searchResult.success || searchResult.count === 0) {
            await twilioClient.messages.create(getTwilioOptions({
                body: "I couldn't find any upcoming bookings for this phone number. If you need help, please call us at 07306666123",
                from: TWILIO_PHONE_NUMBER,
                to: from
            }));
            return;
        }
        
        const bookings = searchResult.bookings;
        
        if (bookings.length === 1) {
            const booking = bookings[0];
            const date = new Date(booking.dateTime);
            const formattedDate = date.toLocaleString('en-GB', {
                weekday: 'short',
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            // Store booking info for confirmation
            conversation.pendingCancellation = {
                bookingUid: booking.bookingUid,
                dateTime: booking.dateTime,
                formattedDate: formattedDate
            };
            conversation.step = 'pending_cancellation_confirmation';
            
            await twilioClient.messages.create(getTwilioOptions({
                body: `I found your booking on ${formattedDate}.\n\nReply YES CANCEL to confirm cancellation, or reply NO to keep your booking.`,
                from: TWILIO_PHONE_NUMBER,
                to: from
            }));
        } else {
            let listMessage = "I found multiple bookings:\n";
            bookings.forEach((b, i) => {
                const date = new Date(b.dateTime);
                const formatted = date.toLocaleString('en-GB', {
                    weekday: 'short',
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                listMessage += `${i+1}. ${formatted}\n`;
            });
            listMessage += "\nFor now, please call us at 07306666123 to choose which one to cancel.";
            
            await twilioClient.messages.create(getTwilioOptions({
                body: listMessage,
                from: TWILIO_PHONE_NUMBER,
                to: from
            }));
        }
    } catch (error) {
        console.error('❌ SMS cancellation flow error:', error.message);
        await twilioClient.messages.create(getTwilioOptions({
            body: "❌ Something went wrong. Please call us at 07306666123 for help.",
            from: TWILIO_PHONE_NUMBER,
            to: from
        }));
    }
}
// ===== END NEW =====

async function handleCancelSms(req, from, to, conversation) {
    const message = req.body.Body ? req.body.Body.trim().toUpperCase() : '';
    const baseUrl = getBaseUrl(req);
    
    // Check if we're in the confirmation step
    if (conversation.step === 'pending_cancellation_confirmation' && conversation.pendingCancellation) {
        // They replied to the confirmation prompt
        if (message === 'YES CANCEL') {
            // Confirmed - cancel the booking
            const bookingUid = conversation.pendingCancellation.bookingUid;
            console.log('✅ Cancellation confirmed for booking:', bookingUid);
            
            try {
                // Do NOT pass customerPhone or customerName to prevent duplicate SMS
                // The SMS handler will send the confirmation message
                const cancelResponse = await fetch(`${baseUrl}/cal/cancel-booking`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        bookingUid,
                        cancellationReason: 'Customer confirmed via SMS'
                    })
                });
                
                const cancelResult = await cancelResponse.json();
                
                if (cancelResult.success) {
                    await twilioClient.messages.create(getTwilioOptions({
                        body: "✅ Your booking has been cancelled. If you need to book again, just let me know!",
                        from: TWILIO_PHONE_NUMBER,
                        to: from
                    }));
                } else {
                    await twilioClient.messages.create(getTwilioOptions({
                        body: "❌ I couldn't cancel your booking. Please call us at 07306666123 for help.",
                        from: TWILIO_PHONE_NUMBER,
                        to: from
                    }));
                }
            } catch (error) {
                console.error('❌ Cancellation error:', error.message);
                await twilioClient.messages.create(getTwilioOptions({
                    body: "❌ Something went wrong. Please call us at 07306666123 for help.",
                    from: TWILIO_PHONE_NUMBER,
                    to: from
                }));
            }
            
            // Reset conversation state
            conversation.step = 'greeting';
            conversation.pendingCancellation = null;
            conversation.collectedData = {};
            
        } else if (message === 'NO') {
            // They chose not to cancel
            await twilioClient.messages.create(getTwilioOptions({
                body: "✅ Your booking has been kept. If you change your mind, just reply CANCEL again.",
                from: TWILIO_PHONE_NUMBER,
                to: from
            }));
            
            // Reset conversation state
            conversation.step = 'greeting';
            conversation.pendingCancellation = null;
            conversation.collectedData = {};
        } else {
            // They replied with something unexpected during confirmation
            await twilioClient.messages.create(getTwilioOptions({
                body: `To confirm cancellation, reply YES CANCEL.\nTo keep your booking, reply NO.`,
                from: TWILIO_PHONE_NUMBER,
                to: from
            }));
        }
        return;
    }
    
    // If we get here, they said "cancel" but we're not in confirmation state
    // This should be handled by startCancellationFlow now
    // But as a fallback, start the flow
    await startCancellationFlow(req, from, to, conversation);
}

async function handleRescheduleSms(req, from, to, conversation) {
    // CHANGED: Wrapped in getTwilioOptions
    await twilioClient.messages.create(getTwilioOptions({
        body: "To reschedule, please call us at 07306666123 and we'll find a new time for you.",
        from: TWILIO_PHONE_NUMBER,
        to: from
    }));
}

// ====== SMS WEBHOOK ROUTE (NOW AFTER FUNCTIONS) ======

app.post('/sms-webhook', async (req, res) => {
    // Validate Twilio signature
    if (!validateTwilioWebhook(req)) {
        console.log('❌ Invalid Twilio webhook signature - request rejected');
        return res.status(401).send('Unauthorized');
    }
    
    const { From, To, Body } = req.body;
    
    console.log('📱 SMS received');
    console.log('   From:', From);
    console.log('   To:', To);
    console.log('   Body:', Body);
    
    const conversation = getSmsConversation(From, To);
    conversation.lastUpdated = Date.now();
    
    const message = Body.trim().toLowerCase();
    
    // Check if we're in cancellation confirmation state
    if (conversation.step === 'pending_cancellation_confirmation') {
        // Let handleCancelSms deal with the confirmation response
        await handleCancelSms(req, From, To, conversation);
        return res.status(200).send('OK');
    }
    
    // Check for cancellation request (start the flow)
    if (message.includes('cancel') || message.includes('cancellation')) {
        await startCancellationFlow(req, From, To, conversation);
        return res.status(200).send('OK');
    }
    
    // Check for reschedule
    if (message.includes('reschedule') || message.includes('change') || message.includes('move')) {
        await handleRescheduleSms(req, From, To, conversation);
        return res.status(200).send('OK');
    }
    
    // Booking flow
    if (conversation.step === 'booking_complete') {
        conversation.step = 'greeting';
        conversation.collectedData = {};
    }
    
    await handleBookingSms(req, From, To, Body, conversation);
    
    res.status(200).send('OK');
});

// ========== CAL.COM ENDPOINTS ==========

app.post('/cal/search-booking', async (req, res) => {
    const { phone, email } = req.body;
    
    console.log('🔍 Searching Cal.com for booking:', { phone, email });
    
    try {
        const response = await fetch('https://api.cal.com/v2/bookings', {
            headers: {
                'Authorization': `Bearer ${process.env.CAL_API_KEY}`,
                'cal-api-version': '2024-08-13'
            }
        });
        
        const bookings = await response.json();
        console.log('📅 Cal.com response:', bookings);
        
        const found = bookings.data?.find(b => 
            b.attendees?.some(a => a.email === email || a.phone === phone)
        );
        
        if (found) {
            console.log('✅ Booking found:', found.uid);
            res.json({ 
                success: true, 
                bookingUid: found.uid,
                bookingDetails: found
            });
        } else {
            console.log('❌ No booking found');
            res.json({ success: false, error: 'No booking found for that phone number' });
        }
    } catch (error) {
        console.error('❌ Search error:', error.message);
        res.json({ success: false, error: error.message });
    }
});

app.post('/cal/search-bookings-by-phone', async (req, res) => {
    const { phone } = req.body;
    
    console.log('🔍 Searching all bookings for phone:', phone);
    
    if (!phone) {
        return res.json({ success: false, error: 'Phone number is required' });
    }
    
    try {
        const response = await fetch('https://api.cal.com/v2/bookings?limit=50', {
            headers: {
                'Authorization': `Bearer ${process.env.CAL_API_KEY}`,
                'cal-api-version': '2024-08-13'
            }
        });
        
        const bookings = await response.json();
        
        const normalizedSearchPhone = normalizePhoneNumber(phone);
        
        const matchingBookings = bookings.data?.filter(b => 
            b.attendees?.some(a => normalizePhoneNumber(a.phoneNumber) === normalizedSearchPhone)
        );
        
        if (matchingBookings && matchingBookings.length > 0) {
            console.log(`✅ Found ${matchingBookings.length} booking(s)`);
            res.json({ 
                success: true, 
                count: matchingBookings.length,
                bookings: matchingBookings.map(b => ({
                    bookingUid: b.uid,
                    dateTime: b.start,
                    status: b.status,
                    attendeeName: b.attendees?.[0]?.name
                }))
            });
        } else {
            console.log('❌ No bookings found');
            res.json({ success: false, error: 'No bookings found for that phone number' });
        }
    } catch (error) {
        console.error('❌ Search error:', error.message);
        res.json({ success: false, error: error.message });
    }
});

app.post('/cal/cancel-booking', async (req, res) => {
    const { bookingUid, cancellationReason, customerPhone, customerName } = req.body;
    
    console.log('🗑️ Cancelling booking:', bookingUid);
    if (customerPhone) console.log('📞 Customer phone for notification:', customerPhone);
    
    try {
        const response = await fetch(`https://api.cal.com/v2/bookings/${bookingUid}/cancel`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.CAL_API_KEY}`,
                'Content-Type': 'application/json',
                'cal-api-version': '2024-08-13'
            },
            body: JSON.stringify({ 
                cancellationReason: cancellationReason || 'Customer requested via phone' 
            })
        });
        
        const result = await response.json();
        console.log('📦 Cancellation response:', JSON.stringify(result, null, 2));
        
        if (response.ok) {
            // Send customer confirmation SMS (for voice cancellations only)
            // SMS cancellations handle their own confirmation to avoid duplicates
            if (customerPhone && customerPhone !== '?' && customerPhone.length > 8) {
                const name = customerName || 'Customer';
                const message = `Hi ${name}, your cleaning appointment has been successfully cancelled.\n\nIf you need to book again, just give us a call.`;
                
                try {
                    await twilioClient.messages.create(getTwilioOptions({
                        body: message,
                        from: TWILIO_PHONE_NUMBER,
                        to: customerPhone
                    }));
                    console.log('✅ Customer cancellation SMS sent to:', customerPhone);
                } catch (smsErr) {
                    console.error('❌ Customer SMS error:', smsErr.message);
                    // Don't fail the cancellation if SMS fails
                }
            }
            
            res.json({ success: true, result });
        } else {
            console.log('❌ Cal.com cancellation error:', result);
            res.json({ 
                success: false, 
                error: result.error?.message || 'Cancellation failed',
                result 
            });
        }
    } catch (error) {
        console.error('❌ Cancellation error:', error.message);
        res.json({ success: false, error: error.message });
    }
});

app.post('/cal/reschedule-booking', async (req, res) => {
    const { bookingUid, newStartTime, customerPhone, customerName } = req.body;
    
    console.log('📅 Rescheduling booking:', bookingUid);
    console.log('🕒 New time:', newStartTime);
    if (customerPhone) console.log('📞 Customer phone for notification:', customerPhone);
    
    let validTime = newStartTime;
    if (!newStartTime || newStartTime === '') {
        console.log('❌ No new time provided');
        return res.json({ success: false, error: 'No new time provided' });
    }
    
    if (!newStartTime.includes('T') || !newStartTime.includes('Z')) {
        try {
            const parsedDate = new Date(newStartTime);
            if (!isNaN(parsedDate.getTime())) {
                validTime = parsedDate.toISOString();
                console.log('🕒 Converted time to:', validTime);
            }
        } catch (e) {
            console.log('⚠️ Could not parse time, using as-is');
        }
    }
    
    try {
        const response = await fetch(`https://api.cal.com/v2/bookings/${bookingUid}/reschedule`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.CAL_API_KEY}`,
                'Content-Type': 'application/json',
                'cal-api-version': '2024-08-13'
            },
            body: JSON.stringify({
                start: validTime
            })
        });
        
        const result = await response.json();
        console.log('✅ Reschedule response:', result);
        
        if (response.ok) {
            // Send customer confirmation SMS
            if (customerPhone && customerPhone !== '?' && customerPhone.length > 8) {
                const name = customerName || 'Customer';
                
                // Format the new date/time
                let formattedDateTime = validTime;
                try {
                    const dateObj = new Date(validTime);
                    formattedDateTime = dateObj.toLocaleString('en-GB', {
                        weekday: 'short',
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                } catch (e) {
                    console.log('⚠️ Could not format date/time, using raw value:', validTime);
                }
                
                const message = `Hi ${name}, your cleaning appointment has been rescheduled to ${formattedDateTime}.\n\nAny questions? Please contact 07306666123`;
                
                try {
                    await twilioClient.messages.create(getTwilioOptions({
                        body: message,
                        from: TWILIO_PHONE_NUMBER,
                        to: customerPhone
                    }));
                    console.log('✅ Customer reschedule SMS sent to:', customerPhone);
                } catch (smsErr) {
                    console.error('❌ Customer SMS error:', smsErr.message);
                    // Don't fail the reschedule if SMS fails
                }
            }
            
            res.json({ 
                success: true, 
                newBookingUid: result.data?.uid,
                message: "Appointment rescheduled successfully"
            });
        } else {
            console.log('❌ Reschedule error:', result);
            res.json({ success: false, error: result.error?.message || 'Reschedule failed' });
        }
    } catch (error) {
        console.error('❌ Reschedule error:', error.message);
        res.json({ success: false, error: error.message });
    }
});

app.post('/cal/book-appointment', async (req, res) => {
    const { name, phone, time, postcode, street, houseNumber, source } = req.body;
    
    console.log('📅 Booking appointment for:', name);
    console.log('📞 Phone:', phone);
    console.log('🕒 Time received:', time);
    console.log('📍 Postcode:', postcode);
    console.log('🏠 Street:', street);
    console.log('🔢 House/Flat Number:', houseNumber);
    console.log('📱 Source:', source || 'phone_call (default)');
    
    const fakeEmail = `${name.toLowerCase().replace(/\s/g, '')}_${Date.now()}@phonebooking.local`;
    console.log('📧 Generated fake email:', fakeEmail);
    
    let validTime = time;
    if (!time || time === '') {
        console.log('❌ No time provided');
        return res.json({ success: false, error: 'No time provided' });
    }
    
    if (!time.includes('T') || !time.includes('Z')) {
        try {
            const parsedDate = new Date(time);
            if (!isNaN(parsedDate.getTime())) {
                validTime = parsedDate.toISOString();
                console.log('🕒 Converted time to:', validTime);
            }
        } catch (e) {
            console.log('⚠️ Could not parse time, using as-is');
        }
    }
    
    try {
        const response = await fetch('https://api.cal.com/v2/bookings', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.CAL_API_KEY}`,
                'Content-Type': 'application/json',
                'cal-api-version': '2024-08-13'
            },
            body: JSON.stringify({
                start: validTime,
                eventTypeId: 6005228,
                metadata: {
                    postcode: postcode || 'Not provided',
                    street: street || '',
                    houseNumber: houseNumber || '',
                    source: source || 'phone_call'  // Accept source parameter, default to phone_call
                },
                attendee: {
                    name: name,
                    email: fakeEmail,
                    phoneNumber: phone,
                    timeZone: "Europe/London",
                    language: "en"
                }
            })
        });
        
        const result = await response.json();
        console.log('✅ Cal.com response:', JSON.stringify(result, null, 2));
        
        if (response.ok) {
            res.json({ 
                success: true, 
                bookingUid: result.data?.uid,
                message: "Booking confirmed"
            });
        } else {
            console.log('❌ Cal.com error:', result);
            res.json({ success: false, error: result.error?.message || JSON.stringify(result) });
        }
    } catch (error) {
        console.error('❌ Booking error:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// ========== CAL.COM WEBHOOK ENDPOINT ==========

app.post('/cal-webhook', async (req, res) => {
    const body = req.body;
    
    console.log('🔔 CAL.COM WEBHOOK RECEIVED');
    console.log('Event:', body.triggerEvent);
    console.log('Booking data:', JSON.stringify(body, null, 2));
    
    res.status(200).send('OK');
    
    if (body.triggerEvent === 'BOOKING_CREATED') {
        const booking = body.payload;
        const attendee = booking.attendees?.[0] || {};
        
        const name = attendee.name || 'Unknown';
        const phone = attendee.phoneNumber || booking.responses?.phone || '?';
        const email = attendee.email || '?';
        const dateTime = booking.startTime || '?';
        const bookingType = 'booking';
        const postcode = booking.metadata?.postcode || 'Not provided';
        const street = booking.metadata?.street || '';
        const houseNumber = booking.metadata?.houseNumber || '';
        const bookingSource = booking.metadata?.source || 'phone_call';
        
        console.log('=== New Booking Details ===');
        console.log('Name:', name);
        console.log('Phone:', phone);
        console.log('Email:', email);
        console.log('Date & Time:', dateTime);
        console.log('Postcode:', postcode);
        console.log('Street:', street);
        console.log('House/Flat Number:', houseNumber);
        console.log('Source:', bookingSource);
        
        if (phone !== '?' && CONTRACTOR_PHONE_NUMBER) {
            try {
                // Build address string if street and house number are available
                let addressStr = '';
                const addressPart = `${houseNumber || ''} ${street || ''}`.trim();
                if (addressPart) {
                    addressStr = `\nAddress: ${addressPart}`;
                }
                
                // CHANGED: Wrapped in getTwilioOptions and added address fields
                await twilioClient.messages.create(getTwilioOptions({
                    body: `New ${bookingType}!\nName: ${name}\nPhone: ${phone}\nPostcode: ${postcode}\nDate & Time: ${dateTime}${addressStr}`,
                    from: TWILIO_PHONE_NUMBER,
                    to: CONTRACTOR_PHONE_NUMBER
                }));
                console.log('✅ Contractor SMS sent from webhook');
            } catch (err) {
                console.error('❌ Contractor SMS error:', err.message);
            }
        }
        
        // Send customer confirmation SMS only for non-SMS bookings
        // SMS bookings already send their own confirmation in handleBookingSms()
        if (bookingSource !== 'sms' && phone && phone !== '?' && phone.length > 8) {
            try {
                // Format the date/time for customer message
                let formattedDateTime = dateTime;
                try {
                    const dateObj = new Date(dateTime);
                    formattedDateTime = dateObj.toLocaleString('en-GB', {
                        weekday: 'short',
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                } catch (e) {
                    console.log('⚠️ Could not format date/time for customer SMS:', dateTime);
                }
                
                const customerMessage = `Hi ${name}, you've successfully booked a cleaning appointment with Magdalena Bielawa Cleaning Services for ${formattedDateTime}.\n\nAny questions? Please contact 07306666123`;
                
                await twilioClient.messages.create(getTwilioOptions({
                    body: customerMessage,
                    from: TWILIO_PHONE_NUMBER,
                    to: phone
                }));
                console.log('✅ Customer booking SMS sent to:', phone);
            } catch (err) {
                console.error('❌ Customer SMS error:', err.message);
                // Don't fail the webhook if SMS fails
            }
        } else if (bookingSource === 'sms') {
            console.log('📱 Skipping customer SMS for SMS-originated booking (already sent in booking flow)');
        }
    }
});

// ========== END CAL.COM ENDPOINTS ==========

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
