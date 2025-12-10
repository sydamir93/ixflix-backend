const JobRun = require('../models/JobRun');

const listJobStatuses = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ status: 'ERROR', message: 'Forbidden' });
    }
    const jobs = await JobRun.getAllStatuses(100);
    res.status(200).json({ status: 'SUCCESS', data: jobs });
  } catch (error) {
    console.error('List job statuses error:', error);
    res.status(500).json({ status: 'ERROR', message: 'Internal server error' });
  }
};

const getJobStatus = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ status: 'ERROR', message: 'Forbidden' });
    }
    const { job_name } = req.params;
    const job = await JobRun.getStatus(job_name);
    if (!job) {
      return res.status(404).json({ status: 'ERROR', message: 'Not found' });
    }
    res.status(200).json({ status: 'SUCCESS', data: job });
  } catch (error) {
    console.error('Get job status error:', error);
    res.status(500).json({ status: 'ERROR', message: 'Internal server error' });
  }
};

module.exports = {
  listJobStatuses,
  getJobStatus
};

