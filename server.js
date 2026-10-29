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

        -- Approximate home location from the device (rounded to about 1 km), used for distance between Hokies
        ALTER TABLE profiles ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
        ALTER TABLE profiles ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

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

// Approximate center of each D.C. area neighborhood, used to name a device location
// and as the location for users who pick a neighborhood instead of sharing their location
const NEIGHBORHOODS = [
    { name: 'Rosslyn', latitude: 38.8966, longitude: -77.0716 },
    { name: 'Clarendon', latitude: 38.8868, longitude: -77.0954 },
    { name: 'Ballston', latitude: 38.8823, longitude: -77.1110 },
    { name: 'Crystal City', latitude: 38.8574, longitude: -77.0510 },
    { name: 'Alexandria', latitude: 38.8048, longitude: -77.0469 },
    { name: 'Falls Church', latitude: 38.8823, longitude: -77.1711 },
    { name: 'Tysons', latitude: 38.9187, longitude: -77.2311 },
    { name: 'Vienna', latitude: 38.9012, longitude: -77.2653 },
    { name: 'Fairfax', latitude: 38.8462, longitude: -77.3064 },
    { name: 'Reston', latitude: 38.9586, longitude: -77.3570 },
    { name: 'Georgetown', latitude: 38.9097, longitude: -77.0654 },
    { name: 'Dupont Circle', latitude: 38.9096, longitude: -77.0434 },
    { name: 'Adams Morgan', latitude: 38.9215, longitude: -77.0422 },
    { name: 'Columbia Heights', latitude: 38.9286, longitude: -77.0325 },
    { name: 'Shaw', latitude: 38.9126, longitude: -77.0216 },
    { name: 'Capitol Hill', latitude: 38.8899, longitude: -76.9905 },
    { name: 'Navy Yard', latitude: 38.8764, longitude: -77.0030 },
    { name: 'Bethesda', latitude: 38.9807, longitude: -77.1003 },
    { name: 'Silver Spring', latitude: 38.9907, longitude: -77.0261 },
    { name: 'Rockville', latitude: 39.0840, longitude: -77.1528 }
];

// Locations farther than this from every neighborhood are labeled as outside the area
const MAX_NEIGHBORHOOD_MILES = 20;

// Straight line distance between two points on Earth in miles (haversine formula)
const distanceInMiles = (lat1, lon1, lat2, lon2) => {
    const toRadians = (degrees) => degrees * Math.PI / 180;
    const earthRadiusMiles = 3958.8;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * earthRadiusMiles * Math.asin(Math.sqrt(a));
};

const nearestNeighborhood = (latitude, longitude) => {
    let nearest = null;
    let nearestMiles = Infinity;
    for (const place of NEIGHBORHOODS) {
        const miles = distanceInMiles(latitude, longitude, place.latitude, place.longitude);
        if (miles < nearestMiles) {
            nearest = place;
            nearestMiles = miles;
        }
    }
    return nearestMiles <= MAX_NEIGHBORHOOD_MILES ? nearest.name : 'Outside the D.C. area';
};

// ===== Compatibility score =====
// Each part of a profile earns up to its weight in points, for a total out of 100.
// Shared interests and wellness preferences (preferred activities) count the most,
// distance is next, and graduation year counts the least.
const SCORE_WEIGHTS = {
    interests: 35,
    wellness: 30,
    distance: 25,
    gradYear: 10
};

// Distance score halves every this many miles: 0 mi = full points, 8 mi = half, 16 mi = a quarter
const DISTANCE_HALF_LIFE_MILES = 8;

// Class year score drops to zero at this many years apart
const MAX_GRAD_YEAR_GAP = 10;

// How much two lists overlap, from 0 (nothing shared) to 1 (identical).
// Uses cosine similarity, so sharing 2 of 3 interests scores higher than sharing 2 of 10
const overlap = (listA, listB) => {
    if (listA.length === 0 || listB.length === 0) return 0;
    const setB = new Set(listB);
    const shared = listA.filter((item) => setB.has(item)).length;
    return shared / Math.sqrt(listA.length * listB.length);
};

// viewer and other are { interests, wellnessPreferences, latitude, longitude, gradYear }.
// Missing information (or a section the other user hides) earns 0 points for that part.
// Returns the total score and the points earned by each part so the page can explain the match
const compatibilityScore = (viewer, other, distanceMiles) => {
    const parts = {
        interests: overlap(viewer.interests, other.interests),
        wellness: overlap(viewer.wellnessPreferences, other.wellnessPreferences),
        distance: distanceMiles === null ? 0 : 0.5 ** (distanceMiles / DISTANCE_HALF_LIFE_MILES),
        gradYear: (viewer.gradYear && other.gradYear)
            ? Math.max(0, 1 - Math.abs(viewer.gradYear - other.gradYear) / MAX_GRAD_YEAR_GAP)
            : 0
    };

    const breakdown = {};
    let total = 0;
    for (const part of Object.keys(SCORE_WEIGHTS)) {
        breakdown[part] = Math.round(parts[part] * SCORE_WEIGHTS[part]);
        total += parts[part] * SCORE_WEIGHTS[part];
    }
    return { score: Math.round(total), breakdown };
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
    neighborhoods: NEIGHBORHOODS.map((place) => place.name),
    visibility: ['hokies', 'only_me'],
    scoreWeights: SCORE_WEIGHTS
};

// Returns an error message if the profile is invalid, otherwise null
// Location is not part of this, it is saved separately through /api/profile/location
const validateProfile = ({displayName, gradYear, bio, wellnessPreferences, interests, visibility}) => {
    if (displayName && (typeof displayName !== 'string' || displayName.length > 100)) {
        return 'Display Name must be 100 characters or fewer';
    }
    // Virginia Tech was founded in 1872
    const maxGradYear = new Date().getFullYear() + 6;
    if (gradYear && (!Number.isInteger(gradYear) || gradYear < 1872 || gradYear > maxGradYear)) {
        return `Class Year must be between 1872 and ${maxGradYear}`;
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
            hasLocation: profile.latitude !== null && profile.latitude !== undefined,
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
    const {displayName, gradYear, bio, wellnessPreferences, interests, visibility} = req.body;

    const validationError = validateProfile(req.body);
    if (validationError) {
        return res.status(400).json({message: validationError});
    }

    // Profile, interests and wellness preferences are saved together so a failure never leaves half a profile
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `INSERT INTO profiles (user_id, display_name, grad_year, bio,
                                   neighborhood_visibility, interests_visibility, wellness_visibility, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT (user_id) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                grad_year = EXCLUDED.grad_year,
                bio = EXCLUDED.bio,
                neighborhood_visibility = EXCLUDED.neighborhood_visibility,
                interests_visibility = EXCLUDED.interests_visibility,
                wellness_visibility = EXCLUDED.wellness_visibility,
                updated_at = NOW()`,
            [req.userId, displayName || null, gradYear || null, bio || null,
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

// Set the logged in user's location, either from the device ({latitude, longitude})
// or by picking a neighborhood from the list ({neighborhood}) if they do not share their location
app.put('/api/profile/location', requireAuth, async (req, res) => {
    const {latitude, longitude, neighborhood} = req.body;
    let location;

    if (typeof latitude === 'number' && typeof longitude === 'number') {
        if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
            return res.status(400).json({message: 'Invalid Location'});
        }
        // Round to 2 decimal places (about 1 km) so an exact address is never stored
        const roundedLatitude = Math.round(latitude * 100) / 100;
        const roundedLongitude = Math.round(longitude * 100) / 100;
        location = {
            latitude: roundedLatitude,
            longitude: roundedLongitude,
            neighborhood: nearestNeighborhood(roundedLatitude, roundedLongitude)
        };
    } else {
        const place = NEIGHBORHOODS.find((n) => n.name === neighborhood);
        if (!place) {
            return res.status(400).json({message: 'Invalid Location'});
        }
        location = {latitude: place.latitude, longitude: place.longitude, neighborhood: place.name};
    }

    try {
        await pool.query(
            `INSERT INTO profiles (user_id, neighborhood, latitude, longitude, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (user_id) DO UPDATE SET
                neighborhood = EXCLUDED.neighborhood,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                updated_at = NOW()`,
            [req.userId, location.neighborhood, location.latitude, location.longitude]
        );
        return res.status(200).json({message: 'Location Saved', neighborhood: location.neighborhood});
    } catch (error) {
        return res.status(500).json({
            message: 'Internal Server Error'
        });
    }
});

app.delete('/api/profile/location', requireAuth, async (req, res) => {
    try {
        await pool.query(
            `UPDATE profiles SET neighborhood = NULL, latitude = NULL, longitude = NULL, updated_at = NOW()
             WHERE user_id = $1`,
            [req.userId]
        );
        return res.status(200).json({message: 'Location Removed'});
    } catch (error) {
        return res.status(500).json({
            message: 'Internal Server Error'
        });
    }
});

// Groups rows of {user_id, value} into a Map of user id -> list of values
const groupByUser = (rows, column) => {
    const byUser = new Map();
    for (const row of rows) {
        if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
        byUser.get(row.user_id).push(row[column]);
    }
    return byUser;
};

// Find other Hokies, sorted by compatibility with the logged in user
// Optional filters: ?maxDistance=<miles>&interest=<name>&wellness=<name>&gradYear=<year>
// Sections another user set to "Only me" are never shown, filtered on, or used in their score
app.get('/api/hokies', requireAuth, async (req, res) => {
    const maxDistance = Number(req.query.maxDistance) > 0 ? Number(req.query.maxDistance) : null;
    const interestFilter = PROFILE_OPTIONS.interests.includes(req.query.interest) ? req.query.interest : null;
    const wellnessFilter = PROFILE_OPTIONS.wellnessPreferences.includes(req.query.wellness) ? req.query.wellness : null;
    const gradYearFilter = Number.isInteger(Number(req.query.gradYear)) && Number(req.query.gradYear) > 0
        ? Number(req.query.gradYear) : null;

    try {
        const profileResult = await pool.query(
            `SELECT users.id, users.username, profiles.* FROM users
             JOIN profiles ON profiles.user_id = users.id`
        );
        const interestsByUser = groupByUser(
            (await pool.query('SELECT user_id, interest FROM user_interests')).rows, 'interest');
        const wellnessByUser = groupByUser(
            (await pool.query('SELECT user_id, preference FROM user_wellness_preferences')).rows, 'preference');

        // The viewer's own profile is always fully used, even the parts they hide from others
        const viewerRow = profileResult.rows.find((row) => row.id === req.userId) || {};
        const viewer = {
            interests: interestsByUser.get(req.userId) || [],
            wellnessPreferences: wellnessByUser.get(req.userId) || [],
            latitude: viewerRow.latitude ?? null,
            longitude: viewerRow.longitude ?? null,
            gradYear: viewerRow.grad_year || null
        };

        const hokies = [];
        for (const row of profileResult.rows) {
            if (row.id === req.userId) continue;

            // Only use what this user lets other Hokies see
            const showLocation = row.neighborhood_visibility === 'hokies';
            const other = {
                interests: row.interests_visibility === 'hokies' ? (interestsByUser.get(row.id) || []) : [],
                wellnessPreferences: row.wellness_visibility === 'hokies' ? (wellnessByUser.get(row.id) || []) : [],
                gradYear: row.grad_year || null
            };
            const distanceMiles = (showLocation && row.latitude !== null && viewer.latitude !== null)
                ? distanceInMiles(viewer.latitude, viewer.longitude, row.latitude, row.longitude)
                : null;

            if (maxDistance !== null && (distanceMiles === null || distanceMiles > maxDistance)) continue;
            if (interestFilter && !other.interests.includes(interestFilter)) continue;
            if (wellnessFilter && !other.wellnessPreferences.includes(wellnessFilter)) continue;
            if (gradYearFilter && other.gradYear !== gradYearFilter) continue;

            const {score, breakdown} = compatibilityScore(viewer, other, distanceMiles);
            hokies.push({
                username: row.username,
                displayName: row.display_name || row.username,
                gradYear: other.gradYear,
                bio: row.bio || '',
                neighborhood: showLocation ? (row.neighborhood || '') : '',
                distanceMiles: distanceMiles === null ? null : Math.round(distanceMiles * 10) / 10,
                interests: other.interests,
                sharedInterests: other.interests.filter((i) => viewer.interests.includes(i)),
                wellnessPreferences: other.wellnessPreferences,
                sharedWellness: other.wellnessPreferences.filter((p) => viewer.wellnessPreferences.includes(p)),
                score,
                breakdown
            });
        }

        // Best matches first, closest first when scores tie
        hokies.sort((a, b) => b.score - a.score || (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity));

        return res.status(200).json({
            // Lets the page suggest what to fill in for better matches
            viewer: {
                hasLocation: viewer.latitude !== null,
                hasInterests: viewer.interests.length > 0,
                hasWellness: viewer.wellnessPreferences.length > 0,
                hasGradYear: viewer.gradYear !== null
            },
            hokies: hokies.slice(0, 50)
        });
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