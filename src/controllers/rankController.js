const {
  ensureRankRow,
  evaluateUserRank,
  setUserRank,
  autoPromoteUser,
  autoPromoteAll,
  RANK_LADDER,
  getRankProgress,
} = require("../models/Rank");

const getMyRank = async (req, res) => {
  try {
    const userId = req.user.id;
    const row = await ensureRankRow(userId);
    res.status(200).json({ status: "SUCCESS", data: row });
  } catch (error) {
    console.error("Get my rank error:", error);
    res.status(500).json({ status: "ERROR", message: "Internal server error" });
  }
};

const adminGetUserRank = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ status: "ERROR", message: "Forbidden" });
    }
    const { user_id } = req.params;
    const row = await ensureRankRow(user_id);
    res.status(200).json({ status: "SUCCESS", data: row });
  } catch (error) {
    console.error("Admin get user rank error:", error);
    res.status(500).json({ status: "ERROR", message: "Internal server error" });
  }
};

const adminSetUserRank = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ status: "ERROR", message: "Forbidden" });
    }
    const { user_id } = req.params;
    const { rank, override_percent } = req.body;
    const updated = await setUserRank(user_id, rank, override_percent);
    res.status(200).json({ status: "SUCCESS", data: updated });
  } catch (error) {
    console.error("Admin set user rank error:", error);
    res.status(500).json({ status: "ERROR", message: "Internal server error" });
  }
};

const adminEvaluateUser = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ status: "ERROR", message: "Forbidden" });
    }
    const { user_id } = req.params;
    const result = await evaluateUserRank(user_id);
    res.status(200).json({ status: "SUCCESS", data: result });
  } catch (error) {
    console.error("Admin eval rank error:", error);
    res.status(500).json({ status: "ERROR", message: "Internal server error" });
  }
};

const adminAutoPromoteUser = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ status: "ERROR", message: "Forbidden" });
    }
    const { user_id } = req.params;
    const result = await autoPromoteUser(user_id);
    res.status(200).json({ status: "SUCCESS", data: result });
  } catch (error) {
    console.error("Admin auto promote error:", error);
    res.status(500).json({ status: "ERROR", message: "Internal server error" });
  }
};

const adminAutoPromoteAll = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ status: "ERROR", message: "Forbidden" });
    }
    const result = await autoPromoteAll();
    res.status(200).json({
      status: "SUCCESS",
      message: `Processed ${result.users}, promoted ${result.promoted}`,
      data: result,
    });
  } catch (error) {
    console.error("Admin auto promote all error:", error);
    res.status(500).json({ status: "ERROR", message: "Internal server error" });
  }
};

const getRankLadder = async (_req, res) => {
  res.status(200).json({ status: "SUCCESS", data: RANK_LADDER });
};

// Progress toward next rank
const getMyRankProgress = async (req, res) => {
  try {
    const userId = req.user.id;
    const progress = await getRankProgress(userId);
    res.status(200).json({ status: "SUCCESS", data: progress });
  } catch (error) {
    console.error("Get rank progress error:", error);
    res.status(500).json({ status: "ERROR", message: "Internal server error" });
  }
};

module.exports = {
  getMyRank,
  adminGetUserRank,
  adminSetUserRank,
  adminEvaluateUser,
  adminAutoPromoteUser,
  adminAutoPromoteAll,
  getRankLadder,
  getMyRankProgress,
};
