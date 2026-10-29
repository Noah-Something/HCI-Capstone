// Backend for the server, holds and manages passwords and other data
const express = require('express');
const bcrypt = require('bcrypt'); // Encrypt Usernames and Passwords using rounds of bcrypt
const crypto = require('crypto'); // Create token upon logging in
const cors = require('cors');
const { Pool } = require('pg'); // Postgres client for the HokieConnect database
const path = require('path');

const app = express();

// Connection string is provided by Render (see render.yaml), or set manually for local development
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000 // Fail instead of hanging if the database is unreachable
});

// Create all tables on startup if they do not already exist
// Order matters: tables must be created after the tables they reference
const initDatabase = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            hashed_password TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS groups (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) UNIQUE NOT NULL,
            description TEXT,
            creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        -- An event can optionally belong to a group, it stays if the group is deleted
        CREATE TABLE IF NOT EXISTS events (
            id SERIAL PRIMARY KEY,
            title VARCHAR(150) NOT NULL,
            description TEXT,
            location VARCHAR(255),
            latitude DOUBLE PRECISION,  -- Coordinates for the Google Maps pin
            longitude DOUBLE PRECISION,
            starts_at TIMESTAMPTZ NOT NULL,
            ends_at TIMESTAMPTZ,
            creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CHECK (ends_at IS NULL OR ends_at >= starts_at)
        );

        -- Link table: which users are in which groups
        CREATE TABLE IF NOT EXISTS group_members (
            group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
            joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (group_id, user_id)
        );

        -- Link table: which users have RSVP'd to which events
        CREATE TABLE IF NOT EXISTS event_attendees (
            event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status VARCHAR(20) NOT NULL DEFAULT 'going' CHECK (status IN ('going', 'interested')),
            responded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (event_id, user_id)
        );

        -- Speed up lookups like "all groups/events for this user"
        CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
        CREATE INDEX IF NOT EXISTS idx_event_attendees_user ON event_attendees(user_id);
        CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events(starts_at);
    `);
};

app.use(express.json());

// Serve the website (Frontend/index.html is the sign in page at "/")
app.use(express.static(path.join(__dirname, 'Frontend')));

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