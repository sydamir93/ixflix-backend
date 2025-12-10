const db = require('../config/database');

class JobRun {
  static async start(jobName, runDate = new Date(), meta = {}) {
    const dateStr = typeof runDate === 'string' ? runDate : runDate.toISOString().split('T')[0];
    try {
      const insertRes = await db('job_runs').insert({
        job_name: jobName,
        run_date: dateStr,
        status: 'running',
        meta: JSON.stringify(meta),
        started_at: db.fn.now()
      });

      // MySQL does not support returning(); fetch the row explicitly
      if (Array.isArray(insertRes) && insertRes.length > 0) {
        const id = insertRes[0];
        const row = await db('job_runs').where({ id }).first();
        if (row) return row;
      }

      return await db('job_runs').where({ job_name: jobName, run_date: dateStr }).first();
    } catch (err) {
      const existing = await db('job_runs').where({ job_name: jobName, run_date: dateStr }).first();
      return existing;
    }
  }

  static async finish(jobName, runDate = new Date(), status = 'success', meta = {}) {
    const dateStr = typeof runDate === 'string' ? runDate : runDate.toISOString().split('T')[0];
    await db('job_runs')
      .where({ job_name: jobName, run_date: dateStr })
      .update({
        status,
        meta: JSON.stringify(meta),
        finished_at: db.fn.now()
      });

    return db('job_runs').where({ job_name: jobName, run_date: dateStr }).first();
  }

  static async getStatus(jobName) {
    return db('job_runs')
      .where({ job_name: jobName })
      .orderBy('run_date', 'desc')
      .first();
  }

  static async getAllStatuses(limit = 50) {
    return db('job_runs')
      .orderBy('run_date', 'desc')
      .limit(limit);
  }
}

module.exports = JobRun;

