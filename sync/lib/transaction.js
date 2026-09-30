'use strict';

async function withTransaction(pool, work, hooks = {}) {
  if (!pool) throw new Error('A MySQL pool is required for transactional work.');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    if (hooks.onCommit) await hooks.onCommit(result);
    return result;
  } catch (error) {
    try { await conn.rollback(); } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    if (hooks.onRollback) await hooks.onRollback(error);
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = { withTransaction };
