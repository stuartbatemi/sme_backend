// db.js — MySQL connection pool
// Using a POOL (not single connection) so 1000+ users can
// each get their own connection without waiting.

const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host:               process.env.DB_HOST,
    port:               parseInt(process.env.DB_PORT) || 3306,
    user:               process.env.DB_USER,
    password:           process.env.DB_PASSWORD,
    database:           process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit:    20,    // max 20 simultaneous DB connections
    queueLimit:         0,     // unlimited queue (requests wait if pool is full)
    timezone:           '+00:00',
    charset:            'utf8mb4',
});

// Test the connection on startup
pool.getConnection()
    .then(conn => {
        console.log('✅ MySQL connected successfully');
        conn.release();
    })
    .catch(err => {
        console.error('❌ MySQL connection failed:', err.message);
        process.exit(1);  // stop the server if DB is unreachable
    });

module.exports = pool;
