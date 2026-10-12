import session from 'express-session';

export class MySqlSessionStore extends session.Store {
  constructor(pool) { super(); this.pool = pool; }
  get(id, callback) {
    this.pool.execute('SELECT data FROM web_sessions WHERE session_id=? AND expires_at>UTC_TIMESTAMP()', [id])
      .then(([[row]]) => callback(null, row ? (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) : null), callback);
  }
  set(id, value, callback = () => {}) {
    const expires = value.cookie?.expires ? new Date(value.cookie.expires) : new Date(Date.now() + 7 * 86400_000);
    this.pool.execute(`INSERT INTO web_sessions (session_id, expires_at, data) VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE expires_at=VALUES(expires_at), data=VALUES(data)`,
      [id, expires.toISOString().slice(0, 19).replace('T', ' '), JSON.stringify(value)])
      .then(() => callback(), callback);
  }
  destroy(id, callback = () => {}) {
    this.pool.execute('DELETE FROM web_sessions WHERE session_id=?', [id]).then(() => callback(), callback);
  }
  touch(id, value, callback = () => {}) {
    const expires = value.cookie?.expires ? new Date(value.cookie.expires) : new Date(Date.now() + 7 * 86400_000);
    this.pool.execute('UPDATE web_sessions SET expires_at=? WHERE session_id=?',
      [expires.toISOString().slice(0, 19).replace('T', ' '), id]).then(() => callback(), callback);
  }
}
