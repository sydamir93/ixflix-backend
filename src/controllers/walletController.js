const Wallet = require("../models/Wallet");
const Transaction = require("../models/Transaction");
const NowPaymentService = require("../services/NowPaymentService");
const RewardCap = require("../models/RewardCap");
const JobRun = require("../models/JobRun");
const db = require("../config/database");
const { logger } = require("../utils/logger");

// Withdraw via NowPayments payout
const initiateWithdraw = async (req, res) => {
  try {
    // Check if withdrawals are disabled
    const withdrawalsEnabled = process.env.WITHDRAWALS_ENABLED !== "false";
    if (!withdrawalsEnabled) {
      return res.status(503).json({
        status: "ERROR",
        message: "Withdrawals are currently disabled",
      });
    }

    const userId = req.user.id;
    const { amount, address, payoutCurrency = "usdtbsc" } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({
        status: "ERROR",
        message: "Valid amount is required",
      });
    }

    const withdrawAmount = parseFloat(amount);
    const withdrawFeePercentRaw = parseFloat(
      process.env.WITHDRAW_FEE_PERCENT || "7"
    );
    const withdrawFeePercent = Math.max(
      0,
      Number.isNaN(withdrawFeePercentRaw) ? 0 : withdrawFeePercentRaw
    );
    const fee = Math.max(0, (withdrawAmount * withdrawFeePercent) / 100);
    const totalDebit = withdrawAmount + fee;

    if (!address) {
      return res.status(400).json({
        status: "ERROR",
        message: "Destination address is required",
      });
    }

    // Check balance
    const hasBalance = await Wallet.hasSufficientBalance(
      userId,
      totalDebit,
      "main"
    );
    if (!hasBalance) {
      return res.status(400).json({
        status: "ERROR",
        message: "Insufficient wallet balance",
      });
    }

    // Create payout with NowPayments
    const payout = await NowPaymentService.createPayout({
      amount: withdrawAmount,
      payoutAddress: address,
      payoutCurrency,
      priceCurrency: "usd",
      ipnCallbackUrl: process.env.NOWPAYMENT_PAYOUT_IPN_URL || null,
    });

    // Deduct immediately to reserve funds
    await db.transaction(async (trx) => {
      // Transaction record
      await Transaction.create({
        user_id: userId,
        wallet_type: "main",
        transaction_type: "withdraw",
        reference_type: "nowpayment_payout",
        reference_id:
          payout?.id?.toString?.() ||
          payout?.payment_id?.toString?.() ||
          `PAYOUT-${Date.now()}`,
        amount: -withdrawAmount,
        fee,
        currency: "USD",
        status: "pending",
        description: `Withdraw $${withdrawAmount.toFixed(2)} via NowPayments`,
        metadata: {
          payout,
          payoutCurrency,
          address,
          withdrawFeePercent,
          feeAmount: fee,
        },
      });

      // Deduct from wallet
      await Wallet.updateBalance(userId, totalDebit, "subtract", "main", trx);
    });

    return res.status(200).json({
      status: "SUCCESS",
      message: "Withdrawal initiated",
      data: {
        payout,
        fee,
        feePercent: withdrawFeePercent,
        totalDebited: totalDebit,
      },
    });
  } catch (error) {
    console.error("Initiate withdraw error:", error);
    let message = "Failed to initiate withdraw";
    if (error.response?.data?.message) {
      message += `: ${error.response.data.message}`;
    } else if (error.message) {
      message += `: ${error.message}`;
    }
    return res.status(500).json({
      status: "ERROR",
      message,
    });
  }
};

// Get wallet balance for main wallet only (IXFLIX)
const getBalance = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get or create main wallet
    const wallet = await Wallet.getOrCreateBothWallets(userId);
    const balance = await Wallet.getBothBalances(userId);

    res.status(200).json({
      status: "SUCCESS",
      data: {
        wallet: wallet.main,
        balance: balance.main,
        total_balance: balance.main,
      },
    });
  } catch (error) {
    console.error("Get balance error:", error);
    res.status(500).json({
      status: "ERROR",
      message: "Internal server error",
    });
  }
};

// Get transaction history
const getTransactionHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 20,
      type,
      status,
      start_date,
      end_date,
    } = req.query;

    const offset = (page - 1) * limit;

    const filters = {
      limit: parseInt(limit),
      offset: parseInt(offset),
    };

    if (type) filters.transaction_type = type;
    if (status) filters.status = status;
    if (start_date) filters.start_date = start_date;
    if (end_date) filters.end_date = end_date;

    const transactions = await Transaction.findByUserId(userId, filters);
    const totalCount = await Transaction.count(userId, filters);

    res.status(200).json({
      status: "SUCCESS",
      data: {
        transactions: transactions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          total_pages: Math.ceil(totalCount / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get transaction history error:", error);
    res.status(500).json({
      status: "ERROR",
      message: "Internal server error",
    });
  }
};

// Get transaction statistics
const getTransactionStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const { start_date, end_date } = req.query;

    const dateRange = {};
    if (start_date) dateRange.start = start_date;
    if (end_date) dateRange.end = end_date;

    const stats = await Transaction.getUserStats(
      userId,
      Object.keys(dateRange).length > 0 ? dateRange : null
    );

    res.status(200).json({
      status: "SUCCESS",
      data: {
        stats: stats,
      },
    });
  } catch (error) {
    console.error("Get transaction stats error:", error);
    res.status(500).json({
      status: "ERROR",
      message: "Internal server error",
    });
  }
};

// Incentive summary (Catalyst, Synergy, Power Pass-Up) + cap info
const getIncentiveSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const types = ["catalyst_bonus", "synergy_flow", "power_passup"];

    const rows = await db("transactions")
      .where({ user_id: userId, status: "completed" })
      .whereIn("transaction_type", types)
      .select("transaction_type")
      .sum({ total: "amount" })
      .groupBy("transaction_type");

    const totals = types.reduce((acc, t) => {
      const row = rows.find((r) => r.transaction_type === t);
      acc[t] = parseFloat(row?.total || 0);
      return acc;
    }, {});

    const cap = await RewardCap.getCapInfo(userId);

    // Last synergy run stats (admin-run aggregate, not per-user), useful for visibility
    const lastSynergy = await JobRun.getStatus("synergy_flow");
    const lastCoreHarvest = await JobRun.getStatus("core_harvest");

    res.status(200).json({
      status: "SUCCESS",
      data: {
        totals,
        cap,
        last_synergy_run: lastSynergy,
        last_core_harvest_run: lastCoreHarvest,
      },
    });
  } catch (error) {
    console.error("Get incentive summary error:", error);
    res.status(500).json({
      status: "ERROR",
      message: "Internal server error",
    });
  }
};

// Initiate deposit via NowPayment (IXFLIX - minimum $25, increments of $25)
const initiateDeposit = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount } = req.body;

    // Validate amount
    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({
        status: "ERROR",
        message: "Valid amount is required",
      });
    }

    const depositAmount = parseFloat(amount);

    // IXFLIX specific validation: minimum $25, increments of $25
    if (depositAmount < 25) {
      return res.status(400).json({
        status: "ERROR",
        message: "Minimum deposit amount is $25.00",
      });
    }

    if (depositAmount % 25 !== 0) {
      return res.status(400).json({
        status: "ERROR",
        message: "Deposit amount must be in increments of $25",
      });
    }

    // Check minimum amount from NowPayment (skip if API fails)
    try {
      const minAmount = await NowPaymentService.getMinPaymentAmount(
        "usdtbsc",
        "usd"
      );
      const minAmountValue = parseFloat(minAmount.min_amount || "1");
      if (depositAmount < minAmountValue) {
        return res.status(400).json({
          status: "ERROR",
          message: `Minimum deposit amount is $${minAmountValue.toFixed(2)}`,
        });
      }
    } catch (error) {
      // Silently skip minimum amount validation if API fails
      console.warn(
        "Could not validate minimum amount with NowPayment:",
        error.message
      );
    }

    // Generate order ID for this deposit
    const orderId = `IXFLIX-${Date.now()}`;

    // Create NowPayment payment
    const payment = await NowPaymentService.createDepositPayment(
      depositAmount,
      orderId
    );

    // Create transaction record with payment metadata
    const transaction = await Transaction.create({
      user_id: userId,
      wallet_type: "main",
      transaction_type: "deposit",
      reference_type: "nowpayment",
      reference_id: orderId,
      amount: depositAmount,
      fee: 0, // No fee for IXFLIX deposits
      currency: "USD",
      status: "pending",
      description: `${orderId} - Deposit $${depositAmount.toFixed(
        2
      )} to main wallet`,
      metadata: {
        payment_id: payment.payment_id,
        pay_address: payment.pay_address,
        pay_amount: payment.pay_amount,
        pay_currency: payment.pay_currency,
        order_id: orderId,
        wallet_type: "main",
      },
    });

    res.status(200).json({
      status: "SUCCESS",
      message: "Deposit initiated successfully",
      data: {
        transaction: transaction,
        payment_url: payment.invoice_url,
        payment_id: payment.payment_id,
        pay_address: payment.pay_address,
        pay_amount: payment.pay_amount,
        pay_currency: payment.pay_currency,
      },
    });
  } catch (error) {
    console.error("Initiate deposit error:", error);

    let errorMessage = "Failed to initiate deposit";
    if (error.message) {
      errorMessage += `: ${error.message}`;
    }

    if (error.response) {
      console.error("NowPayment API response:", error.response.data);
      if (error.response.status === 401) {
        errorMessage = "Invalid NowPayment API key";
      } else if (error.response.status === 400) {
        errorMessage = "Invalid deposit parameters";
      } else if (error.response.status >= 500) {
        errorMessage = "NowPayment service temporarily unavailable";
      }
    }

    res.status(500).json({
      status: "ERROR",
      message: errorMessage,
    });
  }
};

// Wallet config (fees, etc.)
const getWalletConfig = async (_req, res) => {
  const transferFeeRaw = parseFloat(process.env.TRANSFER_FEE_AMOUNT || "1");
  const transferFeeAmount = Math.max(
    0,
    Number.isNaN(transferFeeRaw) ? 0 : transferFeeRaw
  );

  const withdrawFeePercentRaw = parseFloat(
    process.env.WITHDRAW_FEE_PERCENT || "7"
  );
  const withdrawFeePercent = Math.max(
    0,
    Number.isNaN(withdrawFeePercentRaw) ? 0 : withdrawFeePercentRaw
  );

  const withdrawalsEnabled = process.env.WITHDRAWALS_ENABLED !== "false";

  return res.status(200).json({
    status: "SUCCESS",
    data: {
      transferFeeAmount,
      withdrawFeePercent,
      withdrawalsEnabled,
      transferFeePercent: 0, // backward compatibility with older clients expecting percent
    },
  });
};

// Transfer between users (main wallet)
const transferToUser = async (req, res) => {
  try {
    const fromUserId = req.user.id;
    const { toPhoneNumber, amount, note } = req.body || {};

    if (!toPhoneNumber || !amount) {
      return res.status(400).json({
        status: "ERROR",
        message: "Destination phone number and amount are required",
      });
    }

    const transferAmount = parseFloat(amount);
    if (Number.isNaN(transferAmount) || transferAmount <= 0) {
      return res.status(400).json({
        status: "ERROR",
        message: "Amount must be greater than 0",
      });
    }

    // Find recipient by phone number
    const recipient = await db("users")
      .where({ phone_number: toPhoneNumber })
      .first();
    if (!recipient) {
      return res.status(404).json({
        status: "ERROR",
        message: "Recipient not found",
      });
    }

    if (recipient.id === fromUserId) {
      return res.status(400).json({
        status: "ERROR",
        message: "You cannot transfer to yourself",
      });
    }

    const feeRaw = parseFloat(process.env.TRANSFER_FEE_AMOUNT || "1");
    const fee = Math.max(0, Number.isNaN(feeRaw) ? 0 : feeRaw);
    const totalDebit = transferAmount + fee;

    // Check balance with fee included
    const hasBalance = await Wallet.hasSufficientBalance(
      fromUserId,
      totalDebit,
      "main"
    );
    if (!hasBalance) {
      return res.status(400).json({
        status: "ERROR",
        message: "Insufficient wallet balance",
      });
    }

    await db.transaction(async (trx) => {
      const timestamp = trx.fn.now();

      // Update balances
      await Wallet.updateBalance(
        fromUserId,
        totalDebit,
        "subtract",
        "main",
        trx
      );
      await Wallet.updateBalance(
        recipient.id,
        transferAmount,
        "add",
        "main",
        trx
      );

      // Sender transaction (debit)
      await trx("transactions").insert({
        user_id: fromUserId,
        wallet_type: "main",
        transaction_type: "transfer",
        amount: -transferAmount,
        fee,
        currency: "USD",
        status: "completed",
        description: note || `Transfer to ${recipient.phone_number}`,
        metadata: JSON.stringify({
          toUserId: recipient.id,
          toPhoneNumber: recipient.phone_number,
          note,
        }),
        created_at: timestamp,
        updated_at: timestamp,
      });

      // Recipient transaction (credit)
      await trx("transactions").insert({
        user_id: recipient.id,
        wallet_type: "main",
        transaction_type: "transfer",
        amount: transferAmount,
        fee: 0,
        currency: "USD",
        status: "completed",
        description:
          note || `Transfer from ${req.user.phoneNumber || fromUserId}`,
        metadata: JSON.stringify({
          fromUserId: fromUserId,
          fromPhoneNumber: req.user.phoneNumber,
          note,
        }),
        created_at: timestamp,
        updated_at: timestamp,
      });
    });

    logger.info("User transfer completed", {
      userId: fromUserId,
      toUserId: recipient.id,
      amount: transferAmount,
      fee,
      event: "wallet_transfer",
      meta: { type: "wallet" },
    });

    return res.status(200).json({
      status: "SUCCESS",
      message: "Transfer completed",
      data: {
        amount: transferAmount,
        fee,
        totalDebited: totalDebit,
        toUserId: recipient.id,
        toPhoneNumber: recipient.phone_number,
      },
    });
  } catch (error) {
    logger.error("Transfer error", {
      error: error.message,
      stack: error.stack,
      event: "wallet_transfer_error",
      meta: { type: "wallet" },
    });
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to process transfer",
    });
  }
};

// Handle deposit callback from NowPayment
const handleDepositCallback = async (req, res) => {
  try {
    const paymentData = req.body;

    // Validate IPN if signature is provided
    if (req.headers["x-nowpayments-sig"]) {
      const isValid = NowPaymentService.validateIPN(
        paymentData,
        req.headers["x-nowpayments-sig"]
      );
      if (!isValid) {
        return res
          .status(400)
          .json({ status: "ERROR", message: "Invalid signature" });
      }
    }

    const processedData = await NowPaymentService.processDepositCallback(
      paymentData
    );

    // Find transaction
    const transaction = await Transaction.findByReference(
      "nowpayment",
      processedData.order_id
    );
    if (!transaction) {
      return res
        .status(404)
        .json({ status: "ERROR", message: "Transaction not found" });
    }

    // Parse existing metadata
    let existingMetadata = {};
    try {
      if (typeof transaction.metadata === "string") {
        existingMetadata = JSON.parse(transaction.metadata || "{}");
      } else if (
        typeof transaction.metadata === "object" &&
        transaction.metadata !== null
      ) {
        existingMetadata = transaction.metadata;
      }
    } catch (error) {
      console.warn(
        "Failed to parse transaction metadata in deposit callback:",
        error
      );
      existingMetadata = {};
    }

    // Merge processed data with existing metadata
    const updatedMetadata = {
      ...existingMetadata,
      ...processedData,
      last_callback_at: new Date().toISOString(),
      callback_count: (existingMetadata.callback_count || 0) + 1,
    };

    // Update transaction based on status
    if (
      (processedData.status === "completed" ||
        processedData.status === "partially_paid") &&
      transaction.status !== "completed"
    ) {
      // Payment received - credit the wallet
      await db.transaction(async (trx) => {
        // Determine the USD amount to credit
        const expectedAmount = parseFloat(transaction.amount || 0);
        const creditAmount = parseFloat(
          processedData.price_amount || expectedAmount || 0
        );

        if (creditAmount > 0) {
          // Mark transaction as completed with credited amount
          updatedMetadata.credited_amount = creditAmount;
          updatedMetadata.credited_at = new Date().toISOString();
          updatedMetadata.payment_complete = true;

          await Transaction.updateStatus(
            transaction.id,
            "completed",
            updatedMetadata,
            trx
          );

          // Credit the main wallet
          await Wallet.updateBalance(
            transaction.user_id,
            creditAmount,
            "add",
            "main",
            trx
          );

          console.log(
            `IXFLIX Deposit ${
              transaction.id
            } completed: Credited $${creditAmount.toFixed(2)} USD`
          );
        } else {
          console.error(
            `IXFLIX Deposit ${transaction.id}: No valid amount to credit`
          );
          await Transaction.updateStatus(
            transaction.id,
            "failed",
            updatedMetadata,
            trx
          );
        }
      });
    } else if (processedData.status === "failed") {
      // Payment failed - update status
      await Transaction.updateStatus(transaction.id, "failed", updatedMetadata);
      console.log(`IXFLIX Deposit ${transaction.id} failed`);
    } else if (transaction.status === "completed") {
      // Transaction already completed - do not credit again
      await Transaction.update(transaction.id, { metadata: updatedMetadata });
      console.log(
        `IXFLIX Deposit ${transaction.id} already completed - callback ignored (no double credit)`
      );
    } else {
      // Other statuses - update status and metadata only
      await Transaction.updateStatus(
        transaction.id,
        processedData.status,
        updatedMetadata
      );
      console.log(
        `IXFLIX Deposit ${transaction.id} status updated to: ${processedData.status}`
      );
    }

    res.status(200).json({ status: "SUCCESS", message: "Callback processed" });
  } catch (error) {
    console.error("Deposit callback error:", error);
    res.status(500).json({
      status: "ERROR",
      message: "Internal server error",
    });
  }
};

// Get potential Power Pass-Up bonuses from pending downline rewards
const getPotentialPowerPassUp = async (req, res) => {
  try {
    const userId = req.user.id;
    const { calculatePotentialPowerPassUp } = require("../models/PowerPassUp");

    const potentialData = await calculatePotentialPowerPassUp(userId);

    res.json({
      status: "SUCCESS",
      data: {
        potentialBonuses: potentialData.potentialBonuses,
        pendingRewardsCount: potentialData.pendingRewards,
        bonusDetails: potentialData.bonusDetails,
        downlinePendingBreakdown: potentialData.downlinePendingBreakdown,
        message: `You have $${potentialData.potentialBonuses.toFixed(
          2
        )} in potential Power Pass-Up bonuses from ${
          potentialData.pendingRewards
        } pending downline rewards`,
      },
    });
  } catch (error) {
    logger.error("Error calculating potential Power Pass-Up:", error);
    res.status(500).json({
      status: "ERROR",
      message: "Failed to calculate potential Power Pass-Up bonuses",
    });
  }
};

// Get potential Power Pass-Up bonuses user will RECEIVE when claiming their own pending rewards
const getPotentialReceivedPowerPassUp = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      calculatePotentialReceivedPowerPassUp,
    } = require("../models/PowerPassUp");

    const receivedData = await calculatePotentialReceivedPowerPassUp(userId);

    res.json({
      status: "SUCCESS",
      data: {
        potentialReceivedBonuses: receivedData.potentialReceivedBonuses,
        pendingRewardsCount: receivedData.pendingRewardsCount,
        receivedDetails: receivedData.receivedDetails,
        message: `You will receive $${receivedData.potentialReceivedBonuses.toFixed(
          2
        )} in Power Pass-Up bonuses when you claim your ${
          receivedData.pendingRewardsCount
        } pending rewards`,
      },
    });
  } catch (error) {
    logger.error("Error calculating potential received Power Pass-Up:", error);
    res.status(500).json({
      status: "ERROR",
      message: "Failed to calculate potential received Power Pass-Up bonuses",
    });
  }
};

// Submit manual deposit
const submitManualDeposit = async (req, res) => {
  try {
    const userId = req.user.id;
    const { transaction_id, amount, network, deposit_address } = req.body;

    // Validate inputs
    if (!transaction_id || !transaction_id.trim()) {
      return res.status(400).json({
        status: "ERROR",
        message: "Transaction ID is required",
      });
    }

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({
        status: "ERROR",
        message: "Valid amount is required",
      });
    }

    const depositAmount = parseFloat(amount);

    // Minimum deposit amount
    if (depositAmount < 25) {
      return res.status(400).json({
        status: "ERROR",
        message: "Minimum deposit amount is $25 USD",
      });
    }

    // Check if transaction ID already exists
    const existingTx = await Transaction.findByReference(
      "manual_deposit",
      transaction_id.trim()
    );
    if (existingTx) {
      return res.status(400).json({
        status: "ERROR",
        message: "This transaction ID has already been submitted",
      });
    }

    // Get user info for metadata
    const user = await db("users")
      .where("id", userId)
      .select("name", "phone_number")
      .first();

    // Create transaction record with pending status
    const transaction = await Transaction.create({
      user_id: userId,
      wallet_type: "main",
      transaction_type: "deposit",
      reference_type: "manual_deposit",
      reference_id: transaction_id.trim(),
      amount: depositAmount,
      fee: 0,
      currency: "USD",
      status: "pending",
      description: `Manual Deposit - ${
        network || "USDT (BEP-20)"
      } - $${depositAmount.toFixed(2)}`,
      metadata: {
        transaction_id: transaction_id.trim(),
        network: network || "USDT (BEP-20)",
        deposit_address: deposit_address || "N/A",
        submitted_at: new Date().toISOString(),
        user_name: user?.name || "Unknown",
        user_phone: user?.phone_number || "N/A",
      },
    });

    res.status(200).json({
      status: "SUCCESS",
      message:
        "Manual deposit submitted successfully. Awaiting admin approval.",
      data: {
        transaction: transaction,
      },
    });
  } catch (error) {
    logger.error("Submit manual deposit error:", error);
    res.status(500).json({
      status: "ERROR",
      message: "Failed to submit manual deposit",
    });
  }
};

// Get pending manual deposits (Admin only)
const getPendingManualDeposits = async (req, res) => {
  try {
    const { page = 1, limit = 20, status = "pending" } = req.query;

    const offset = (page - 1) * limit;

    // Get pending manual deposits with user information
    const deposits = await db("transactions as t")
      .join("users as u", "t.user_id", "u.id")
      .where("t.reference_type", "manual_deposit")
      .where("t.status", status)
      .select(
        "t.*",
        "u.name as user_name",
        "u.phone_number as user_phone_number"
      )
      .orderBy("t.created_at", "desc")
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    // Get total count
    const totalResult = await db("transactions")
      .where("reference_type", "manual_deposit")
      .where("status", status)
      .count("id as count")
      .first();

    const totalCount = parseInt(totalResult.count);

    res.status(200).json({
      status: "SUCCESS",
      data: {
        deposits: deposits,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          total_pages: Math.ceil(totalCount / limit),
        },
      },
    });
  } catch (error) {
    logger.error("Get pending manual deposits error:", error);
    res.status(500).json({
      status: "ERROR",
      message: "Failed to fetch pending manual deposits",
    });
  }
};

// Approve or reject manual deposit (Admin only)
const processManualDeposit = async (req, res) => {
  try {
    const { transaction_id } = req.params;
    const { action, admin_note } = req.body; // action: 'approve' or 'reject'

    if (!action || !["approve", "reject"].includes(action)) {
      return res.status(400).json({
        status: "ERROR",
        message: 'Invalid action. Must be "approve" or "reject"',
      });
    }

    // Find transaction
    const transaction = await Transaction.findById(transaction_id);
    if (!transaction) {
      return res.status(404).json({
        status: "ERROR",
        message: "Transaction not found",
      });
    }

    if (transaction.reference_type !== "manual_deposit") {
      return res.status(400).json({
        status: "ERROR",
        message: "This is not a manual deposit transaction",
      });
    }

    if (transaction.status !== "pending") {
      return res.status(400).json({
        status: "ERROR",
        message: `Transaction has already been ${transaction.status}`,
      });
    }

    // Helper to safely parse metadata
    const parseMetadata = (metadata) => {
      if (!metadata) return {};
      if (typeof metadata === "object") return { ...metadata };
      try {
        return JSON.parse(metadata);
      } catch {
        return {};
      }
    };

    if (action === "approve") {
      // Use database transaction for atomicity
      await db.transaction(async (trx) => {
        // Update transaction status to completed
        const existingMetadata = parseMetadata(transaction.metadata);

        await Transaction.updateStatus(
          transaction.id,
          "completed",
          {
            ...existingMetadata,
            approved_at: new Date().toISOString(),
            approved_by: req.user.id,
            admin_note: admin_note || null,
          },
          trx
        );

        // Update wallet balance
        await Wallet.updateBalance(
          transaction.user_id,
          parseFloat(transaction.amount),
          "add",
          "main",
          trx
        );
      });

      res.status(200).json({
        status: "SUCCESS",
        message: "Manual deposit approved and wallet credited",
        data: {
          transaction_id: transaction_id,
          user_id: transaction.user_id,
          amount: transaction.amount,
        },
      });
    } else {
      // Reject the transaction
      const existingMetadata = parseMetadata(transaction.metadata);

      await Transaction.updateStatus(transaction.id, "rejected", {
        ...existingMetadata,
        rejected_at: new Date().toISOString(),
        rejected_by: req.user.id,
        admin_note: admin_note || null,
      });

      res.status(200).json({
        status: "SUCCESS",
        message: "Manual deposit rejected",
        data: {
          transaction_id: transaction_id,
        },
      });
    }
  } catch (error) {
    logger.error("Process manual deposit error:", error);
    res.status(500).json({
      status: "ERROR",
      message: "Failed to process manual deposit",
    });
  }
};

module.exports = {
  getBalance,
  getTransactionHistory,
  getTransactionStats,
  getIncentiveSummary,
  getWalletConfig,
  transferToUser,
  initiateDeposit,
  handleDepositCallback,
  initiateWithdraw,
  getPotentialPowerPassUp,
  getPotentialReceivedPowerPassUp,
  submitManualDeposit,
  getPendingManualDeposits,
  processManualDeposit,
};
