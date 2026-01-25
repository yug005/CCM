const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const DB_URL = process.env.DATABASE_URL || '';
const USE_DB = !!DB_URL;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const SALT_ROUNDS = 10;

// File-backed fallback
const DB_PATH = path.join(__dirname, 'users.json');
function loadUsersFile() {
  try {
    if (!fs.existsSync(DB_PATH)) return {};
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (e) {
    return {};
  }
}
function saveUsersFile(users) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

// Postgres pool (optional)
let pool = null;
let ensureTablePromise = null;
if (USE_DB) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: DB_URL });
  ensureTablePromise = pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY,
      username text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      matches_played integer NOT NULL DEFAULT 0,
      wins integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `).catch(err => {
    console.error('Failed to ensure users table:', err.message || err);
  });
}

function issueToken(user) {
  const payload = { sub: user.id, username: user.username };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

async function findUserByUsername(username) {
  if (!username) return null;
  if (USE_DB) {
    await ensureTablePromise;
    const res = await pool.query('SELECT id, username, password_hash, matches_played, wins, created_at FROM users WHERE lower(username)=lower($1) LIMIT 1', [username]);
    return res.rows[0] || null;
  }
  const users = loadUsersFile();
  return Object.values(users).find(u => u.username.toLowerCase() === String(username).toLowerCase()) || null;
}

async function createUser(username, password) {
  username = String(username || '').trim();
  if (!username || !password) throw new Error('missing_fields');
  const existing = await findUserByUsername(username);
  if (existing) throw new Error('username_taken');
  const id = `u_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const hash = bcrypt.hashSync(password, SALT_ROUNDS);
  if (USE_DB) {
    await ensureTablePromise;
    await pool.query('INSERT INTO users (id, username, password_hash, matches_played, wins) VALUES ($1,$2,$3,0,0)', [id, username, hash]);
    return { id, username, password_hash: hash, matches_played: 0, wins: 0, created_at: new Date().toISOString() };
  }
  const users = loadUsersFile();
  users[id] = { id, username, password_hash: hash, matches_played: 0, wins: 0, created_at: new Date().toISOString() };
  saveUsersFile(users);
  return users[id];
}

async function verifyPassword(user, password) {
  if (!user || !password) return false;
  if (typeof user.password_hash === 'string') {
    return bcrypt.compareSync(String(password), user.password_hash);
  }
  return false;
}

async function getUserById(id) {
  if (!id) return null;
  if (USE_DB) {
    await ensureTablePromise;
    const res = await pool.query('SELECT id, username, password_hash, matches_played, wins, created_at FROM users WHERE id=$1 LIMIT 1', [id]);
    return res.rows[0] || null;
  }
  const users = loadUsersFile();
  return users[id] || null;
}

async function incrementStats(userId, { wins = 0, matches = 0 } = {}) {
  if (!userId) return false;
  if (USE_DB) {
    await ensureTablePromise;
    await pool.query('UPDATE users SET wins = wins + $1, matches_played = matches_played + $2 WHERE id = $3', [wins || 0, matches || 0, userId]);
    return true;
  }
  const users = loadUsersFile();
  const user = users[userId];
  if (!user) return false;
  user.wins = (user.wins || 0) + (wins || 0);
  user.matches_played = (user.matches_played || 0) + (matches || 0);
  saveUsersFile(users);
  return true;
}

module.exports = {
  findUserByUsername,
  createUser,
  verifyPassword,
  issueToken,
  verifyToken,
  getUserById,
  incrementStats
};
