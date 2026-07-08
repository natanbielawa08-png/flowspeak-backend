const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
    res.send('FlowSpeak backend is running!');
});

// Test endpoint for Retell
app.post('/post-call-webhook', (req, res) => {
    console.log('✅ Retell webhook hit!');
    res.status(200).send('OK');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
