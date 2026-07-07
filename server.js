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
