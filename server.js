const express = require('express');
const twilio = require('twilio');
const app = express();
const PORT = process.env.PORT || 3000;

// FIX 1: Increase payload size limit to handle Retell webhooks (fixes 413 error)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const CONTRACTOR_PHONE_NUMBER = process.env.CONTRACTOR_PHONE_NUMBER;

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
            body: `New ${bookingType || 'booking'}!\nName: ${name || '?'}\nPostcode: ${postcode || 'Not provided'}\nPhone: ${phone}\nClean type: ${cleanType || '?'}\nDate & Time: ${dateTime || '?'}`,
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

app.post('/post-call-webhook', async (req, res) => {
    const body = req.body;
    const callId = body.call?.call_id || body.call_id;
    const eventType = body.event;

    // FIX: Only process call_analyzed - that's the one with the real data
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
    
    // Check collected_dynamic_variables first
    if (body.call && body.call.collected_dynamic_variables) {
        const data = body.call.collected_dynamic_variables;
        
        name = getValue(data, 'name', 'Name', 'full_name', 'fullName');
        postcode = getValue(data, 'postcode', 'Postcode', 'post_code', 'postCode', 'zip', 'postal_code', 'zipCode');
        phone = getValue(data, 'phone', 'Phone', 'phone_number', 'phoneNumber', 'mobile', 'Mobile');
        cleanType = getValue(data, 'cleanType', 'CleanType', 'clean_type', 'clean type', 'type_of_cleaning', 'cleaningType');
        dateTime = getValue(data, 'dateTime', 'DateTime', 'date_time', 'date time', 'date_and_time', 'date and time', 'appointment_time');
        bookingType = getValue(data, 'bookingType', 'BookingType', 'booking_type', 'booking type', 'intent', 'call_type', 'callType');
        
        console.log('✅ Found in call.collected_dynamic_variables');
        console.log('📦 Keys received from Retell:', Object.keys(data));
        console.log('📦 Postcode value:', postcode);
    } else {
        console.log('⚠️ No collected_dynamic_variables found');
    }
    
    // FIX: IMPROVED custom_analysis_data handling with better key mapping
    if (body.call_analysis && body.call_analysis.custom_analysis_data) {
        const fallback = body.call_analysis.custom_analysis_data;
        
        console.log('📦 Checking custom_analysis_data for data');
        console.log('📦 Keys in custom_analysis_data:', Object.keys(fallback));
        
        // Map Retell's keys to our standard keys
        const mappedData = {};
        
        // Map all possible key variations
        for (const [key, value] of Object.entries(fallback)) {
            const lowerKey = key.toLowerCase().replace(/[_\s]/g, '');
            
            // Map the keys
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
            }
            
            // Also try exact key matches
            if (key === 'name') mappedData.name = value;
            if (key === 'postcode') mappedData.postcode = value;
            if (key === 'phone_number') mappedData.phone = value;
            if (key === 'cleanType') mappedData.cleanType = value;
            if (key === 'dateTime') mappedData.dateTime = value;
            if (key === 'bookingType') mappedData.bookingType = value;
        }
        
        // Apply mapped data (only if not already set)
        if (!name && mappedData.name) name = mappedData.name;
        if (!postcode && mappedData.postcode) postcode = mappedData.postcode;
        if (!phone && mappedData.phone) phone = mappedData.phone;
        if (!cleanType && mappedData.cleanType) cleanType = mappedData.cleanType;
        if (!dateTime && mappedData.dateTime) dateTime = mappedData.dateTime;
        if (!bookingType && mappedData.bookingType) bookingType = mappedData.bookingType;
        
        // Also try the original getValue with more specific patterns as fallback
        if (!postcode) postcode = getValue(fallback, 'postcode', 'post_code', 'postal_code', 'zip');
        if (!dateTime) dateTime = getValue(fallback, 'dateTime', 'date_time', 'appointment_time', 'appointmentTime');
        if (!cleanType) cleanType = getValue(fallback, 'cleanType', 'clean_type', 'cleaningType', 'cleaning_type');
        if (!bookingType) bookingType = getValue(fallback, 'bookingType', 'booking_type', 'intent', 'call_type');
        
        console.log('📦 Extracted from custom_analysis_data:', {
            name,
            postcode,
            phone,
            cleanType,
            dateTime,
            bookingType
        });
    }
    
    console.log('=== Extracted Data ===');
    console.log('Booking Type:', bookingType);
    console.log('Name:', name);
    console.log('Postcode:', postcode);
    console.log('Phone:', phone);
    console.log('Clean type:', cleanType);
    console.log('Date & Time:', dateTime);
    
    // ===== SEND CONTRACTOR SMS =====
    if (phone && CONTRACTOR_PHONE_NUMBER) {
        const contractorMessage = `New ${bookingType || 'booking'}!\nName: ${name || '?'}\nPostcode: ${postcode || 'Not provided'}\nPhone: ${phone}\nClean type: ${cleanType || '?'}\nDate & Time: ${dateTime || '?'}`;
        
        try {
            await twilioClient.messages.create({
                body: contractorMessage,
                from: TWILIO_PHONE_NUMBER,
                to: CONTRACTOR_PHONE_NUMBER
            });
            console.log('✅ Contractor SMS sent');
        } catch (err) {
            console.error('❌ Contractor SMS error:', err.message);
        }
    } else {
        console.log('❌ Missing phone or contractor number');
    }
    
    // ===== SEND CUSTOMER SMS =====
    const customerPhone = phone || getValue(body, 'phone', 'Phone', 'phone_number', 'phoneNumber', 'mobile', 'Mobile');
    const customerName = name || 'Customer';
    
    // Better validation: check if we have a real phone number
    const isValidPhone = customerPhone && 
                         customerPhone !== '?' && 
                         customerPhone !== 'undefined' && 
                         customerPhone !== 'null' &&
                         customerPhone.length > 5;
    
    if (isValidPhone) {
        let actionText = '';
        
        if (bookingType === 'booking' || bookingType === '' || !bookingType) {
            actionText = 'booked';
        } else if (bookingType === 'cancellation') {
            actionText = 'cancelled';
        } else if (bookingType === 'reschedule') {
            actionText = 'rescheduled';
        } else {
            actionText = 'booked';
        }
        
        // FIX: Proper date handling - check for ISO pattern, not just "T"
        let formattedDateTime = dateTime || 'your requested time';
        try {
            // Check if it's an ISO timestamp (YYYY-MM-DDTHH:MM)
            const isISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dateTime || '');
            
            if (isISO) {
                const dateObj = new Date(dateTime);
                formattedDateTime = dateObj.toLocaleString('en-GB', {
                    weekday: 'short',
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                console.log('📅 Formatted ISO date:', formattedDateTime);
            } else if (dateTime) {
                // It's a human-readable date from Retell - use it as-is
                formattedDateTime = dateTime;
                console.log('📅 Using human-readable date as-is:', formattedDateTime);
            }
        } catch (e) {
            console.log('⚠️ Could not format date/time, using raw value:', dateTime);
            formattedDateTime = dateTime || 'your requested time';
        }
        
        const customerMessage = `Hi ${customerName}, you've successfully ${actionText} a cleaning appointment with Magdalena Bielawa Cleaning Services for ${formattedDateTime}.\n\nAny questions? Please contact 07306666123`;
        
        console.log('📤 Sending customer SMS to:', customerPhone);
        console.log('📝 Message:', customerMessage);
        
        try {
            await twilioClient.messages.create({
                body: customerMessage,
                from: TWILIO_PHONE_NUMBER,
                to: customerPhone
            });
            console.log('✅ Customer SMS sent to:', customerPhone);
        } catch (err) {
            console.error('❌ Customer SMS error:', err.message);
        }
    } else {
        console.log('⚠️ No valid customer phone number found, skipping customer SMS');
        console.log('   Phone value was:', customerPhone);
    }
    
    res.status(200).send('OK');
});

// ========== SMS CONVERSATION ENDPOINT ==========

// Track SMS conversation states (in-memory - consider Redis/DB for production)
const smsConversations = new Map();

// Clean up old conversations after 24 hours
setInterval(() => {
    const now = Date.now();
    for (const [key, state] of smsConversations) {
        if (now - state.lastUpdated > 86400000) { // 24 hours
            smsConversations.delete(key);
        }
    }
}, 3600000); // Check every hour

function getSmsConversation(from, to) {
    const key = `${from}:${to}`;
    if (!smsConversations.has(key)) {
        smsConversations.set(key, {
            from,
            to,
            step: 'greeting',
            collectedData: {},
            lastUpdated: Date.now()
        });
    }
    return smsConversations.get(key);
}

// Helper to get base URL for internal API calls
function getBaseUrl(req) {
    return `${req.protocol}://${req.get('host')}`;
}

app.post('/sms-webhook', async (req, res) => {
    const { From, To, Body } = req.body;
    
    console.log('📱 SMS received');
    console.log('   From:', From);
    console.log('   To:', To);
    console.log('   Body:', Body);
    
    // Get or create conversation state
    const conversation = getSmsConversation(From, To);
    conversation.lastUpdated = Date.now();
    
    // Step 1: Determine what the customer wants
    const message = Body.trim().toLowerCase();
    
    // Check for cancel/reschedule intent first
    if (message.includes('cancel') || message.includes('cancellation')) {
        await handleCancelSms(req, From, To, conversation);
        return res.status(200).send('OK');
    }
    
    if (message.includes('reschedule') || message.includes('change') || message.includes('move')) {
        await handleRescheduleSms(req, From, To, conversation);
        return res.status(200).send('OK');
    }
    
    // Check if booking is complete
    if (conversation.step === 'booking_complete') {
        // Customer is sending a new message after booking - restart or handle new request
        conversation.step = 'greeting';
        conversation.collectedData = {};
    }
    
    // Handle booking flow
    await handleBookingSms(req, From, To, Body, conversation);
    
    res.status(200).send('OK');
});

// SMS Handlers
async function handleBookingSms(req, from, to, body, conversation) {
    const message = body.trim();
    const data = conversation.collectedData;
    const step = conversation.step;
    
    console.log(`📋 SMS step: ${step}`);
    
    switch (step) {
        case 'greeting':
            // Customer said something like "Hi I'd like to book"
            await twilioClient.messages.create({
                body: "👋 Hi! I'd be happy to help you book a cleaning. What's your full name?",
                from: TWILIO_PHONE_NUMBER,
                to: from
            });
            conversation.step = 'collecting_name';
            break;
            
        case 'collecting_name':
            data.name = message;
            await twilioClient.messages.create({
                body: `Thanks ${data.name}! What's your postcode?`,
                from: TWILIO_PHONE_NUMBER,
                to: from
            });
            conversation.step = 'collecting_postcode';
            break;
            
        case 'collecting_postcode':
            data.postcode = message;
            await twilioClient.messages.create({
                body: "Great! What type of cleaning do you need? (deep clean, regular clean, end of tenancy)",
                from: TWILIO_PHONE_NUMBER,
                to: from
            });
            conversation.step = 'collecting_clean_type';
            break;
            
        case 'collecting_clean_type':
            data.cleanType = message;
            await twilioClient.messages.create({
                body: "Got it! When would you like the appointment? Please give me a date and time (e.g., tomorrow at 2 PM, or Friday 10 AM)",
                from: TWILIO_PHONE_NUMBER,
                to: from
            });
            conversation.step = 'collecting_date_time';
            break;
            
        case 'collecting_date_time':
            data.dateTime = message;
            data.bookingType = 'booking';
            
            // Extract phone from the "from" number
            const phone = from;
            const name = data.name;
            const postcode = data.postcode;
            
            // Create the booking
            try {
                // Convert human-readable date to ISO (simple attempt)
                let isoTime = null;
                try {
                    // Try to parse natural language date
                    const dateObj = new Date(message);
                    if (!isNaN(dateObj.getTime())) {
                        isoTime = dateObj.toISOString();
                    }
                } catch (e) {
                    console.log('⚠️ Could not parse date from SMS:', message);
                }
                
                // If we couldn't parse the date, ask again
                if (!isoTime) {
                    await twilioClient.messages.create({
                        body: "I couldn't understand that date/time. Could you please give it in a clearer format? (e.g., Friday at 2 PM, or 2026-07-09T14:00:00Z)",
                        from: TWILIO_PHONE_NUMBER,
                        to: from
                    });
                    return;
                }
                
                const baseUrl = getBaseUrl(req);
                
                // Call your booking endpoint
                const bookingResponse = await fetch(`${baseUrl}/cal/book-appointment`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: name,
                        phone: phone,
                        postcode: postcode,
                        time: isoTime
                    })
                });
                
                const bookingResult = await bookingResponse.json();
                
                if (bookingResult.success) {
                    // Send confirmation to customer
                    const dateObj = new Date(isoTime);
                    const formattedDate = dateObj.toLocaleString('en-GB', {
                        weekday: 'short',
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    
                    await twilioClient.messages.create({
                        body: `✅ Booking confirmed!\n\nName: ${name}\nPostcode: ${postcode}\nClean type: ${data.cleanType}\nDate & Time: ${formattedDate}\n\n📱 To cancel or reschedule, just reply "cancel" or "reschedule"`,
                        from: TWILIO_PHONE_NUMBER,
                        to: from
                    });
                    
                    conversation.step = 'booking_complete';
                    console.log('✅ SMS booking complete for:', phone);
                    
                    // Also send contractor notification
                    const contractorMessage = `New SMS booking!\nName: ${name}\nPhone: ${phone}\nPostcode: ${postcode}\nClean type: ${data.cleanType}\nDate & Time: ${formattedDate}`;
                    await twilioClient.messages.create({
                        body: contractorMessage,
                        from: TWILIO_PHONE_NUMBER,
                        to: CONTRACTOR_PHONE_NUMBER
                    });
                    
                } else {
                    await twilioClient.messages.create({
                        body: `❌ Sorry, I couldn't book that time. Please try again with a different time.`,
                        from: TWILIO_PHONE_NUMBER,
                        to: from
                    });
                }
                
            } catch (error) {
                console.error('❌ SMS booking error:', error.message);
                await twilioClient.messages.create({
                    body: "❌ Something went wrong. Please try again or call us at 07306666123",
                    from: TWILIO_PHONE_NUMBER,
                    to: from
                });
            }
            break;
            
        default:
            // Unknown state - reset
            conversation.step = 'greeting';
            conversation.collectedData = {};
            await twilioClient.messages.create({
                body: "Hi! Would you like to book a cleaning? Just reply 'yes' or tell me what you need.",
                from: TWILIO_PHONE_NUMBER,
                to: from
            });
    }
}

async function handleCancelSms(req, from, to, conversation) {
    // Search for their booking by phone number
    const phone = from;
    const baseUrl = getBaseUrl(req);
    
    try {
        const searchResponse = await fetch(`${baseUrl}/cal/search-bookings-by-phone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
        });
        
        const searchResult = await searchResponse.json();
        
        if (!searchResult.success || searchResult.count === 0) {
            await twilioClient.messages.create({
                body: "I couldn't find any upcoming bookings for this phone number. If you need help, please call us at 07306666123",
                from: TWILIO_PHONE_NUMBER,
                to: from
            });
            return;
        }
        
        // For now, just list bookings (in production, let them choose)
        const bookings = searchResult.bookings;
        if (bookings.length === 1) {
            // Cancel the only booking
            const bookingUid = bookings[0].bookingUid;
            const cancelResponse = await fetch(`${baseUrl}/cal/cancel-booking`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingUid,
                    cancellationReason: 'Customer requested via SMS'
                })
            });
            
            const cancelResult = await cancelResponse.json();
            
            if (cancelResult.success) {
                await twilioClient.messages.create({
                    body: "✅ Your booking has been cancelled. If you need to book again, just let me know!",
                    from: TWILIO_PHONE_NUMBER,
                    to: from
                });
            } else {
                await twilioClient.messages.create({
                    body: "❌ I couldn't cancel your booking. Please call us at 07306666123 for help.",
                    from: TWILIO_PHONE_NUMBER,
                    to: from
                });
            }
        } else {
            // Multiple bookings - list them (simplified)
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
            
            await twilioClient.messages.create({
                body: listMessage,
                from: TWILIO_PHONE_NUMBER,
                to: from
            });
        }
    } catch (error) {
        console.error('❌ SMS cancel error:', error.message);
        await twilioClient.messages.create({
            body: "❌ Something went wrong. Please call us at 07306666123 for help.",
            from: TWILIO_PHONE_NUMBER,
            to: from
        });
    }
}

async function handleRescheduleSms(req, from, to, conversation) {
    // For Phase 1, suggest calling for reschedule
    await twilioClient.messages.create({
        body: "To reschedule, please call us at 07306666123 and we'll find a new time for you.",
        from: TWILIO_PHONE_NUMBER,
        to: from
    });
}

// ========== END SMS CONVERSATION ==========

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

// NEW ENDPOINT - Search all bookings by phone number
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
        
        // Normalize phone number for comparison (remove spaces, +, -, etc.)
        const normalizePhone = (p) => p?.replace(/[\s\+\-\(\)]/g, '');
        const normalizedSearchPhone = normalizePhone(phone);
        
        const matchingBookings = bookings.data?.filter(b => 
            b.attendees?.some(a => normalizePhone(a.phoneNumber) === normalizedSearchPhone)
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
    const { bookingUid, cancellationReason } = req.body;
    
    console.log('🗑️ Cancelling booking:', bookingUid);
    
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
        console.log('✅ Cancellation response:', result);
        res.json({ success: true, result });
    } catch (error) {
        console.error('❌ Cancellation error:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// CORRECTED RESCHEDULE ENDPOINT - Removed reason and rescheduleReason fields
app.post('/cal/reschedule-booking', async (req, res) => {
    const { bookingUid, newStartTime } = req.body;
    
    console.log('📅 Rescheduling booking:', bookingUid);
    console.log('🕒 New time:', newStartTime);
    
    // Ensure time is valid ISO format
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

// UPDATED BOOKING ENDPOINT - Added postcode support
app.post('/cal/book-appointment', async (req, res) => {
    const { name, phone, time, postcode } = req.body;
    
    console.log('📅 Booking appointment for:', name);
    console.log('📞 Phone:', phone);
    console.log('🕒 Time received:', time);
    console.log('📍 Postcode:', postcode);
    
    // Generate a unique fake email
    const fakeEmail = `${name.toLowerCase().replace(/\s/g, '')}_${Date.now()}@phonebooking.local`;
    console.log('📧 Generated fake email:', fakeEmail);
    
    // Fix time format - ensure it's valid ISO string
    let validTime = time;
    if (!time || time === '') {
        console.log('❌ No time provided');
        return res.json({ success: false, error: 'No time provided' });
    }
    
    // If time doesn't have Z or T, try to convert it
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
                    source: 'phone_call'
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
    
    // Respond immediately to acknowledge receipt
    res.status(200).send('OK');
    
    // Process the webhook data asynchronously
    if (body.triggerEvent === 'BOOKING_CREATED') {
        const booking = body.payload;
        const attendee = booking.attendees?.[0] || {};
        
        const name = attendee.name || 'Unknown';
        const phone = attendee.phoneNumber || booking.responses?.phone || '?';
        const email = attendee.email || '?';
        const dateTime = booking.startTime || '?';
        const bookingType = 'booking';
        const postcode = booking.metadata?.postcode || 'Not provided';
        
        console.log('=== New Booking Details ===');
        console.log('Name:', name);
        console.log('Phone:', phone);
        console.log('Email:', email);
        console.log('Date & Time:', dateTime);
        console.log('Postcode:', postcode);
        
        // Send SMS to contractor using your existing logic
        if (phone !== '?' && CONTRACTOR_PHONE_NUMBER) {
            try {
                await twilioClient.messages.create({
                    body: `New ${bookingType}!\nName: ${name}\nPhone: ${phone}\nPostcode: ${postcode}\nDate & Time: ${dateTime}`,
                    from: TWILIO_PHONE_NUMBER,
                    to: CONTRACTOR_PHONE_NUMBER
                });
                console.log('✅ SMS sent from webhook');
            } catch (err) {
                console.error('❌ SMS error:', err.message);
            }
        }
    }
});

// ========== END CAL.COM ENDPOINTS ==========

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
