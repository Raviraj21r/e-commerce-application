(function () {
    const apiBase = '/api';

    function openModal(modal) {
        if (modal) modal.classList.add('open');
    }

    function closeModal(modal) {
        if (modal) modal.classList.remove('open');
    }

    function getCart() {
        return typeof window.getCart === 'function' ? window.getCart() : [];
    }

    function getCartTotal(cart) {
        return cart.reduce((total, item) => total + item.price * item.quantity, 0);
    }

    function showCheckoutError(message) {
        const error = document.getElementById('checkout-error');
        if (error) error.textContent = message;
    }

    function renderConfirmation(order, address, items, amount) {
        const confirmation = document.getElementById('order-confirmation');
        if (!confirmation) return;

        confirmation.hidden = false;
        confirmation.innerHTML = `
            <div class="confirmation-card">
                <div class="confirmation-icon"><i class="fas fa-check"></i></div>
                <p class="eyebrow">Payment successful</p>
                <h1>Order confirmed</h1>
                <p>Your order has been placed and will be delivered to the address below.</p>
                <div class="confirmation-details">
                    <strong>Order ID</strong><span>${order.orderId}</span>
                    <strong>Total paid</strong><span>₹${amount.toFixed(2)}</span>
                    <strong>Deliver to</strong><span>${address.name}, ${address.address}, ${address.city}, ${address.state} - ${address.pincode}</span>
                </div>
                <p>${items.length} product${items.length === 1 ? '' : 's'} in this order</p>
                <a class="confirmation-link" href="orders.html">View all orders</a>
                <button class="confirmation-link secondary" type="button" id="continue-shopping">Continue shopping</button>
            </div>
        `;
        document.body.classList.add('confirmation-open');
        document.getElementById('continue-shopping').addEventListener('click', () => {
            confirmation.hidden = true;
            document.body.classList.remove('confirmation-open');
        });
    }

    async function beginCheckout(event) {
        event.preventDefault();
        const cart = getCart();
        const form = event.currentTarget;
        const formData = new FormData(form);
        const deliveryAddress = Object.fromEntries(formData.entries());

        if (!cart.length) {
            showCheckoutError('Your cart is empty.');
            return;
        }

        const submitButton = form.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        submitButton.textContent = 'Preparing payment...';
        showCheckoutError('');

        try {
            const response = await fetch(`${apiBase}/create-order`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: cart })
            });
            const order = await response.json();
            if (!response.ok) throw new Error(order.message || 'Unable to create payment order.');

            if (typeof Razorpay === 'undefined') {
                throw new Error('Razorpay Checkout could not be loaded.');
            }

            const razorpay = new Razorpay({
                key: order.keyId,
                amount: order.amount,
                currency: order.currency,
                name: 'RaviShop',
                description: 'RaviShop order payment',
                order_id: order.orderId,
                prefill: { name: deliveryAddress.name, contact: deliveryAddress.phone },
                notes: deliveryAddress,
                theme: { color: '#2874f0' },
                handler: async function (payment) {
                    try {
                        const verification = await fetch(`${apiBase}/verify-payment`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                ...payment,
                                items: cart,
                                deliveryAddress
                            })
                        });
                        const result = await verification.json();
                        if (!verification.ok) throw new Error(result.message || 'Payment verification failed.');

                        const paidItems = [...cart];
                        const paidAmount = getCartTotal(paidItems);
                        cart.length = 0;
                        document.getElementById('cart-count').textContent = '0';
                        closeModal(document.getElementById('checkout-modal'));
                        renderConfirmation({ orderId: result.orderId }, deliveryAddress, paidItems, paidAmount);
                    } catch (error) {
                        showCheckoutError(error.message);
                    }
                },
                modal: { ondismiss: () => { submitButton.disabled = false; submitButton.textContent = 'Proceed to Pay'; } }
            });
            razorpay.open();
        } catch (error) {
            showCheckoutError(error.message);
            submitButton.disabled = false;
            submitButton.textContent = 'Proceed to Pay';
        }
    }

    function initializeStorefront() {
        const menuToggle = document.getElementById('menu-toggle');
        const navLinks = document.querySelector('.nav-links');
        if (menuToggle && navLinks) {
            menuToggle.addEventListener('click', () => {
                const isOpen = navLinks.classList.toggle('open');
                menuToggle.setAttribute('aria-expanded', String(isOpen));
            });
            navLinks.addEventListener('click', (event) => {
                if (event.target.tagName === 'A') navLinks.classList.remove('open');
            });
        }

        const checkoutModal = document.getElementById('checkout-modal');
        const checkoutForm = document.getElementById('checkout-form');
        const checkoutButton = document.querySelector('.cart-checkout-btn');
        const checkoutClose = document.getElementById('checkout-modal-close');

        checkoutButton?.addEventListener('click', () => {
            const cart = getCart();
            if (!cart.length) return;
            openModal(checkoutModal);
        });
        checkoutClose?.addEventListener('click', () => closeModal(checkoutModal));
        checkoutForm?.addEventListener('submit', beginCheckout);

        window.addEventListener('click', (event) => {
            if (event.target === checkoutModal) closeModal(checkoutModal);
        });

        document.addEventListener('click', (event) => {
            const closeButton = event.target.closest('.modal-close');
            if (closeButton) {
                const modal = closeButton.closest('.modal');
                closeModal(modal);
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            if (event.target.classList.contains('modal')) {
                closeModal(event.target);
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                document.querySelectorAll('.modal.open').forEach(closeModal);
            }
        });
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[character]));
    }

    async function initializeOrdersPage() {
        const ordersList = document.getElementById('orders-list');
        if (!ordersList) return;

        try {
            const response = await fetch(`${apiBase}/orders`);
            const orders = await response.json();
            if (!response.ok) throw new Error(orders.message || 'Unable to load orders.');
            if (!orders.length) {
                ordersList.innerHTML = '<div class="empty-orders"><i class="fas fa-box-open"></i><h2>No orders yet</h2><p>Your placed orders will appear here.</p><a href="e-commeece project.html">Start shopping</a></div>';
                return;
            }

            ordersList.innerHTML = orders.map((order) => `
                <article class="order-card">
                    <div class="order-card-header"><strong>Order ${escapeHtml(order.razorpayOrderId)}</strong><span>${new Date(order.createdAt).toLocaleDateString()}</span></div>
                    <div class="order-products">${order.items.map((item) => `
                        <div class="order-product"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}"><div><strong>${escapeHtml(item.name)}</strong><p>${item.quantity} x ₹${Number(item.price).toFixed(2)}</p></div></div>
                    `).join('')}</div>
                    <div class="order-summary"><div><strong>Delivery address</strong><p>${escapeHtml(order.deliveryAddress.name)}, ${escapeHtml(order.deliveryAddress.address)}, ${escapeHtml(order.deliveryAddress.city)}, ${escapeHtml(order.deliveryAddress.state)} - ${escapeHtml(order.deliveryAddress.pincode)}</p></div><strong>₹${(Number(order.amount) / 100).toFixed(2)}</strong></div>
                    <div class="status-tracker">${['Placed', 'Processed', 'Shipped', 'Out for Delivery', 'Delivered'].map((status, index) => `<div class="status-step ${index === 0 ? 'active' : ''}"><span>${index + 1}</span><small>${status}</small></div>`).join('')}</div>
                    <p class="payment-status"><i class="fas fa-circle-check"></i> ${escapeHtml(order.paymentStatus)}</p>
                </article>
            `).join('');
        } catch (error) {
            ordersList.innerHTML = `<div class="empty-orders"><h2>Could not load orders</h2><p>${escapeHtml(error.message)}</p></div>`;
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        initializeStorefront();
        initializeOrdersPage();
    });
}());