// Creates sample groups and events for testing the Groups and Events tabs and the Discover page recommendations
//
// Run:     npm run seed-events             (adds the samples, or recreates them with fresh dates)
// Remove:  npm run seed-events -- --remove (deletes only the sample groups and events listed below)
//
// Uses DATABASE_URL, the same as server.js. The groups and events belong to the sample Hokies,
// so run "npm run seed" first (and start server.js once so the tables exist).
// Dates are relative to the day you run this, so the events are always upcoming. Run it again to refresh them.
const { Pool } = require('pg');

// Sample groups, created before the events so some events can be hosted by a group.
// The first admin is the group's creator. Only admins can host events for a group (like in server.js)
const SAMPLE_GROUPS = [
    {
        name: 'DC Hokie Runners', category: 'Running',
        description: 'Weekly runs around the Mall and Rock Creek for every pace. New runners always welcome!',
        admins: ['sample_maya', 'sample_olivia'],
        members: ['sample_jordan', 'sample_ethan', 'sample_tyler', 'sample_priya']
    },
    {
        name: 'Hokie Game Day Crew', category: 'Game Days',
        description: 'We find the best spots to watch every Hokies game in D.C. and Northern Virginia. Go Hokies!',
        admins: ['sample_sam'],
        members: ['sample_marcus', 'sample_jordan', 'sample_chris', 'sample_hannah', 'sample_maya']
    },
    {
        name: 'Mindful Hokies', category: 'Yoga',
        description: 'Yoga, mindful eating and phone-free time for Hokies looking to slow down.',
        admins: ['sample_priya'],
        members: ['sample_olivia', 'sample_hannah', 'sample_maya']
    },
    {
        name: 'NoVA Board Gamers', category: 'Board Games',
        description: 'Strategy and party games in Reston and Tysons. Bring a game or learn a new one.',
        admins: ['sample_chris'],
        members: ['sample_marcus']
    }
];

// Every sample event: who hosts it (and the group, if it is hosted for one), when (days from today and
// Eastern time), where, and who is going.
// Together they cover every category, near and far locations, events today through three weeks out,
// one that ends after midnight, and one in the past (for the "Past events" filter)
const SAMPLE_EVENTS = [
    {
        host: 'sample_ethan', title: 'After-Work Strength Session',
        category: 'Gym & Fitness', location: 'Bethesda Row', latitude: 38.9807, longitude: -77.1003,
        day: 1, start: '18:00', minutes: 60,
        description: 'A friendly strength workout for all levels. We rotate through squats, rows and core, then grab smoothies.',
        newcomerTip: 'Meet outside the fountain, Ethan will have a maroon towel.',
        tags: ['gym & fitness', 'cardio and endurance'],
        going: ['sample_ethan', 'sample_jordan', 'sample_maya']
    },
    {
        host: 'sample_maya', title: 'Saturday Morning 5K on the Mall', group: 'DC Hokie Runners',
        category: 'Running', location: 'National Mall, by the Washington Monument', latitude: 38.8895, longitude: -77.0353,
        day: 2, start: '08:00', minutes: 90,
        description: 'An easy-paced 5K loop around the Mall, then coffee nearby.\nAll paces welcome, walkers too!',
        newcomerTip: 'Look for the maroon flag at the base of the Monument.',
        tags: ['running', '5k', 'beginner friendly'],
        going: ['sample_maya', 'sample_olivia', 'sample_jordan', 'sample_ethan', 'sample_priya', 'sample_tyler']
    },
    {
        host: 'sample_priya', title: 'Sunrise Yoga at Gravelly Point', group: 'Mindful Hokies',
        category: 'Yoga', location: 'Gravelly Point Park', latitude: 38.8653, longitude: -77.0425,
        day: 3, start: '07:00', minutes: 60,
        description: 'A calm outdoor flow while the planes take off over the river. Bring a mat and water.',
        newcomerTip: 'Arrive 10 minutes early to find a flat spot on the grass.',
        tags: ['yoga', 'mindfulness and relaxation', 'mind-body movement'],
        going: ['sample_priya', 'sample_olivia', 'sample_maya', 'sample_hannah']
    },
    {
        host: 'sample_marcus', title: 'Newcomer Coffee in Tysons',
        category: 'Social', location: 'Tysons, by the Metro station', latitude: 38.9208, longitude: -77.2222,
        day: 3, start: '09:00', minutes: 60,
        description: 'New to Northern Virginia? Come meet a few Hokies who have been here a while and know the area.',
        newcomerTip: 'Marcus will have a VT mug on the table.',
        tags: ['social', 'meeting new people'],
        going: ['sample_marcus', 'sample_chris']
    },
    {
        host: 'sample_sam', title: 'Hokies Game-Day Watch Party', group: 'Hokie Game Day Crew',
        category: 'Game Days', location: 'Wilson Blvd, Clarendon', latitude: 38.8868, longitude: -77.0954,
        day: 4, start: '19:30', minutes: 240,
        description: 'Watch the Hokies with other D.C. alumni. Wear maroon and orange!',
        newcomerTip: 'Ask for the Virginia Tech tables in the back room.',
        tags: ['game days', 'social', 'meeting new people'],
        going: ['sample_sam', 'sample_marcus', 'sample_jordan', 'sample_maya', 'sample_chris', 'sample_hannah', 'sample_ethan']
    },
    {
        host: 'sample_chris', title: 'Board Game Night in Reston', group: 'NoVA Board Gamers',
        category: 'Board Games', location: 'Reston Town Center', latitude: 38.9586, longitude: -77.3570,
        day: 5, start: '19:00', minutes: 210,
        description: 'Strategy games, party games and snacks. Bring a favorite or learn something new.',
        newcomerTip: '',
        tags: ['board games', 'brain stimulation', 'group connection'],
        going: ['sample_chris', 'sample_marcus']
    },
    {
        host: 'sample_olivia', title: 'Rock Creek Trail Run & Brunch', group: 'DC Hokie Runners',
        category: 'Running', location: 'Peirce Mill, Rock Creek Park', latitude: 38.9404, longitude: -77.0524,
        day: 6, start: '08:30', minutes: 150,
        description: 'About 5 miles on shaded trails at a conversational pace, followed by brunch in Cleveland Park.',
        newcomerTip: 'The trail is rocky in places, wear trail shoes if you have them.',
        tags: ['trail running', 'running', 'food & drink'],
        going: ['sample_olivia', 'sample_maya', 'sample_tyler']
    },
    {
        host: 'sample_jordan', title: 'Capital Crescent Trail Group Ride',
        category: 'Cycling', location: 'Capital Crescent Trail, Bethesda trailhead', latitude: 38.9847, longitude: -77.0947,
        day: 7, start: '09:00', minutes: 180,
        description: 'A no-drop ride down to Georgetown and back, about 20 miles. Helmets required.',
        newcomerTip: 'We regroup at every mile marker, so nobody gets left behind.',
        tags: ['cycling', 'cardio and endurance'],
        going: ['sample_jordan', 'sample_tyler', 'sample_ethan']
    },
    {
        host: 'sample_sam', title: 'Hokie Happy Hour at Navy Yard',
        category: 'Food & Drink', location: 'Navy Yard waterfront', latitude: 38.8740, longitude: -77.0030,
        day: 8, start: '18:00', minutes: 120,
        description: 'Casual after-work drinks and snacks by the river. Non-drinkers very welcome.',
        newcomerTip: '',
        tags: ['food & drink', 'meeting new people', 'social'],
        going: ['sample_sam', 'sample_maya', 'sample_priya', 'sample_hannah', 'sample_marcus']
    },
    {
        host: 'sample_hannah', title: 'Food Bank Volunteer Morning',
        category: 'Volunteering', location: 'Northeast D.C. food bank warehouse', latitude: 38.9200, longitude: -76.9850,
        day: 9, start: '09:00', minutes: 180,
        description: 'Help sort and pack food for families across the region. No experience needed.',
        newcomerTip: 'Wear closed-toe shoes, it is a warehouse.',
        tags: ['volunteering', 'group connection'],
        going: ['sample_hannah', 'sample_tyler']
    },
    {
        host: 'sample_tyler', title: 'Great Falls Hike',
        category: 'Hiking', location: 'Great Falls Park, Virginia side', latitude: 38.9985, longitude: -77.2550,
        day: 10, start: '08:00', minutes: 240,
        description: 'About 6 miles on the River Trail and Matildaville Trail with views of the falls. Moderate, some rock scrambling.',
        newcomerTip: 'The park has an entry fee per car, so we carpool from the visitor center lot.',
        tags: ['hiking', 'digital detox', 'outdoors'],
        going: ['sample_tyler', 'sample_olivia', 'sample_lena']
    },
    {
        // Ends after midnight
        host: 'sample_jordan', title: 'Late Night Monuments Bike Tour',
        category: 'Cycling', location: 'Lincoln Memorial', latitude: 38.8893, longitude: -77.0502,
        day: 11, start: '21:00', minutes: 210,
        description: 'See the monuments lit up at night on an easy, slow ride. Lights on your bike required.',
        newcomerTip: 'Bikeshare bikes work great for this one.',
        tags: ['cycling', 'social'],
        going: ['sample_jordan', 'sample_sam']
    },
    {
        host: 'sample_priya', title: 'Mindful Eating Cooking Class', group: 'Mindful Hokies',
        category: 'Food & Drink', location: 'Dupont Circle', latitude: 38.9096, longitude: -77.0434,
        day: 12, start: '18:30', minutes: 120,
        description: 'Cook a simple seasonal dinner together, then eat slowly and phone-free.',
        newcomerTip: 'Let Priya know about any allergies when you RSVP.',
        tags: ['mindful eating', 'food & drink', 'digital detox'],
        going: ['sample_priya', 'sample_hannah']
    },
    {
        host: 'sample_hannah', title: 'Jazz Picnic at the Sculpture Garden',
        category: 'Arts & Music', location: 'National Gallery Sculpture Garden', latitude: 38.8912, longitude: -77.0231,
        day: 13, start: '17:00', minutes: 180,
        description: 'Bring a blanket and some snacks for live jazz on the Mall.',
        newcomerTip: '',
        tags: ['arts & music', 'social'],
        going: ['sample_hannah', 'sample_priya', 'sample_sam']
    },
    {
        host: 'sample_tyler', title: 'Phone-Free Sunday in Old Town',
        category: 'Social', location: 'Old Town Alexandria waterfront', latitude: 38.8048, longitude: -77.0400,
        day: 14, start: '11:00', minutes: 180,
        description: 'A slow walk along the waterfront, lunch and good conversation. Phones stay in pockets!',
        newcomerTip: 'Meet at the foot of King Street by the water.',
        tags: ['digital detox', 'meeting new people', 'social'],
        going: ['sample_tyler', 'sample_priya']
    },
    {
        host: 'sample_olivia', title: 'Pop-Up Yoga on Capitol Hill',
        category: 'Yoga', location: 'Lincoln Park, Capitol Hill', latitude: 38.8899, longitude: -76.9905,
        day: 20, start: '10:00', minutes: 75,
        description: 'Gentle yoga in the park, followed by coffee on Eastern Market.',
        newcomerTip: '',
        tags: ['yoga', 'mind-body movement'],
        going: ['sample_olivia']
    },
    {
        // In the past, for the "Past events" filter
        host: 'sample_tyler', title: 'Fall Leaves Hike on Roosevelt Island',
        category: 'Hiking', location: 'Theodore Roosevelt Island', latitude: 38.8966, longitude: -77.0640,
        day: -6, start: '09:00', minutes: 120,
        description: 'An easy loop around the island to see the fall colors.',
        newcomerTip: '',
        tags: ['hiking', 'outdoors'],
        going: ['sample_tyler', 'sample_olivia', 'sample_maya', 'sample_jordan']
    }
];

// Render's external database URL requires SSL, a local database usually does not
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({
    connectionString,
    ssl: connectionString && connectionString.includes('render.com') ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 5000
});

// Turns "days from today at HH:MM Eastern time" into a Date, no matter which time zone this runs in
const easternTime = (daysFromToday, time) => {
    const [hour, minute] = time.split(':').map(Number);
    const partsOf = (date) => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
    }).formatToParts(date).map((part) => [part.type, Number(part.value)]));

    const today = partsOf(new Date());
    // The wall clock time, pretending it is UTC, then shifted by New York's offset from UTC on that day
    const wallClock = Date.UTC(today.year, today.month - 1, today.day + daysFromToday, hour, minute);
    const there = partsOf(new Date(wallClock));
    const offsetMs = Date.UTC(there.year, there.month - 1, there.day, there.hour, there.minute) - wallClock;
    return new Date(wallClock - offsetMs);
};

// Looks up the sample users' ids, stops with a message if any are missing
const findSampleUsers = async (client) => {
    const usernames = [...new Set([
        ...SAMPLE_EVENTS.flatMap((event) => [event.host, ...event.going]),
        ...SAMPLE_GROUPS.flatMap((group) => [...group.admins, ...group.members])
    ])];
    const placeholders = usernames.map((_, index) => `$${index + 1}`).join(', ');
    const result = await client.query(`SELECT id, username FROM users WHERE username IN (${placeholders})`, usernames);
    const ids = new Map(result.rows.map((row) => [row.username, row.id]));
    const missing = usernames.filter((username) => !ids.has(username));
    if (missing.length) {
        const error = new Error(`Missing sample users: ${missing.join(', ')}. Run "npm run seed" first.`);
        error.code = 'MISSING_USERS';
        throw error;
    }
    return ids;
};

// Only deletes events with these titles that a sample user hosts, never real events
// Tags, images and RSVPs on them are removed too through ON DELETE CASCADE
const deleteSampleEvents = async (client) => {
    const titles = [...new Set(SAMPLE_EVENTS.map((event) => event.title))];
    const hosts = [...new Set(SAMPLE_EVENTS.map((event) => event.host))];
    const titlePlaceholders = titles.map((_, index) => `$${index + 1}`).join(', ');
    const hostPlaceholders = hosts.map((_, index) => `$${titles.length + index + 1}`).join(', ');
    const result = await client.query(
        `DELETE FROM events WHERE title IN (${titlePlaceholders})
         AND creator_id IN (SELECT id FROM users WHERE username IN (${hostPlaceholders}))`,
        [...titles, ...hosts]
    );
    return result.rowCount;
};

// Only deletes groups with these names that a sample user created, never real groups
// Memberships are removed too through ON DELETE CASCADE
const deleteSampleGroups = async (client) => {
    const names = SAMPLE_GROUPS.map((group) => group.name);
    const creators = [...new Set(SAMPLE_GROUPS.map((group) => group.admins[0]))];
    const namePlaceholders = names.map((_, index) => `$${index + 1}`).join(', ');
    const creatorPlaceholders = creators.map((_, index) => `$${names.length + index + 1}`).join(', ');
    const result = await client.query(
        `DELETE FROM groups WHERE name IN (${namePlaceholders})
         AND creator_id IN (SELECT id FROM users WHERE username IN (${creatorPlaceholders}))`,
        [...names, ...creators]
    );
    return result.rowCount;
};

// Creates the sample groups and their members, returns a Map of group name -> id
const createSampleGroups = async (client, userIds) => {
    const groupIds = new Map();
    for (const group of SAMPLE_GROUPS) {
        const result = await client.query(
            'INSERT INTO groups (name, description, category, creator_id) VALUES ($1, $2, $3, $4) RETURNING id',
            [group.name, group.description, group.category, userIds.get(group.admins[0])]
        );
        const groupId = result.rows[0].id;
        groupIds.set(group.name, groupId);
        for (const [usernames, role] of [[group.admins, 'admin'], [group.members, 'member']]) {
            for (const username of usernames) {
                await client.query(
                    'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
                    [groupId, userIds.get(username), role]
                );
            }
        }
        console.log(`  Group: ${group.name} (${group.admins.length + group.members.length} members)`);
    }
    return groupIds;
};

const seedSampleEvents = async () => {
    // All or nothing, so a failure never leaves half the samples behind
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userIds = await findSampleUsers(client);

        // Recreate instead of update, so the dates move forward every time this runs
        const replaced = await deleteSampleEvents(client);
        await deleteSampleGroups(client);
        const groupIds = await createSampleGroups(client, userIds);

        for (const sample of SAMPLE_EVENTS) {
            const startsAt = easternTime(sample.day, sample.start);
            const endsAt = new Date(startsAt.getTime() + sample.minutes * 60 * 1000);
            const result = await client.query(
                `INSERT INTO events (title, starts_at, ends_at, category, location, latitude, longitude,
                                     description, newcomer_tip, creator_id, group_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
                [sample.title, startsAt, endsAt, sample.category, sample.location, sample.latitude, sample.longitude,
                 sample.description, sample.newcomerTip || null, userIds.get(sample.host),
                 sample.group ? groupIds.get(sample.group) : null]
            );
            const eventId = result.rows[0].id;

            for (const tag of sample.tags) {
                await client.query('INSERT INTO event_tags (event_id, tag) VALUES ($1, $2)', [eventId, tag]);
            }
            for (const username of sample.going) {
                await client.query(
                    `INSERT INTO event_attendees (event_id, user_id, status) VALUES ($1, $2, 'going')`,
                    [eventId, userIds.get(username)]
                );
            }
            const when = startsAt.toLocaleString('en-US', {
                timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
            });
            console.log(`  ${when.padEnd(24)} ${sample.title}`);
        }
        await client.query('COMMIT');
        console.log(`Saved ${SAMPLE_GROUPS.length} sample groups and ${SAMPLE_EVENTS.length} sample events` +
            `${replaced ? ` (replaced ${replaced} older event copies)` : ''}.`);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const main = async () => {
    if (!connectionString) {
        console.error('DATABASE_URL is not set. Set it to your database\'s connection string first.');
        process.exitCode = 1;
        return;
    }
    try {
        if (process.argv.includes('--remove')) {
            const client = await pool.connect();
            try {
                const events = await deleteSampleEvents(client);
                const groups = await deleteSampleGroups(client);
                console.log(`Removed ${events} sample events and ${groups} sample groups.`);
            } finally {
                client.release();
            }
        } else {
            await seedSampleEvents();
        }
    } catch (error) {
        if (error.code === 'MISSING_USERS') {
            console.error(error.message);
        } else if (error.code === '42P01') {
            // 42P01 is Postgres' "table does not exist" code
            console.error('Tables are missing. Start server.js once so it creates them, then run this again.');
        } else {
            console.error('Could not save sample events:', error.message);
        }
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
};

main();
