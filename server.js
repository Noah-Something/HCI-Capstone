// Backend for the server, holds and manages passwords and other data
const express = require('express');
const bcrypt = require('bcrypt'); // Encrypt Usernames and Passwords using rounds of bcrypt
const crypto = require('crypto'); // Create token upon logging in
const cors = require('cors');
const { Pool } = require('pg'); // Postgres client for the user database

const app = express();

// Connection string is provided by Render (see render.yaml), or set manually for local development
const pool = new Pool({
    connectionString: process.env.USER_DATABASE_URL,
    connectionTimeoutMillis: 5000 // Fail instead of hanging if the database is unreachable
});

// Create the users table on startup if it does not already exist
const initDatabase = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            hashed_password TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
};

app.use(express.json());

app.use(cors({
    origin: 'http://127.0.0.1:5500',
    methods: ['POST'],
    allowedHeaders: ['Content-Type']
}))

// Look up a user by username, returns null if not found
const findUserInDatabase = async (username) => {
    const result = await pool.query(
        'SELECT username, hashed_password FROM users WHERE username = $1',
        [username]
    );
    if (result.rows.length === 0) {
        return null;
    }
    return {
        username: result.rows[0].username,
        hashedPassword: result.rows[0].hashed_password
    };
};

app.post('/api/register', async (req, res) => {
    const {username, password} = req.body;

    if (!username || !password) {
        return res.status(400).json({
            message: 'Username and Password are required'
        });
    }

    try {
        // Hash password with 12 rounds of bcrypt before storing
        const hashedPassword = await bcrypt.hash(password, 12);
        await pool.query(
            'INSERT INTO users (username, hashed_password) VALUES ($1, $2)',
            [username, hashedPassword]
        );
        return res.status(201).json({message: 'Account Created'});

    } catch (error) {
        // 23505 is Postgres' unique violation code, meaning the username is taken
        if (error.code === '23505') {
            return res.status(409).json({
                message: 'Username already exists'
            });
        }
        return res.status(500).json({
            message: 'Internal Server Error'
        });
    }
});

app.post('/api/login', async (req, res) => {
    const {username, password} = req.body;

    try {
        // Determine whether user exists
        const user = await findUserInDatabase(username);
        if (!user) {
            return res.status(401).json({
                message: 'Invalid Username or Password'
            });
        }

        // Compare plain-text password with stored hash
        const isMatching = await bcrypt.compare(password, user.hashedPassword);
        if (!isMatching) {
            return res.status(401).json({ 
                message: 'Invalid Username or Password'
            });
        }

        // Issue a token upon success
        const token = crypto.randomBytes(32).toString('hex');
        return res.status(200).json({message: 'Success', token: token})

    } catch (error) {
        return res.status(500).json({
            message: 'Internal Server Error'
        });
    }
});

// Render assigns the port through PORT, default to 3000 locally
const PORT = process.env.PORT || 3000;

initDatabase()
    .then(() => {
        app.listen(PORT, () => console.log(`Authentication server running on port ${PORT}`));
    })
    .catch((error) => {
        console.error('Failed to initialize database:', error);
        process.exit(1);
    });