const axios = require('axios');

class NowPaymentService {
  constructor() {
    this.apiKey = process.env.NOWPAYMENT_API_KEY;
    this.apiUrl = process.env.NOWPAYMENT_API_URL || 'https://api.nowpayments.io/v1';
    this.ipnSecret = process.env.NOWPAYMENT_IPN_SECRET;

    if (!this.apiKey) {
      throw new Error('NOWPAYMENT_API_KEY environment variable is required');
    }
  }

  // Test API connection
  async testApiConnection() {
    try {
      const response = await axios.get(`${this.apiUrl}/status`, {
        timeout: 5000
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // Get available currencies
  async getCurrencies() {
    try {
      const response = await axios.get(`${this.apiUrl}/currencies`, {
        headers: {
          'x-api-key': this.apiKey
        },
        timeout: 10000
      });

      return response.data;
    } catch (error) {
      console.error('Error fetching currencies:', error.response?.data || error.message);
      throw error;
    }
  }

  // Get estimated price for currency conversion
  async getEstimatedPrice(amount, fromCurrency = 'usd', toCurrency = 'usdtbsc') {
    try {
      const response = await axios.get(`${this.apiUrl}/estimate`, {
        params: {
          amount: amount,
          currency_from: fromCurrency.toLowerCase(),
          currency_to: toCurrency.toLowerCase()
        },
        headers: {
          'x-api-key': this.apiKey
        },
        timeout: 10000
      });

      return response.data;
    } catch (error) {
      console.error('Error getting estimated price:', error.response?.data || error.message);
      throw error;
    }
  }

  // Create payment for deposit (usd to usdtbsc)
  async createDepositPayment(amount, orderId, successUrl = null, cancelUrl = null) {
    try {
      const paymentData = {
        price_amount: parseFloat(amount).toFixed(2),
        price_currency: 'usd',
        is_fixed_rate: JSON.parse(process.env.NOWPAYMENT_IS_FIXED_RATE || 'true'),
        is_fee_paid_by_user: JSON.parse(process.env.NOWPAYMENT_IS_FEE_PAID_BY_USER || 'true'),
        pay_currency: 'usdtbsc',
        order_id: orderId,
        order_description: `${orderId} - Deposit $${parseFloat(amount).toFixed(2)}`,
        ipn_callback_url: process.env.NOWPAYMENT_IPN_URL || `${process.env.BASE_URL || 'http://localhost:3001'}/api/wallet/deposit/callback`
      };

      const response = await axios.post(`${this.apiUrl}/payment`, paymentData, {
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      return response.data;
    } catch (error) {
      console.error('Error creating deposit payment:', error.response?.data || error.message);
      throw error;
    }
  }

  // Get payment status
  async getPaymentStatus(paymentId) {
    try {
      const response = await axios.get(`${this.apiUrl}/payment/${paymentId}`, {
        headers: {
          'x-api-key': this.apiKey
        },
        timeout: 10000
      });

      return response.data;
    } catch (error) {
      console.error('Error getting payment status:', error.response?.data || error.message);
      throw error;
    }
  }

  // Get payout status
  async getPayoutStatus(payoutId) {
    try {
      const response = await axios.get(`${this.apiUrl}/payout/${payoutId}`, {
        headers: {
          'x-api-key': this.apiKey
        },
        timeout: 10000
      });

      return response.data;
    } catch (error) {
      console.error('Error getting payout status:', error.response?.data || error.message);
      throw error;
    }
  }

  // Create payout (withdrawal) to user wallet
  async createPayout({ amount, payoutAddress, payoutCurrency = 'usdtbsc', priceCurrency = 'usd', ipnCallbackUrl = null }) {
    try {
      const payload = {
        withdraw_address: payoutAddress,
        withdraw_amount: parseFloat(amount).toFixed(2),
        withdraw_currency: payoutCurrency.toLowerCase(),
        payout_currency: payoutCurrency.toLowerCase(),
        // price_currency lets you denominate in fiat, even if payout is crypto
        price_currency: priceCurrency.toLowerCase(),
      };

      if (ipnCallbackUrl) {
        payload.ipn_callback_url = ipnCallbackUrl;
      }

      const response = await axios.post(`${this.apiUrl}/payout`, payload, {
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      return response.data;
    } catch (error) {
      console.error('Error creating payout:', error.response?.data || error.message);
      throw error;
    }
  }

  // Validate IPN (Instant Payment Notification)
  validateIPN(payload, signature) {
    if (!this.ipnSecret) {
      console.warn('NOWPAYMENT_IPN_SECRET not configured, skipping IPN validation');
      return true;
    }

    const crypto = require('crypto');
    const expectedSignature = crypto
      .createHmac('sha512', this.ipnSecret)
      .update(JSON.stringify(payload))
      .digest('hex');

    return signature === expectedSignature;
  }

  // Process deposit callback
  async processDepositCallback(paymentData) {
    try {
      const {
        payment_id,
        payment_status,
        pay_amount,
        pay_currency,
        price_amount,
        price_currency,
        order_id,
        actually_paid,
        actually_paid_at_fiat,
        outcome_amount,
        outcome_currency,
        fee,
        updated_at,
        pay_address,
        purchase_id,
        payin_extra_id,
        parent_payment_id,
        payment_extra_ids,
        invoice_id
      } = paymentData;

      // Update transaction status based on payment status
      let status = 'pending';

      switch (payment_status) {
        case 'finished':
        case 'confirmed':
          status = 'completed';
          break;
        case 'failed':
        case 'expired':
          status = 'failed';
          break;
        case 'partially_paid':
          status = 'partially_paid';
          break;
        default:
          status = 'pending';
      }

      // Build comprehensive response
      const response = {
        payment_id,
        status,
        payment_status, // Keep original NOWPayments status
        pay_amount: parseFloat(pay_amount || 0),
        pay_currency,
        price_amount: parseFloat(price_amount || 0),
        price_currency,
        order_id,
        updated_at
      };

      // Add optional fields if they exist
      if (actually_paid !== undefined && actually_paid !== null) {
        response.actually_paid = parseFloat(actually_paid);
      }

      if (actually_paid_at_fiat !== undefined && actually_paid_at_fiat !== null) {
        response.actually_paid_at_fiat = parseFloat(actually_paid_at_fiat);
      }

      if (outcome_amount !== undefined && outcome_amount !== null) {
        response.outcome_amount = parseFloat(outcome_amount);
      }

      if (outcome_currency) {
        response.outcome_currency = outcome_currency;
      }

      if (fee) {
        response.fee = fee;
      }

      if (pay_address) {
        response.pay_address = pay_address;
      }

      if (purchase_id) {
        response.purchase_id = purchase_id;
      }

      if (payin_extra_id) {
        response.payin_extra_id = payin_extra_id;
      }

      if (parent_payment_id) {
        response.parent_payment_id = parent_payment_id;
      }

      if (payment_extra_ids) {
        response.payment_extra_ids = payment_extra_ids;
      }

      if (invoice_id) {
        response.invoice_id = invoice_id;
      }

      return response;
    } catch (error) {
      console.error('Error processing deposit callback:', error);
      throw error;
    }
  }

  // Get minimum payment amount
  async getMinPaymentAmount(fromCurrency = 'usdtbsc', toCurrency = 'usd') {
    try {
      const response = await axios.get(`${this.apiUrl}/min-amount`, {
        params: {
          currency_from: fromCurrency.toLowerCase(),
          currency_to: toCurrency.toLowerCase()
        },
        headers: {
          'x-api-key': this.apiKey
        },
        timeout: 10000
      });

      return response.data;
    } catch (error) {
      console.error('Error getting minimum payment amount:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = new NowPaymentService();
