const Synergy = require('../models/Synergy');
const { authenticate } = require('../middleware/auth');

// Get current user's synergy summary
const getSynergySummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const summary = await Synergy.getUserSummary(userId);

    res.status(200).json({
      status: 'SUCCESS',
      data: summary
    });
  } catch (error) {
    console.error('Get synergy summary error:', error);
    res.status(500).json({ status: 'ERROR', message: 'Internal server error' });
  }
};

// Get synergy history for current user
const getSynergyHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const history = await Synergy.getUserHistory(userId, { limit: parseInt(limit), offset: parseInt(offset) });

    res.status(200).json({
      status: 'SUCCESS',
      data: {
        history,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: history.length,
          total_pages: Math.ceil(history.length / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get synergy history error:', error);
    res.status(500).json({ status: 'ERROR', message: 'Internal server error' });
  }
};

// Admin: get synergy history for all users (lightweight paged)
const getSynergyHistoryAll = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ status: 'ERROR', message: 'Forbidden' });
    }
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const rows = await Synergy.getAllHistory({ limit: parseInt(limit), offset: parseInt(offset) });

    res.status(200).json({
      status: 'SUCCESS',
      data: {
        history: rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: rows.length,
          total_pages: Math.ceil(rows.length / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get all synergy history error:', error);
    res.status(500).json({ status: 'ERROR', message: 'Internal server error' });
  }
};

// Run daily synergy payouts (admin only)
const runSynergyPayouts = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ status: 'ERROR', message: 'Forbidden' });
    }

    const result = await Synergy.processAllUsers();

    res.status(200).json({
      status: 'SUCCESS',
      message: result.skipped
        ? 'Synergy already ran today'
        : `Processed ${result.users} users, paid ${result.cycles} cycles`,
      data: result
    });
  } catch (error) {
    console.error('Run synergy payouts error:', error);
    res.status(500).json({ status: 'ERROR', message: 'Internal server error' });
  }
};

module.exports = {
  getSynergySummary,
  getSynergyHistory,
  getSynergyHistoryAll,
  runSynergyPayouts
};

