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

        -- Logged in sessions, only a SHA-256 hash of the token is stored
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash CHAR(64) PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL
        );

        -- One profile per user, each visibility column controls who can see that section
        CREATE TABLE IF NOT EXISTS profiles (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            display_name VARCHAR(100),
            grad_year SMALLINT,
            neighborhood VARCHAR(100),
            bio TEXT,
            neighborhood_visibility VARCHAR(20) NOT NULL DEFAULT 'hokies' CHECK (neighborhood_visibility IN ('hokies', 'only_me')),
            interests_visibility VARCHAR(20) NOT NULL DEFAULT 'hokies' CHECK (interests_visibility IN ('hokies', 'only_me')),
            wellness_visibility VARCHAR(20) NOT NULL DEFAULT 'hokies' CHECK (wellness_visibility IN ('hokies', 'only_me')),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        -- Link table: a user can pick many interests (allowed values are in PROFILE_OPTIONS)
        CREATE TABLE IF NOT EXISTS user_interests (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            interest VARCHAR(50) NOT NULL,
            PRIMARY KEY (user_id, interest)
        );

        -- Link table: a user can pick many wellness preferences (allowed values are in PROFILE_OPTIONS)
        CREATE TABLE IF NOT EXISTS user_wellness_preferences (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            preference VARCHAR(50) NOT NULL,
            PRIMARY KEY (user_id, preference)
        );

        -- Wellness used to be a single goal stored on the profile, now replaced by user_wellness_preferences
        ALTER TABLE profiles DROP COLUMN IF EXISTS wellness_goal;

        -- Speed up lookups like "all groups/events for this user"
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_interests_interest ON user_interests(interest);
        CREATE INDEX IF NOT EXISTS idx_user_wellness_preference ON user_wellness_preferences(preference);
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

// Sessions last 7 days before the user has to sign in again
const SESSION_LENGTH_MS = 7 * 24 * 60 * 60 * 1000;

// Tokens are hashed before storing so a leaked database cannot be used to log in
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Only allows the request through if it has a valid "Authorization: Bearer <token>" header
// Sets req.userId, req.username and req.tokenHash for the route to use
const requireAuth = async (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
        return res.status(401).json({message: 'Not Logged In'});
    }

    try {
        const tokenHash = hashToken(token);
        const result = await pool.query(
            `SELECT users.id, users.username FROM sessions
             JOIN users ON users.id = sessions.user_id
             WHERE sessions.token_hash = $1 AND sessions.expires_at > NOW()`,
            [tokenHash]
        );
        if (result.rows.length === 0) {
            return res.status(401).json({message: 'Session Expired, Please Sign In Again'});
        }
        req.userId = result.rows[0].id;
        req.username = result.rows[0].username;
        req.tokenHash = tokenHash;
        next();
    } catch (error) {
        return res.status(500).json({
            message: 'Internal Server Error'
        });
    }
};

// Allowed choices for the profile page, edit these lists to add or remove options
const PROFILE_OPTIONS = {
    interests: [
        'Running', 'Yoga', 'Social', 'Hiking', 'Cycling', 'Gym & Fitness',
        'Game Days', 'Food & Drink', 'Volunteering', 'Arts & Music', 'Board Games'
    ],
    wellnessPreferences: [
        'Mind-body movement', 'Cardio and Endurance', 'Mindfulness and Relaxation',
        'Brain Stimulation', 'Digital Detox', 'Mindful Eating',
        'Meeting new people', 'Group Connection'
    ],
    neighborhoods: [
        'Arlington', 'Clarendon', 'Alexandria', 'Capitol Hill', 'Navy Yard', 'Dupont Circle',
        'Georgetown', 'Bethesda', 'Silver Spring', 'Falls Church', 'Tysons', 'Reston'
    ],
    visibility: ['hokies', 'only_me']
};

// Returns an error message if the profile is invalid, otherwise null
const validateProfile = ({displayName, gradYear, neighborhood, bio, wellnessPreferences, interests, visibility}) => {
    if (displayName && (typeof displayName !== 'string' || displayName.length > 100)) {
        return 'Display Name must be 100 characters or fewer';
    }
    // Virginia Tech was founded in 1872
    const maxGradYear = new Date().getFullYear() + 6;
    if (gradYear && (!Number.isInteger(gradYear) || gradYear < 1872 || gradYear > maxGradYear)) {
        return `Class Year must be between 1872 and ${maxGradYear}`;
    }
    // Neighborhood list is only suggestions, any short text is allowed
    if (neighborhood && (typeof neighborhood !== 'string' || neighborhood.length > 100)) {
        return 'Neighborhood must be 100 characters or fewer';
    }
    if (bio && (typeof bio !== 'string' || bio.length > 500)) {
        return 'Bio must be 500 characters or fewer';
    }
    if (!Array.isArray(interests) || !interests.every((i) => PROFILE_OPTIONS.interests.includes(i))) {
        return 'Invalid Interests';
    }
    if (!Array.isArray(wellnessPreferences) ||
        !wellnessPreferences.every((p) => PROFILE_OPTIONS.wellnessPreferences.includes(p))) {
        return 'Invalid Wellness Preferences';
    }
    if (!visibility || !['neighborhood', 'interests', 'wellness'].every(
        (section) => PROFILE_OPTIONS.visibility.includes(visibility[section]))) {
        return 'Invalid Visibility Settings';
    }
    return null;
};

// Look up a user by username, returns null if not found
const findUserInDatabase = async (username) => {
    const result = await pool.query(
        'SELECT id, username, hashed_password FROM users WHERE username = $1',
        [username]
    );
    if (result.rows.length === 0) {
        return null;
    }
    return {
        id: result.rows[0].id,
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

    // Match the users table limit and the signup form
    if (username.length > 50) {
        return res.status(400).json({
            message: 'Username must be 50 characters or fewer'
        });
    }
    if (password.length < 8) {
        return res.status(400).json({
            message: 'Password must be at least 8 characters'
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

        // Issue a token upon success and remember it as a session
        const token = crypto.randomBytes(32).toString('hex');
        await pool.query(
            'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
            [hashToken(token), user.id, new Date(Date.now() + SESSION_LENGTH_MS)]
        );
        return res.status(200).json({message: 'Success', token: token})

    } catch (error) {
        return res.status(500).json({
            message: 'Internal Server Error'
        });
    }
});

app.post('/api/logout', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM sessions WHERE token_hash = $1', [req.tokenHash]);
        return res.status(200).json({message: 'Logged out'});
    } catch (error) {
        return res.status(500).json({
            message: 'Internal Server Error'
        });
    }
});

// Choices shown on the profile page, the server only accepts these values
app.get('/api/profile/options', (req, res) => {
    return res.status(200).json(PROFILE_OPTIONS);
});

// Get the logged in user's own profile, empty fields if they have not filled it out yet
app.get('/api/profile', requireAuth, async (req, res) => {
    try {
        const profileResult = await pool.query(
            'SELECT * FROM profiles WHERE user_id = $1',
            [req.userId]
        );
        const interestResult = await pool.query(
            'SELECT interest FROM user_interests WHERE user_id = $1 ORDER BY interest',
            [req.userId]
        );
        const wellnessResult = await pool.query(
            'SELECT preference FROM user_wellness_preferences WHERE user_id = $1 ORDER BY preference',
            [req.userId]
        );
        const profile = profileResult.rows[0] || {};

        return res.status(200).json({
            username: req.username,
            displayName: profile.display_name || '',
            gradYear: profile.grad_year || null,
            neighborhood: profile.neighborhood || '',
            bio: profile.bio || '',
            interests: interestResult.rows.map((row) => row.interest),
            wellnessPreferences: wellnessResult.rows.map((row) => row.preference),
            visibility: {
                neighborhood: profile.neighborhood_visibility || 'hokies',
                interests: profile.interests_visibility || 'hokies',
                wellness: profile.wellness_visibility || 'hokies'
            }
        });
    } catch (error) {
        return res.status(500).json({
            message: 'Internal Server Error'
        });
    }
});

// Create or replace the logged in user's profile
app.put('/api/profile', requireAuth, async (req, res) => {
    const {displayName, gradYear, neighborhood, bio, wellnessPreferences, interests, visibility} = req.body;

    const validationError = validateProfile(req.body);
    if (validationError) {
        return res.status(400).json({message: validationError});
    }

    // Profile, interests and wellness preferences are saved together so a failure never leaves half a profile
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `INSERT INTO profiles (user_id, display_name, grad_year, neighborhood, bio,
                                   neighborhood_visibility, interests_visibility, wellness_visibility, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
             ON CONFLICT (user_id) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                grad_year = EXCLUDED.grad_year,
                neighborhood = EXCLUDED.neighborhood,
                bio = EXCLUDED.bio,
                neighborhood_visibility = EXCLUDED.neighborhood_visibility,
                interests_visibility = EXCLUDED.interests_visibility,
                wellness_visibility = EXCLUDED.wellness_visibility,
                updated_at = NOW()`,
            [req.userId, displayName || null, gradYear || null, neighborhood || null, bio || null,
             visibility.neighborhood, visibility.interests, visibility.wellness]
        );
        await client.query('DELETE FROM user_interests WHERE user_id = $1', [req.userId]);
        for (const interest of new Set(interests)) {
            await client.query(
                'INSERT INTO user_interests (user_id, interest) VALUES ($1, $2)',
                [req.userId, interest]
            );
        }
        await client.query('DELETE FROM user_wellness_preferences WHERE user_id = $1', [req.userId]);
        for (const preference of new Set(wellnessPreferences)) {
            await client.query(
                'INSERT INTO user_wellness_preferences (user_id, preference) VALUES ($1, $2)',
                [req.userId, preference]
            );
        }
        await client.query('COMMIT');
        return res.status(200).json({message: 'Profile Saved'});

    } catch (error) {
        await client.query('ROLLBACK');
        return res.status(500).json({
            message: 'Internal Server Error'
        });
    } finally {
        client.release();
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