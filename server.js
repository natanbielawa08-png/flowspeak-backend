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
    
    if (body.call_analysis && body.call_analysis.custom_analysis_data) {
        const fallback = body.call_analysis.custom_analysis_data;
        
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
    
    // Send contractor SMS
    if (phone && CONTRACTOR_PHONE_NUMBER) {
        twilioClient.messages.create({
            body: `New ${bookingType || 'booking'}!\nName: ${name || '?'}\nPostcode: ${postcode || '?'}\nPhone: ${phone}\nClean type: ${cleanType || '?'}\nDate & Time: ${dateTime || '?'}`,
            from: TWILIO_PHONE_NUMBER,
            to: CONTRACTOR_PHONE_NUMBER
        })
        .then(() => {
            console.log('✅ Contractor SMS sent');
        })
        .catch(err => {
            console.error('❌ Contractor SMS error:', err.message);
        });
    } else {
        console.log('❌ Missing phone or contractor number');
    }
    
    // Send customer confirmation SMS
    if (phone && phone !== '?') {
        let actionText = '';
        
        if (bookingType === 'booking') {
            actionText = 'booked';
        } else if (bookingType === 'cancellation') {
            actionText = 'cancelled';
        } else if (bookingType === 'reschedule') {
            actionText = 'rescheduled';
        } else {
            actionText = 'booked';
        }
        
        const customerMessage = `You've successfully ${actionText} a booking with Magdalena Bielawa Cleaning Services!\n\nAny questions? Please contact 07306666123`;
        
        twilioClient.messages.create({
            body: customerMessage,
            from: TWILIO_PHONE_NUMBER,
            to: phone
        })
        .then(() => {
            console.log('✅ Customer SMS sent to:', phone);
        })
        .catch(err => {
            console.error('❌ Customer SMS error:', err.message);
        });
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

app.post('/cal/reschedule-booking', async (req, res) => {
    const { bookingUid, newStartTime, reason } = req.body;
    
    console.log('📅 Rescheduling booking:', bookingUid);
    console.log('🕒 New time:', newStartTime);
    
    try {
        const response = await fetch(`https://api.cal.com/v2/bookings/${bookingUid}/reschedule`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.CAL_API_KEY}`,
                'Content-Type': 'application/json',
                'cal-api-version': '2024-08-13'
            },
            body: JSON.stringify({
                start: newStartTime,
                reason: reason || 'Customer requested reschedule via phone',
                rescheduleReason: 'Customer requested change'
            })
        });
        
        const result = await response.json();
        console.log('✅ Reschedule response:', result);
        
        if (response.ok) {
            res.json({ 
                success: true, 
                newBookingUid: result.data?.uid,
                result: result 
            });
        } else {
            res.json({ success: false, error: result.error?.message || 'Reschedule failed' });
        }
    } catch (error) {
        console.error('❌ Reschedule error:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// UPDATED BOOKING ENDPOINT - FIXED VERSION
app.post('/cal/book-appointment', async (req, res) => {
    const { name, phone, time } = req.body;
    
    console.log('📅 Booking appointment for:', name);
    console.log('📞 Phone:', phone);
    console.log('🕒 Time:', time);
    
    // Generate a unique fake email
    const fakeEmail = `${name.toLowerCase().replace(/\s/g, '')}_${Date.now()}@phonebooking.local`;
    console.log('📧 Generated fake email:', fakeEmail);
    
    try {
        const response = await fetch('https://api.cal.com/v2/bookings', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.CAL_API_KEY}`,
                'Content-Type': 'application/json',
                'cal-api-version': '2024-08-13'
            },
            body: JSON.stringify({
                start: time,
                eventTypeId: 6005228,
                title: "Cleaning Appointment",
                metadata: {},
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
        console.log('✅ Cal.com response:', result);
        
        if (response.ok) {
            res.json({ 
                success: true, 
                bookingUid: result.data?.uid,
                message: "Booking confirmed"
            });
        } else {
            console.log('❌ Cal.com error:', result);
            res.json({ success: false, error: result.error?.message || 'Booking failed' });
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
        
        console.log('=== New Booking Details ===');
        console.log('Name:', name);
        console.log('Phone:', phone);
        console.log('Email:', email);
        console.log('Date & Time:', dateTime);
        
        // Send SMS to contractor using your existing logic
        if (phone !== '?' && CONTRACTOR_PHONE_NUMBER) {
            try {
                await twilioClient.messages.create({
                    body: `New ${bookingType}!\nName: ${name}\nPhone: ${phone}\nDate & Time: ${dateTime}`,
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
