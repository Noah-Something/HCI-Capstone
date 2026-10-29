// Creates sample Hokie profiles for testing the Hokies page (matching, filters and privacy settings)
//
// Run:     npm run seed             (adds the sample users, or updates them if they already exist)
// Remove:  npm run seed -- --remove (deletes only the sample users listed below)
//
// Uses DATABASE_URL, the same as server.js. Start server.js once first so the tables exist.
// Every sample user's password is SAMPLE_PASSWORD, so you can also sign in as any of them.
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const SAMPLE_PASSWORD = 'hokies123';

// Locations are rounded to 2 decimal places, the same as a real device location saved by server.js
// Together they cover: strong and weak matches, near and far, different class years,
// hidden sections ("only_me"), someone outside the D.C. area, and a nearly empty profile
const SAMPLE_PROFILES = [
    {
        username: 'sample_maya', displayName: 'Maya Patel', gradYear: 2026,
        bio: 'Just moved to Clarendon for a consulting job. Always down for a weekend run or brunch.',
        neighborhood: 'Clarendon', latitude: 38.89, longitude: -77.09,
        interests: ['Running', 'Yoga', 'Food & Drink'],
        wellnessPreferences: ['Mind-body movement', 'Cardio and Endurance', 'Meeting new people']
    },
    {
        username: 'sample_jordan', displayName: 'Jordan Lee', gradYear: 2025,
        bio: 'Training for my first half marathon. Looking for people to ride the Custis Trail with too.',
        neighborhood: 'Ballston', latitude: 38.88, longitude: -77.11,
        interests: ['Running', 'Cycling', 'Gym & Fitness'],
        wellnessPreferences: ['Cardio and Endurance', 'Group Connection']
    },
    {
        username: 'sample_olivia', displayName: 'Olivia Martin', gradYear: 2026,
        bio: 'Sunrise yoga and trail runs are my reset. Let\'s explore Rock Creek together!',
        neighborhood: 'Capitol Hill', latitude: 38.89, longitude: -76.99,
        interests: ['Running', 'Yoga', 'Hiking'],
        wellnessPreferences: ['Mind-body movement', 'Mindfulness and Relaxation', 'Cardio and Endurance']
    },
    {
        username: 'sample_sam', displayName: 'Sam Rivera', gradYear: 2024,
        bio: 'Never miss a game day. Hosting watch parties near Nationals Park.',
        neighborhood: 'Navy Yard', latitude: 38.88, longitude: -77.00,
        interests: ['Game Days', 'Social', 'Food & Drink'],
        wellnessPreferences: ['Meeting new people', 'Group Connection']
    },
    {
        username: 'sample_priya', displayName: 'Priya Shah', gradYear: 2026,
        bio: 'Museum hopper and yoga regular. Trying to spend less time on my phone.',
        neighborhood: 'Dupont Circle', latitude: 38.91, longitude: -77.04,
        interests: ['Yoga', 'Arts & Music'],
        wellnessPreferences: ['Mindfulness and Relaxation', 'Digital Detox', 'Mindful Eating']
    },
    {
        username: 'sample_tyler', displayName: 'Tyler Brooks', gradYear: 2019,
        bio: 'Weekend hiker, weekday cyclist. I volunteer with a trail cleanup group once a month.',
        neighborhood: 'Alexandria', latitude: 38.80, longitude: -77.05,
        interests: ['Hiking', 'Cycling', 'Volunteering'],
        wellnessPreferences: ['Cardio and Endurance', 'Digital Detox']
    },
    {
        username: 'sample_chris', displayName: 'Chris Nguyen', gradYear: 2012,
        bio: 'Software engineer out in Reston. Board game nights every Thursday, all welcome.',
        neighborhood: 'Reston', latitude: 38.96, longitude: -77.36,
        interests: ['Board Games', 'Game Days'],
        wellnessPreferences: ['Brain Stimulation', 'Group Connection']
    },
    {
        // Hides their neighborhood, so they show no location and are left out of distance filters
        username: 'sample_ethan', displayName: 'Ethan Kim', gradYear: 2023,
        bio: 'Gym in the morning, run in the evening.',
        neighborhood: 'Bethesda', latitude: 38.98, longitude: -77.10,
        interests: ['Gym & Fitness', 'Running'],
        wellnessPreferences: ['Cardio and Endurance'],
        visibility: { neighborhood: 'only_me' }
    },
    {
        // Hides their wellness preferences
        username: 'sample_hannah', displayName: 'Hannah Davis', gradYear: 2025,
        bio: 'Love live music and giving back. Looking for volunteering buddies in Silver Spring.',
        neighborhood: 'Silver Spring', latitude: 38.99, longitude: -77.03,
        interests: ['Volunteering', 'Arts & Music'],
        wellnessPreferences: ['Meeting new people', 'Mindful Eating'],
        visibility: { wellness: 'only_me' }
    },
    {
        // Hides their interests
        username: 'sample_marcus', displayName: 'Marcus Johnson', gradYear: 2008,
        bio: 'Class of \'08, been in Tysons for over a decade. Happy to show new Hokies around.',
        neighborhood: 'Tysons', latitude: 38.92, longitude: -77.23,
        interests: ['Game Days', 'Food & Drink', 'Social'],
        wellnessPreferences: ['Group Connection'],
        visibility: { interests: 'only_me' }
    },
    {
        // Lives far outside the area, should rank low on distance
        username: 'sample_lena', displayName: 'Lena Fischer', gradYear: 2026,
        bio: 'Still in Blacksburg for grad school, moving to D.C. next summer!',
        neighborhood: 'Outside the D.C. area', latitude: 37.23, longitude: -80.41,
        interests: ['Hiking', 'Running'],
        wellnessPreferences: ['Digital Detox']
    },
    {
        // Barely filled out: only a class year, no location, interests or wellness
        username: 'sample_alex', displayName: 'Alex Turner', gradYear: 2022,
        bio: '',
        neighborhood: null, latitude: null, longitude: null,
        interests: [],
        wellnessPreferences: []
    }
];

// Render's external database URL requires SSL, a local database usually does not
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({
    connectionString,
    ssl: connectionString && connectionString.includes('render.com') ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 5000
});

const seedSampleProfiles = async () => {
    const hashedPassword = await bcrypt.hash(SAMPLE_PASSWORD, 12);

    // All or nothing, so a failure never leaves half the samples behind
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const sample of SAMPLE_PROFILES) {
            const visibility = { neighborhood: 'hokies', interests: 'hokies', wellness: 'hokies', ...sample.visibility };

            const userResult = await client.query(
                `INSERT INTO users (username, hashed_password) VALUES ($1, $2)
                 ON CONFLICT (username) DO UPDATE SET hashed_password = EXCLUDED.hashed_password
                 RETURNING id`,
                [sample.username, hashedPassword]
            );
            const userId = userResult.rows[0].id;

            await client.query(
                `INSERT INTO profiles (user_id, display_name, grad_year, bio, neighborhood, latitude, longitude,
                                       neighborhood_visibility, interests_visibility, wellness_visibility, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                 ON CONFLICT (user_id) DO UPDATE SET
                    display_name = EXCLUDED.display_name,
                    grad_year = EXCLUDED.grad_year,
                    bio = EXCLUDED.bio,
                    neighborhood = EXCLUDED.neighborhood,
                    latitude = EXCLUDED.latitude,
                    longitude = EXCLUDED.longitude,
                    neighborhood_visibility = EXCLUDED.neighborhood_visibility,
                    interests_visibility = EXCLUDED.interests_visibility,
                    wellness_visibility = EXCLUDED.wellness_visibility,
                    updated_at = NOW()`,
                [userId, sample.displayName, sample.gradYear, sample.bio || null, sample.neighborhood,
                 sample.latitude, sample.longitude, visibility.neighborhood, visibility.interests, visibility.wellness]
            );

            await client.query('DELETE FROM user_interests WHERE user_id = $1', [userId]);
            for (const interest of sample.interests) {
                await client.query('INSERT INTO user_interests (user_id, interest) VALUES ($1, $2)', [userId, interest]);
            }
            await client.query('DELETE FROM user_wellness_preferences WHERE user_id = $1', [userId]);
            for (const preference of sample.wellnessPreferences) {
                await client.query(
                    'INSERT INTO user_wellness_preferences (user_id, preference) VALUES ($1, $2)',
                    [userId, preference]
                );
            }
            console.log(`  ${sample.username.padEnd(15)} ${sample.displayName}`);
        }
        await client.query('COMMIT');
        console.log(`Saved ${SAMPLE_PROFILES.length} sample profiles. Password for all of them: ${SAMPLE_PASSWORD}`);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

// Only deletes the usernames listed above, never real accounts
// Their profiles, interests, sessions, etc. are removed too through ON DELETE CASCADE
const removeSampleProfiles = async () => {
    const usernames = SAMPLE_PROFILES.map((sample) => sample.username);
    const placeholders = usernames.map((_, index) => `$${index + 1}`).join(', ');
    const result = await pool.query(`DELETE FROM users WHERE username IN (${placeholders})`, usernames);
    console.log(`Removed ${result.rowCount} sample profiles.`);
};

const main = async () => {
    if (!connectionString) {
        console.error('DATABASE_URL is not set. Set it to your database\'s connection string first.');
        process.exitCode = 1;
        return;
    }
    try {
        if (process.argv.includes('--remove')) {
            await removeSampleProfiles();
        } else {
            await seedSampleProfiles();
        }
    } catch (error) {
        // 42P01 is Postgres' "table does not exist" code
        if (error.code === '42P01') {
            console.error('Tables are missing. Start server.js once so it creates them, then run this again.');
        } else {
            console.error('Could not save sample profiles:', error.message);
        }
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
};

main();
