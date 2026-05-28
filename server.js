const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
    res.send('FlowSpeak backend is running!');
});

app.post('/retell-webhook', (req, res) => {
    console.log('Received webhook from Retell:');
    console.log('Body:', req.body);
    res.status(200).json({ received: true });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Retell webhook endpoint: http://localhost:${PORT}/retell-webhook`);
});