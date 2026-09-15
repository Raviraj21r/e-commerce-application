require('dotenv').config();

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const Razorpay = require('razorpay');

const app = express();
const port = Number(process.env.PORT) || 5000;
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ravishop';

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in .env');
}

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

const orderSchema = new mongoose.Schema({
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String, required: true, unique: true },
    items: [{
        productId: { type: mongoose.Schema.Types.Mixed, required: true },
        name: { type: String, required: true, trim: true },
        price: { type: Number, required: true, min: 0 },
        quantity: { type: Number, required: true, min: 1 },
        image: String
    }],
    deliveryAddress: { type: mongoose.Schema.Types.Mixed, required: true },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, default: 'INR' },
    paymentStatus: { type: String, enum: ['paid', 'failed'], required: true }
}, { timestamps: true });

const Order = mongoose.model('Order', orderSchema);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'e-commeece project.html'));
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.get('/api/orders', async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 }).lean();
        res.json(orders);
    } catch (error) {
        console.error('Fetch orders error:', error);
        res.status(500).json({ message: 'Unable to load orders.' });
    }
});

app.post('/api/create-order', async (req, res) => {
    try {
        const { items } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: 'At least one item is required.' });
        }

        const normalizedItems = items.map((item) => ({
            productId: item.id ?? item.productId,
            name: String(item.name || '').trim(),
            price: Number(item.price),
            quantity: Number(item.quantity) || 1,
            image: item.image
        }));

        const hasInvalidItem = normalizedItems.some((item) => (
            item.productId === undefined || !item.name ||
            !Number.isFinite(item.price) || item.price < 0 ||
            !Number.isInteger(item.quantity) || item.quantity < 1
        ));

        if (hasInvalidItem) {
            return res.status(400).json({ message: 'Each item must have a valid id, name, price, and quantity.' });
        }

        const amount = Math.round(normalizedItems.reduce(
            (total, item) => total + item.price * item.quantity, 0
        ) * 100);

        if (amount < 100) {
            return res.status(400).json({ message: 'Order amount must be at least INR 1.' });
        }

        const razorpayOrder = await razorpay.orders.create({
            amount,
            currency: 'INR',
            receipt: `receipt_${Date.now()}`,
            notes: { itemCount: String(normalizedItems.length) }
        });

        res.status(201).json({
            orderId: razorpayOrder.id,
            amount: razorpayOrder.amount,
            currency: razorpayOrder.currency,
            keyId: process.env.RAZORPAY_KEY_ID
        });
    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({ message: 'Unable to create payment order.' });
    }
});

app.post('/api/verify-payment', async (req, res) => {
    try {
        const {
            razorpay_order_id: razorpayOrderId,
            razorpay_payment_id: razorpayPaymentId,
            razorpay_signature: razorpaySignature,
            items,
            deliveryAddress
        } = req.body;

        if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !Array.isArray(items) || !deliveryAddress) {
            return res.status(400).json({ message: 'Payment details, items, and delivery address are required.' });
        }

        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(`${razorpayOrderId}|${razorpayPaymentId}`)
            .digest('hex');

        const expectedSignatureBuffer = Buffer.from(expectedSignature, 'utf8');
        const receivedSignatureBuffer = Buffer.from(String(razorpaySignature), 'utf8');
        const signaturesMatch = expectedSignatureBuffer.length === receivedSignatureBuffer.length &&
            crypto.timingSafeEqual(expectedSignatureBuffer, receivedSignatureBuffer);

        if (!signaturesMatch) {
            return res.status(400).json({ message: 'Invalid payment signature.' });
        }

        const normalizedItems = items.map((item) => ({
            productId: item.id ?? item.productId,
            name: String(item.name || '').trim(),
            price: Number(item.price),
            quantity: Number(item.quantity) || 1,
            image: item.image
        }));

        const amount = Math.round(normalizedItems.reduce(
            (total, item) => total + item.price * item.quantity, 0
        ) * 100);

        const order = await Order.create({
            razorpayOrderId,
            razorpayPaymentId,
            items: normalizedItems,
            deliveryAddress,
            amount,
            paymentStatus: 'paid'
        });

        res.status(201).json({
            message: 'Payment verified and order saved.',
            orderId: order._id,
            paymentStatus: order.paymentStatus
        });
    } catch (error) {
        console.error('Verify payment error:', error);
        res.status(500).json({ message: 'Unable to verify or save payment.' });
    }
});

app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && error.body) {
        return res.status(400).json({ message: 'Request body must contain valid JSON.' });
    }

    next(error);
});

const databaseConnection = mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        console.log('MongoDB Atlas Connected Successfully!');
    })
    .catch((error) => {
        console.error('MongoDB connection error:', error);
        throw error;
    });

if (require.main === module) {
    databaseConnection.then(() => {
        app.listen(port, () => {
            console.log(`RaviShop server running at http://localhost:${port}`);
        });
    }).catch(() => {
        process.exit(1);
    });
}

module.exports = app;
