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

        -- Social links: one row per platform the user filled in (handles, see SOCIAL_PLATFORMS)
        CREATE TABLE IF NOT EXISTS user_social_links (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            platform VARCHAR(20) NOT NULL,
            value VARCHAR(200) NOT NULL,
            PRIMARY KEY (user_id, platform)
        );
        ALTER TABLE profiles ADD COLUMN IF NOT EXISTS social_visibility VARCHAR(20) NOT NULL DEFAULT 'hokies'
            CHECK (social_visibility IN ('hokies', 'only_me'));

        -- Direct messages between two users, read_at stays NULL until the recipient opens the conversation
        CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            read_at TIMESTAMPTZ,
            CHECK (sender_id <> recipient_id)
        );
        -- Extra event details for the Discover page (category matches the interest list, tip is for first-timers)
        ALTER TABLE events ADD COLUMN IF NOT EXISTS category VARCHAR(50);
        ALTER TABLE events ADD COLUMN IF NOT EXISTS newcomer_tip TEXT;

        -- Link table: short tags on an event (lowercase, see normalizeTag)
        CREATE TABLE IF NOT EXISTS event_tags (
            event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
            tag VARCHAR(30) NOT NULL,
            PRIMARY KEY (event_id, tag)
        );
        -- Tags used to be limited to 25 characters, too short for "mindfulness and relaxation"
        ALTER TABLE event_tags ALTER COLUMN tag TYPE VARCHAR(30);

        -- One optional image per event, stored in the database because Render's disk is wiped on every deploy
        CREATE TABLE IF NOT EXISTS event_images (
            event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
            content_type VARCHAR(20) NOT NULL,
            data BYTEA NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_event_tags_tag ON event_tags(tag);

        -- Speed up lookups like "all groups/events for this user"
        CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id, recipient_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id, sender_id, created_at);
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

// ===== Social links =====
// Users can type a handle ("@jane.doe") or paste a profile link, both are saved as just the handle.
// Links shown to other Hokies are always built from the handle here, never from what the user typed,
// so a saved link can only ever point at the platform it belongs to.
//   hosts:   sites a pasted link may come from (www. and m. are allowed in front)
//   pattern: what a valid handle looks like on that platform
//   toUrl:   builds the profile link, null when the platform has no public profile links (Discord)
const SOCIAL_PLATFORMS = [
    {
        id: 'linkedin', label: 'LinkedIn', placeholder: 'linkedin.com/in/your-name',
        hosts: ['linkedin.com'],
        // A profile link looks like linkedin.com/in/<name>
        handleFromPath: (parts) => (parts[0] === 'in' ? parts[1] : null),
        pattern: /^[a-z0-9-]{3,100}$/,
        toUrl: (handle) => `https://www.linkedin.com/in/${handle}`
    },
    {
        id: 'instagram', label: 'Instagram', placeholder: '@your.handle',
        hosts: ['instagram.com'],
        handleFromPath: (parts) => parts[0],
        pattern: /^[a-z0-9._]{1,30}$/,
        toUrl: (handle) => `https://www.instagram.com/${handle}`
    },
    {
        id: 'github', label: 'GitHub', placeholder: 'your-username',
        hosts: ['github.com'],
        handleFromPath: (parts) => parts[0],
        pattern: /^[a-z0-9][a-z0-9-]{0,38}$/,
        toUrl: (handle) => `https://github.com/${handle}`
    },
    {
        id: 'x', label: 'X', placeholder: '@yourhandle',
        hosts: ['x.com', 'twitter.com'],
        handleFromPath: (parts) => parts[0],
        pattern: /^[a-z0-9_]{1,15}$/,
        toUrl: (handle) => `https://x.com/${handle}`
    },
    {
        // Discord profile links need a numeric user id people don't know, so only the username is shown
        id: 'discord', label: 'Discord', placeholder: 'your.username',
        hosts: [],
        handleFromPath: () => null,
        pattern: /^[a-z0-9._]{2,32}$/,
        toUrl: () => null
    },
    {
        // A personal website is saved as the whole link, and must use https
        id: 'website', label: 'Website', placeholder: 'https://your-site.com',
        isWebsite: true,
        toUrl: (link) => link
    }
];

const MAX_WEBSITE_LENGTH = 200;

// Turns what the user typed into the handle (or website link) to save, or null if it is not valid
const parseSocialLink = (platform, input) => {
    const text = input.trim();

    if (platform.isWebsite) {
        try {
            // "my-site.com" is fine, it gets https:// added. Only https links are allowed
            const url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
            const valid = url.protocol === 'https:' && url.hostname.includes('.') &&
                !url.username && !url.password && url.href.length <= MAX_WEBSITE_LENGTH;
            return valid ? url.href : null;
        } catch (error) {
            return null;
        }
    }

    // A pasted link: it must be from this platform's site, then the handle is taken from its path
    const lower = text.toLowerCase();
    const looksLikeLink = /^https?:\/\//.test(lower) ||
        platform.hosts.some((host) => [host, `www.${host}`, `m.${host}`].some((prefix) => lower.startsWith(`${prefix}/`)));
    let handle;
    if (looksLikeLink) {
        try {
            const url = new URL(/^https?:\/\//.test(lower) ? text : `https://${text}`);
            const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
            if (!platform.hosts.includes(host)) return null;
            handle = platform.handleFromPath(url.pathname.split('/').filter(Boolean).map(decodeURIComponent));
        } catch (error) {
            return null;
        }
    } else {
        handle = text.replace(/^@/, '');
    }
    handle = (handle || '').toLowerCase();
    return platform.pattern.test(handle) ? handle : null;
};

// Rows of {platform, value} -> the list shown to other Hokies, in SOCIAL_PLATFORMS order
const formatSocialLinks = (rows) => SOCIAL_PLATFORMS
    .map((platform) => {
        const row = rows.find((r) => r.platform === platform.id);
        if (!row) return null;
        return { platform: platform.id, label: platform.label, handle: row.value, url: platform.toUrl(row.value) };
    })
    .filter(Boolean);

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
    scoreWeights: SCORE_WEIGHTS,
    socialPlatforms: SOCIAL_PLATFORMS.map(({id, label, placeholder}) => ({id, label, placeholder}))
};

// Returns an error message if the profile is invalid, otherwise null
// Location is not part of this, it is saved separately through /api/profile/location
const validateProfile = ({displayName, gradYear, bio, wellnessPreferences, interests, visibility, socialLinks}) => {
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
    // Social links are optional, older pages that do not send them keep working
    if (visibility.social !== undefined && !PROFILE_OPTIONS.visibility.includes(visibility.social)) {
        return 'Invalid Visibility Settings';
    }
    if (socialLinks !== undefined) {
        if (typeof socialLinks !== 'object' || socialLinks === null || Array.isArray(socialLinks)) {
            return 'Invalid Social Links';
        }
        for (const [id, value] of Object.entries(socialLinks)) {
            const platform = SOCIAL_PLATFORMS.find((p) => p.id === id);
            if (!platform || typeof value !== 'string') return 'Invalid Social Links';
            if (value.trim() && !parseSocialLink(platform, value)) {
                return platform.isWebsite
                    ? 'Website must be a full link starting with https://'
                    : `That does not look like a valid ${platform.label} ${platform.hosts.length ? 'username or profile link' : 'username'}`;
            }
        }
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
        const socialResult = await pool.query(
            'SELECT platform, value FROM user_social_links WHERE user_id = $1',
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
            // { linkedin: 'jane-doe', discord: 'jane.doe', ... } for the platforms they filled in
            socialLinks: Object.fromEntries(socialResult.rows.map((row) => [row.platform, row.value])),
            visibility: {
                neighborhood: profile.neighborhood_visibility || 'hokies',
                interests: profile.interests_visibility || 'hokies',
                wellness: profile.wellness_visibility || 'hokies',
                social: profile.social_visibility || 'hokies'
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
    const {displayName, gradYear, bio, wellnessPreferences, interests, visibility, socialLinks} = req.body;

    const validationError = validateProfile(req.body);
    if (validationError) {
        return res.status(400).json({message: validationError});
    }

    // Profile, interests, wellness preferences and social links are saved together
    // so a failure never leaves half a profile
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Social visibility keeps its saved value when it is not sent ($8 is null)
        await client.query(
            `INSERT INTO profiles (user_id, display_name, grad_year, bio, neighborhood_visibility,
                                   interests_visibility, wellness_visibility, social_visibility, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'hokies'), NOW())
             ON CONFLICT (user_id) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                grad_year = EXCLUDED.grad_year,
                bio = EXCLUDED.bio,
                neighborhood_visibility = EXCLUDED.neighborhood_visibility,
                interests_visibility = EXCLUDED.interests_visibility,
                wellness_visibility = EXCLUDED.wellness_visibility,
                social_visibility = COALESCE($8, profiles.social_visibility),
                updated_at = NOW()`,
            [req.userId, displayName || null, gradYear || null, bio || null,
             visibility.neighborhood, visibility.interests, visibility.wellness, visibility.social || null]
        );
        if (socialLinks !== undefined) {
            await client.query('DELETE FROM user_social_links WHERE user_id = $1', [req.userId]);
            for (const [id, value] of Object.entries(socialLinks)) {
                if (!value.trim()) continue;
                const platform = SOCIAL_PLATFORMS.find((p) => p.id === id);
                await client.query(
                    'INSERT INTO user_social_links (user_id, platform, value) VALUES ($1, $2, $3)',
                    [req.userId, id, parseSocialLink(platform, value)]
                );
            }
        }
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
        // Social links by user id, as the {platform, value} rows formatSocialLinks expects
        const socialByUser = new Map();
        for (const row of (await pool.query('SELECT user_id, platform, value FROM user_social_links')).rows) {
            if (!socialByUser.has(row.user_id)) socialByUser.set(row.user_id, []);
            socialByUser.get(row.user_id).push(row);
        }

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
                socialLinks: row.social_visibility === 'hokies' ? formatSocialLinks(socialByUser.get(row.id) || []) : [],
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

// ===== Messages =====
const MAX_MESSAGE_LENGTH = 1000;

// Messages returned per conversation, the newest ones
const MESSAGE_HISTORY_LIMIT = 200;

// Look up the other person in a conversation by username, returns null if not found
const findMessagePartner = async (username) => {
    const result = await pool.query(
        `SELECT users.id, users.username, profiles.display_name FROM users
         LEFT JOIN profiles ON profiles.user_id = users.id
         WHERE users.username = $1`,
        [username]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return { id: row.id, username: row.username, displayName: row.display_name || row.username };
};

// List the logged in user's conversations, most recent first, with the last message and unread count
app.get('/api/conversations', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM messages WHERE sender_id = $1 OR recipient_id = $1 ORDER BY created_at DESC, id DESC`,
            [req.userId]
        );

        // Messages are newest first, so the first one seen for each person is the latest
        const conversations = new Map();
        for (const message of result.rows) {
            const partnerId = message.sender_id === req.userId ? message.recipient_id : message.sender_id;
            if (!conversations.has(partnerId)) {
                conversations.set(partnerId, {
                    partnerId,
                    lastMessage: message.body,
                    lastMessageFromMe: message.sender_id === req.userId,
                    lastMessageAt: message.created_at,
                    unreadCount: 0
                });
            }
            if (message.recipient_id === req.userId && message.read_at === null) {
                conversations.get(partnerId).unreadCount += 1;
            }
        }

        const partnerIds = [...conversations.keys()];
        const names = new Map();
        if (partnerIds.length > 0) {
            const placeholders = partnerIds.map((_, index) => `$${index + 1}`).join(', ');
            const partnerResult = await pool.query(
                `SELECT users.id, users.username, profiles.display_name FROM users
                 LEFT JOIN profiles ON profiles.user_id = users.id
                 WHERE users.id IN (${placeholders})`,
                partnerIds
            );
            for (const row of partnerResult.rows) names.set(row.id, row);
        }

        const list = [...conversations.values()].map(({partnerId, ...conversation}) => ({
            username: names.get(partnerId).username,
            displayName: names.get(partnerId).display_name || names.get(partnerId).username,
            ...conversation
        }));
        return res.status(200).json({
            conversations: list,
            totalUnread: list.reduce((sum, c) => sum + c.unreadCount, 0)
        });
    } catch (error) {
        return res.status(500).json({
            message: 'Internal Server Error'
        });
    }
});

// Get the conversation with another user, oldest first, and mark their messages to me as read
app.get('/api/messages/:username', requireAuth, async (req, res) => {
    try {
        const partner = await findMessagePartner(req.params.username);
        if (!partner || partner.id === req.userId) {
            return res.status(404).json({message: 'User Not Found'});
        }

        const result = await pool.query(
            `SELECT id, sender_id, body, created_at, read_at FROM messages
             WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)
             ORDER BY created_at DESC, id DESC
             LIMIT $3`,
            [req.userId, partner.id, MESSAGE_HISTORY_LIMIT]
        );
        await pool.query(
            'UPDATE messages SET read_at = NOW() WHERE sender_id = $1 AND recipient_id = $2 AND read_at IS NULL',
            [partner.id, req.userId]
        );

        return res.status(200).json({
            partner: { username: partner.username, displayName: partner.displayName },
            messages: result.rows.reverse().map((row) => ({
                id: row.id,
                fromMe: row.sender_id === req.userId,
                body: row.body,
                createdAt: row.created_at,
                read: row.read_at !== null
            }))
        });
    } catch (error) {
        return res.status(500).json({
            message: 'Internal Server Error'
        });
    }
});

// Send a message to another user
app.post('/api/messages/:username', requireAuth, async (req, res) => {
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
    if (!body) {
        return res.status(400).json({message: 'Message cannot be empty'});
    }
    if (body.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({message: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer`});
    }

    try {
        const partner = await findMessagePartner(req.params.username);
        if (!partner || partner.id === req.userId) {
            return res.status(404).json({message: 'User Not Found'});
        }

        const result = await pool.query(
            `INSERT INTO messages (sender_id, recipient_id, body) VALUES ($1, $2, $3)
             RETURNING id, body, created_at`,
            [req.userId, partner.id, body]
        );
        const message = result.rows[0];
        return res.status(201).json({
            message: { id: message.id, fromMe: true, body: message.body, createdAt: message.created_at, read: false }
        });
    } catch (error) {
        return res.status(500).json({
            message: 'Internal Server Error'
        });
    }
});

// ===== Events =====
// Every event comes back with how many Hokies are going, whether the logged in user is going,
// who is hosting it (a person or a group), and whether it has an image
// $1 is always the logged in user's id
const EVENT_SELECT = `
    SELECT events.id, events.title, events.description, events.location, events.category,
           events.newcomer_tip, events.starts_at, events.ends_at, events.latitude, events.longitude,
           events.creator_id, events.group_id,
           creator.username AS creator_username, creator_profile.display_name AS creator_display_name,
           host_group.name AS group_name, event_images.updated_at AS image_updated_at,
           COALESCE(going.going_count, 0) AS going_count,
           (my_rsvp.user_id IS NOT NULL) AS i_am_going
    FROM events
    JOIN users creator ON creator.id = events.creator_id
    LEFT JOIN profiles creator_profile ON creator_profile.user_id = events.creator_id
    LEFT JOIN groups host_group ON host_group.id = events.group_id
    LEFT JOIN event_images ON event_images.event_id = events.id
    LEFT JOIN (SELECT event_id, COUNT(*)::int AS going_count FROM event_attendees
               WHERE status = 'going' GROUP BY event_id) going ON going.event_id = events.id
    LEFT JOIN event_attendees my_rsvp
           ON my_rsvp.event_id = events.id AND my_rsvp.user_id = $1 AND my_rsvp.status = 'going'`;

// Turn a database row into the shape the frontend uses (camelCase like the other routes)
// tags and distanceMiles are worked out separately and passed in
const formatEvent = (row, viewerId, tags = [], distanceMiles = null) => ({
    id: row.id,
    title: row.title,
    description: row.description || '',
    location: row.location || '',
    category: row.category || 'Social',
    newcomerTip: row.newcomer_tip || '',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    latitude: row.latitude,
    longitude: row.longitude,
    tags,
    distanceMiles: distanceMiles === null ? null : Math.round(distanceMiles * 10) / 10,
    // Events hosted by a group show the group's name, otherwise the person who made it
    host: row.group_id
        ? { type: 'group', name: row.group_name }
        : { type: 'user', name: row.creator_display_name || row.creator_username, username: row.creator_username },
    isMine: row.creator_id === viewerId,
    // ?v= changes when the image is replaced, so browsers do not show an old cached copy
    imageUrl: row.image_updated_at
        ? `/api/events/${row.id}/image?v=${new Date(row.image_updated_at).getTime()}`
        : null,
    goingCount: row.going_count,
    iAmGoing: row.i_am_going
});

// Limits for creating an event
const MAX_EVENT_TAGS = 5;
const MAX_EVENT_DESCRIPTION = 2000;
const MAX_NEWCOMER_TIP = 300;

// Images: the page shrinks them before uploading, this is only a safety limit
const MAX_EVENT_IMAGE_BYTES = 2 * 1024 * 1024;

// Tags are lowercase, 1 to 30 characters: letters, numbers, spaces, & ' and -
// Returns the cleaned up tag, or null if it is not allowed
const normalizeTag = (tag) => {
    if (typeof tag !== 'string') return null;
    const cleaned = tag.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, ' ');
    return /^[a-z0-9][a-z0-9 &'-]{0,29}$/.test(cleaned) ? cleaned : null;
};

// Suggested tags on the create page, taken from the profile lists so events line up with what Hokies like
const SUGGESTED_EVENT_TAGS = [...PROFILE_OPTIONS.interests, ...PROFILE_OPTIONS.wellnessPreferences]
    .map(normalizeTag).filter(Boolean);

// Groups the logged in user can host events for
// Only group admins can post on behalf of a group (the groups feature will manage who is an admin)
const findHostableGroups = async (userId) => {
    const result = await pool.query(
        `SELECT groups.id, groups.name FROM groups
         JOIN group_members ON group_members.group_id = groups.id
         WHERE group_members.user_id = $1 AND group_members.role = 'admin'
         ORDER BY groups.name`,
        [userId]
    );
    return result.rows;
};

// Get the tags for a list of event ids, as a Map of event id -> list of tags
const findEventTags = async (eventIds) => {
    if (eventIds.length === 0) return new Map();
    const placeholders = eventIds.map((_, index) => `$${index + 1}`).join(', ');
    const result = await pool.query(
        `SELECT event_id, tag FROM event_tags WHERE event_id IN (${placeholders}) ORDER BY tag`,
        eventIds
    );
    return groupByUser(result.rows.map((row) => ({ user_id: row.event_id, tag: row.tag })), 'tag');
};

// The logged in user's saved location, used to show how far away each event is
const findViewerLocation = async (userId) => {
    const result = await pool.query('SELECT latitude, longitude FROM profiles WHERE user_id = $1', [userId]);
    const row = result.rows[0];
    return row && row.latitude !== null ? { latitude: row.latitude, longitude: row.longitude } : null;
};

const eventDistance = (viewerLocation, row) => (viewerLocation && row.latitude !== null)
    ? distanceInMiles(viewerLocation.latitude, viewerLocation.longitude, row.latitude, row.longitude)
    : null;

// Map settings for the pages. The Google Maps key comes from the GOOGLEMAPS_KEY environment variable
// (set on Render). A Maps JavaScript key is always visible in the browser, so it is protected by the
// website restrictions set on the key in Google Cloud Console, not by keeping it secret.
// Without a key the pages fall back to OpenStreetMap maps (handy for local development)
app.get('/api/maps-config', (req, res) => {
    return res.status(200).json({
        googleMapsKey: process.env.GOOGLEMAPS_KEY || null,
        // Advanced markers need a Map ID, DEMO_MAP_ID works until you create your own in Cloud Console
        googleMapsMapId: process.env.GOOGLEMAPS_MAP_ID || 'DEMO_MAP_ID'
    });
});

// Choices for the Events and Create event pages
app.get('/api/event-options', requireAuth, async (req, res) => {
    try {
        const popularResult = await pool.query(
            `SELECT tag, COUNT(*)::int AS count FROM event_tags GROUP BY tag ORDER BY count DESC, tag LIMIT 20`
        );
        return res.status(200).json({
            categories: PROFILE_OPTIONS.interests,
            suggestedTags: SUGGESTED_EVENT_TAGS,
            popularTags: popularResult.rows.map((row) => row.tag),
            hostableGroups: await findHostableGroups(req.userId),
            maxTags: MAX_EVENT_TAGS
        });
    } catch (error) {
        return res.status(500).json({
            message: 'Internal Server Error'
        });
    }
});

// ===== Event recommendations (Discover page) =====
// Like the Hokie compatibility score, each part earns up to its weight in points, out of 100.
// Matching what the user likes counts the most, then how close the event is, then how soon it is
const RECOMMEND_WEIGHTS = {
    interests: 40,
    distance: 30,
    soon: 20,
    popular: 10
};

// Distance points halve every this many miles: 0 mi = full points, 5 mi = half
const RECOMMEND_DISTANCE_HALF_LIFE_MILES = 5;

// "How soon" points halve every this many days: today = full points, a week away = half
const RECOMMEND_SOON_HALF_LIFE_DAYS = 7;

// This many Hokies going earns the full popularity points
const RECOMMEND_POPULAR_COUNT = 10;

// The logged in user's interests and wellness preferences, as tags (lowercase) so they compare to event tags
const findViewerLikes = async (userId) => {
    const interests = (await pool.query('SELECT interest FROM user_interests WHERE user_id = $1', [userId]))
        .rows.map((row) => row.interest);
    const wellness = (await pool.query('SELECT preference FROM user_wellness_preferences WHERE user_id = $1', [userId]))
        .rows.map((row) => row.preference);
    return { interests, likedTags: new Set([...interests, ...wellness].map(normalizeTag).filter(Boolean)) };
};

// Scores one event for the viewer, returns { score, reasons } where reasons are short sentences for the page
const recommendEvent = (event, viewerLikes) => {
    const reasons = [];

    // Interests: the category is one of theirs, or the tags match their interests or wellness preferences
    const categoryMatch = viewerLikes.interests.includes(event.category);
    const matchingTags = event.tags.filter((tag) => viewerLikes.likedTags.has(tag));
    const interestScore = categoryMatch ? 1 : Math.min(1, matchingTags.length * 0.5);
    if (categoryMatch) {
        reasons.push(`Matches your interest in ${event.category}`);
    } else if (matchingTags.length) {
        reasons.push(`Tagged #${matchingTags[0]}, which you like`);
    }

    // Distance and popularity count toward the score, but are not reasons because the card already shows them
    const distanceScore = event.distanceMiles === null
        ? 0 : 0.5 ** (event.distanceMiles / RECOMMEND_DISTANCE_HALF_LIFE_MILES);

    const daysAway = Math.max(0, (new Date(event.startsAt) - Date.now()) / (24 * 60 * 60 * 1000));
    const soonScore = 0.5 ** (daysAway / RECOMMEND_SOON_HALF_LIFE_DAYS);
    if (daysAway < 1) reasons.push('Happening soon');

    const popularScore = Math.min(1, event.goingCount / RECOMMEND_POPULAR_COUNT);

    const score = interestScore * RECOMMEND_WEIGHTS.interests + distanceScore * RECOMMEND_WEIGHTS.distance +
        soonScore * RECOMMEND_WEIGHTS.soon + popularScore * RECOMMEND_WEIGHTS.popular;
    return { score: Math.round(score), reasons: reasons.slice(0, 2) };
};

const countGoing = async (eventId) => {
    const result = await pool.query(
        `SELECT COUNT(*)::int AS count FROM event_attendees WHERE event_id = $1 AND status = 'going'`,
        [eventId]
    );
    return result.rows[0].count;
};

// List events
// Optional filters: ?when=upcoming|week|past (default upcoming) &q=<search> &category=<name>
//                   &tag=<tag> &maxDistance=<miles from the user's profile location>
//                   &sort=recommended (best matches for the user first, see recommendEvent) &limit=<count>
app.get('/api/events', requireAuth, async (req, res) => {
    const recommended = req.query.sort === 'recommended';
    const limit = Number.isInteger(Number(req.query.limit)) && Number(req.query.limit) > 0 ? Number(req.query.limit) : null;
    const when = ['upcoming', 'week', 'past'].includes(req.query.when) ? req.query.when : 'upcoming';
    const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const category = PROFILE_OPTIONS.interests.includes(req.query.category) ? req.query.category : null;
    const tag = req.query.tag ? normalizeTag(req.query.tag) : null;
    const maxDistance = Number(req.query.maxDistance) > 0 ? Number(req.query.maxDistance) : null;

    // Build the WHERE clause from whichever filters were given, $1 is the user id
    const conditions = [];
    const params = [req.userId];
    const addParam = (value) => {
        params.push(value);
        return `$${params.length}`;
    };

    // An event counts as upcoming until it ends (or until it starts, if it has no end time)
    if (when === 'upcoming') conditions.push('COALESCE(events.ends_at, events.starts_at) >= NOW()');
    if (when === 'past') conditions.push('COALESCE(events.ends_at, events.starts_at) < NOW()');
    if (when === 'week') {
        conditions.push(`COALESCE(events.ends_at, events.starts_at) >= NOW()`);
        conditions.push(`events.starts_at <= ${addParam(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))}`);
    }
    if (search) {
        const pattern = addParam(`%${search}%`);
        conditions.push(`(events.title ILIKE ${pattern} OR events.description ILIKE ${pattern} OR events.location ILIKE ${pattern})`);
    }
    if (category) conditions.push(`events.category = ${addParam(category)}`);
    if (tag) {
        conditions.push(`events.id IN (SELECT event_id FROM event_tags WHERE tag = ${addParam(tag)})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    // Past events show the most recent first, the rest show the soonest first
    const order = when === 'past' ? 'DESC' : 'ASC';

    try {
        const result = await pool.query(`${EVENT_SELECT} ${where} ORDER BY events.starts_at ${order}`, params);
        const viewerLocation = await findViewerLocation(req.userId);
        const tagsByEvent = await findEventTags(result.rows.map((row) => row.id));

        let events = [];
        for (const row of result.rows) {
            const distance = eventDistance(viewerLocation, row);
            if (maxDistance !== null && (distance === null || distance > maxDistance)) continue;
            events.push(formatEvent(row, req.userId, tagsByEvent.get(row.id) || [], distance));
        }

        if (recommended) {
            const viewerLikes = await findViewerLikes(req.userId);
            events = events
                .map((event) => ({ ...event, recommendation: recommendEvent(event, viewerLikes) }))
                // Best match first, sooner first when scores tie
                .sort((a, b) => b.recommendation.score - a.recommendation.score ||
                    new Date(a.startsAt) - new Date(b.startsAt));
        }
        if (limit !== null) events = events.slice(0, limit);

        return res.status(200).json({ events, viewerHasLocation: viewerLocation !== null });
    } catch (error) {
        return res.status(500).json({
            message: 'Internal Server Error'
        });
    }
});

// Get one event by id
app.get('/api/events/:id', requireAuth, async (req, res) => {
    const eventId = Number(req.params.id);
    if (!Number.isInteger(eventId)) {
        return res.status(404).json({message: 'Event Not Found'});
    }
    try {
        const result = await pool.query(`${EVENT_SELECT} WHERE events.id = $2`, [req.userId, eventId]);
        if (result.rows.length === 0) {
            return res.status(404).json({message: 'Event Not Found'});
        }
        const row = result.rows[0];
        const tagsByEvent = await findEventTags([eventId]);
        const distance = eventDistance(await findViewerLocation(req.userId), row);
        return res.status(200).json({event: formatEvent(row, req.userId, tagsByEvent.get(eventId) || [], distance)});
    } catch (error) {
        return res.status(500).json({
            message: 'Internal Server Error'
        });
    }
});

// List the Hokies going to an event, the logged in user first, then in the order they RSVP'd
// Only shows what is always public on a profile (name and class year)
app.get('/api/events/:id/attendees', requireAuth, async (req, res) => {
    const eventId = Number(req.params.id);
    if (!Number.isInteger(eventId)) {
        return res.status(404).json({message: 'Event Not Found'});
    }
    try {
        const eventResult = await pool.query('SELECT 1 FROM events WHERE id = $1', [eventId]);
        if (eventResult.rows.length === 0) {
            return res.status(404).json({message: 'Event Not Found'});
        }
        const result = await pool.query(
            `SELECT users.id, users.username, profiles.display_name, profiles.grad_year
             FROM event_attendees
             JOIN users ON users.id = event_attendees.user_id
             LEFT JOIN profiles ON profiles.user_id = users.id
             WHERE event_attendees.event_id = $1 AND event_attendees.status = 'going'
             ORDER BY (users.id = $2) DESC, event_attendees.responded_at ASC`,
            [eventId, req.userId]
        );
        return res.status(200).json({
            attendees: result.rows.map((row) => ({
                username: row.username,
                displayName: row.display_name || row.username,
                gradYear: row.grad_year || null,
                isMe: row.id === req.userId
            }))
        });
    } catch (error) {
        return res.status(500).json({
            message: 'Internal Server Error'
        });
    }
});

// Returns an error message if the new event is invalid, otherwise null
const validateEvent = ({title, startsAt, endsAt, category, location, latitude, longitude, description, newcomerTip, tags}) => {
    if (!title || typeof title !== 'string' || title.trim().length === 0 || title.length > 150) {
        return 'Title is required and must be 150 characters or fewer';
    }
    const start = new Date(startsAt);
    if (!startsAt || isNaN(start.getTime())) {
        return 'A valid start time is required';
    }
    if (start < new Date()) {
        return 'Start time must be in the future';
    }
    if (endsAt && (isNaN(new Date(endsAt).getTime()) || new Date(endsAt) < start)) {
        return 'End time must be after the start time';
    }
    // Event categories use the same list as profile interests so filters and matching line up
    if (!PROFILE_OPTIONS.interests.includes(category)) {
        return 'Please pick a category';
    }
    if (!location || typeof location !== 'string' || location.trim().length === 0 || location.length > 255) {
        return 'Location name is required and must be 255 characters or fewer';
    }
    if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
        Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        return 'Please place the event on the map';
    }
    if (!description || typeof description !== 'string' || description.trim().length === 0 ||
        description.length > MAX_EVENT_DESCRIPTION) {
        return `Description is required and must be ${MAX_EVENT_DESCRIPTION} characters or fewer`;
    }
    if (newcomerTip && (typeof newcomerTip !== 'string' || newcomerTip.length > MAX_NEWCOMER_TIP)) {
        return `Newcomer tip must be ${MAX_NEWCOMER_TIP} characters or fewer`;
    }
    if (tags !== undefined && (!Array.isArray(tags) || tags.length > MAX_EVENT_TAGS || !tags.every(normalizeTag))) {
        return `Up to ${MAX_EVENT_TAGS} tags, each 1 to 30 letters, numbers or spaces`;
    }
    return null;
};

// Create an event, the logged in user is the creator
// Body: {title, startsAt, endsAt, category, location, latitude, longitude, description, newcomerTip, tags, groupId}
// groupId is optional, to host on behalf of a group the user is an admin of
// The image is uploaded afterwards with PUT /api/events/:id/image
app.post('/api/events', requireAuth, async (req, res) => {
    const validationError = validateEvent(req.body);
    if (validationError) {
        return res.status(400).json({message: validationError});
    }
    const {title, startsAt, endsAt, category, location, latitude, longitude, description, newcomerTip, groupId} = req.body;
    const tags = [...new Set((req.body.tags || []).map(normalizeTag))];

    const client = await pool.connect();
    try {
        if (groupId) {
            const hostable = await findHostableGroups(req.userId);
            if (!hostable.some((group) => group.id === groupId)) {
                return res.status(403).json({message: 'You can only host events for groups you are an admin of'});
            }
        }

        // The event and its tags are saved together
        await client.query('BEGIN');
        const result = await client.query(
            `INSERT INTO events (title, starts_at, ends_at, category, location, latitude, longitude,
                                 description, newcomer_tip, creator_id, group_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
            [title.trim(), new Date(startsAt), endsAt ? new Date(endsAt) : null, category, location.trim(),
             latitude, longitude, description.trim(), newcomerTip ? newcomerTip.trim() : null,
             req.userId, groupId || null]
        );
        const eventId = result.rows[0].id;
        for (const tag of tags) {
            await client.query('INSERT INTO event_tags (event_id, tag) VALUES ($1, $2)', [eventId, tag]);
        }
        await client.query('COMMIT');
        return res.status(201).json({message: 'Event Created', id: eventId});
    } catch (error) {
        await client.query('ROLLBACK');
        return res.status(500).json({
            message: 'Internal Server Error'
        });
    } finally {
        client.release();
    }
});

// Delete an event, only the person who created it can
app.delete('/api/events/:id', requireAuth, async (req, res) => {
    const eventId = Number(req.params.id);
    if (!Number.isInteger(eventId)) {
        return res.status(404).json({message: 'Event Not Found'});
    }
    try {
        const result = await pool.query(
            'DELETE FROM events WHERE id = $1 AND creator_id = $2',
            [eventId, req.userId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({message: 'Event Not Found'});
        }
        return res.status(200).json({message: 'Event Deleted'});
    } catch (error) {
        return res.status(500).json({
            message: 'Internal Server Error'
        });
    }
});

// Checks the first bytes of the file, so a renamed file cannot pretend to be an image
const detectImageType = (buffer) => {
    if (buffer.length > 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
    if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'image/png';
    if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    return null;
};

// Upload or replace an event's image, only the person who created the event can
// The body is the image file itself (Content-Type image/jpeg, image/png or image/webp)
app.put('/api/events/:id/image',
    requireAuth,
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_EVENT_IMAGE_BYTES }),
    async (req, res) => {
        const eventId = Number(req.params.id);
        if (!Number.isInteger(eventId)) {
            return res.status(404).json({message: 'Event Not Found'});
        }
        const contentType = Buffer.isBuffer(req.body) ? detectImageType(req.body) : null;
        if (!contentType) {
            return res.status(400).json({message: 'Image must be a JPEG, PNG or WebP file'});
        }

        try {
            const owner = await pool.query('SELECT 1 FROM events WHERE id = $1 AND creator_id = $2', [eventId, req.userId]);
            if (owner.rows.length === 0) {
                return res.status(404).json({message: 'Event Not Found'});
            }
            await pool.query(
                `INSERT INTO event_images (event_id, content_type, data, updated_at) VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (event_id) DO UPDATE SET
                    content_type = EXCLUDED.content_type, data = EXCLUDED.data, updated_at = NOW()`,
                [eventId, contentType, req.body]
            );
            return res.status(200).json({message: 'Image Saved'});
        } catch (error) {
            return res.status(500).json({
                message: 'Internal Server Error'
            });
        }
    }
);

// Send an event's image
// Not behind requireAuth because <img> tags cannot send the login token, event images are not private
app.get('/api/events/:id/image', async (req, res) => {
    const eventId = Number(req.params.id);
    if (!Number.isInteger(eventId)) {
        return res.status(404).json({message: 'Image Not Found'});
    }
    try {
        const result = await pool.query('SELECT content_type, data FROM event_images WHERE event_id = $1', [eventId]);
        if (result.rows.length === 0) {
            return res.status(404).json({message: 'Image Not Found'});
        }
        res.set('Content-Type', result.rows[0].content_type);
        // The URL includes ?v=<last updated> so it is safe to cache for a long time
        res.set('Cache-Control', 'public, max-age=604800');
        return res.status(200).send(result.rows[0].data);
    } catch (error) {
        return res.status(500).json({
            message: 'Internal Server Error'
        });
    }
});

// Errors from express.raw above (image too large) come back as JSON like everything else
app.use('/api/events/:id/image', (error, req, res, next) => {
    if (error.type === 'entity.too.large') {
        return res.status(413).json({message: 'Image must be 2 MB or smaller'});
    }
    next(error);
});

// RSVP "going" to an event
app.post('/api/events/:id/rsvp', requireAuth, async (req, res) => {
    const eventId = Number(req.params.id);
    if (!Number.isInteger(eventId)) {
        return res.status(404).json({message: 'Event Not Found'});
    }
    try {
        await pool.query(
            `INSERT INTO event_attendees (event_id, user_id, status) VALUES ($1, $2, 'going')
             ON CONFLICT (event_id, user_id) DO UPDATE SET status = 'going', responded_at = NOW()`,
            [eventId, req.userId]
        );
        return res.status(200).json({message: 'RSVP Saved', goingCount: await countGoing(eventId)});
    } catch (error) {
        // 23503 is Postgres' foreign key violation code, meaning the event does not exist
        if (error.code === '23503') {
            return res.status(404).json({message: 'Event Not Found'});
        }
        return res.status(500).json({
            message: 'Internal Server Error'
        });
    }
});

// Cancel an RSVP
app.delete('/api/events/:id/rsvp', requireAuth, async (req, res) => {
    const eventId = Number(req.params.id);
    if (!Number.isInteger(eventId)) {
        return res.status(404).json({message: 'Event Not Found'});
    }
    try {
        await pool.query(
            'DELETE FROM event_attendees WHERE event_id = $1 AND user_id = $2',
            [eventId, req.userId]
        );
        return res.status(200).json({message: 'RSVP Removed', goingCount: await countGoing(eventId)});
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