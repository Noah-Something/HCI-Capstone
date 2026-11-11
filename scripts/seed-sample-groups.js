// Creates sample groups for testing the Groups tab and hosting events on behalf of a group
//
// Run:     npm run seed-groups             (adds the sample groups, or updates them if they already exist)
// Remove:  npm run seed-groups -- --remove (deletes only the sample groups listed below)
//
// Uses DATABASE_URL, the same as server.js. The groups belong to the sample Hokies,
// so run "npm run seed" first (and start server.js once so the tables exist).
// Run this before "npm run seed-events", which hosts some of its events for these groups.
//
// Running it again updates the groups in place instead of recreating them, so their ids stay the same
// and events already hosted for them stay attached. Members who are not sample users are never touched.
const { Pool } = require('pg');

// The first admin is the group's creator. Only admins can host events for a group (like in server.js).
// Together they cover big and small groups, groups with one or two admins, a group with only its creator,
// and categories that line up with the sample events and profile interests
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
    },
    {
        name: 'Capital Crescent Cyclists', category: 'Cycling',
        description: 'Group rides on the Capital Crescent, Custis and Mount Vernon trails. No-drop, helmets required.',
        admins: ['sample_jordan'],
        members: ['sample_tyler', 'sample_ethan', 'sample_sam']
    },
    {
        name: 'Hokies on the Trail', category: 'Hiking',
        description: 'Day hikes within two hours of D.C., from Great Falls to Old Rag. We carpool from the Metro.',
        admins: ['sample_tyler'],
        members: ['sample_olivia', 'sample_lena', 'sample_chris']
    },
    {
        name: 'DC Hokie Volunteers', category: 'Volunteering',
        description: 'Ut Prosim in the D.C. area: food banks, park cleanups and mentoring, about once a month.',
        admins: ['sample_hannah'],
        members: ['sample_tyler', 'sample_priya']
    },
    {
        // Only its creator so far, for testing a brand new group
        name: 'Hokie Arts Collective', category: 'Arts & Music',
        description: 'Museum days, gallery openings and live music. Just getting started, come help plan the first outing!',
        admins: ['sample_hannah'],
        members: []
    }
];

// Render's external database URL requires SSL, a local database usually does not
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({
    connectionString,
    ssl: connectionString && connectionString.includes('render.com') ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 5000
});

// Looks up the sample users' ids, stops with a message if any are missing
const findSampleUsers = async (client) => {
    const usernames = [...new Set(SAMPLE_GROUPS.flatMap((group) => [...group.admins, ...group.members]))];
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

const seedSampleGroups = async () => {
    // All or nothing, so a failure never leaves half the samples behind
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userIds = await findSampleUsers(client);
        const sampleUserIds = [...userIds.values()];
        let created = 0;
        let updated = 0;

        for (const group of SAMPLE_GROUPS) {
            const creatorId = userIds.get(group.admins[0]);

            // Group names are unique ignoring capital letters (like in server.js)
            const existing = await client.query(
                'SELECT id, creator_id FROM groups WHERE LOWER(name) = LOWER($1)',
                [group.name]
            );
            let groupId;
            if (existing.rows.length === 0) {
                const result = await client.query(
                    'INSERT INTO groups (name, description, category, creator_id) VALUES ($1, $2, $3, $4) RETURNING id',
                    [group.name, group.description, group.category, creatorId]
                );
                groupId = result.rows[0].id;
                created += 1;
            } else if (!sampleUserIds.includes(existing.rows[0].creator_id)) {
                // A real person already made a group with this name, leave it alone
                console.log(`  Skipped: ${group.name} (a real group already uses this name)`);
                continue;
            } else {
                // Update in place, so the id (and the events hosted for it) stay the same
                groupId = existing.rows[0].id;
                await client.query(
                    'UPDATE groups SET name = $1, description = $2, category = $3, creator_id = $4 WHERE id = $5',
                    [group.name, group.description, group.category, creatorId, groupId]
                );
                updated += 1;
            }

            // Reset the sample members' memberships, but keep anyone else who joined
            const placeholders = sampleUserIds.map((_, index) => `$${index + 2}`).join(', ');
            await client.query(
                `DELETE FROM group_members WHERE group_id = $1 AND user_id IN (${placeholders})`,
                [groupId, ...sampleUserIds]
            );
            for (const [usernames, role] of [[group.admins, 'admin'], [group.members, 'member']]) {
                for (const username of usernames) {
                    await client.query(
                        'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
                        [groupId, userIds.get(username), role]
                    );
                }
            }
            const size = group.admins.length + group.members.length;
            console.log(`  ${group.name.padEnd(27)} ${group.category.padEnd(13)} ${size} ${size === 1 ? 'member' : 'members'}`);
        }
        await client.query('COMMIT');
        console.log(`Saved ${created + updated} sample groups (${created} new, ${updated} updated).`);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

// Only deletes groups with these names that a sample user created, never real groups.
// Memberships are removed too (ON DELETE CASCADE). Events hosted for these groups are kept,
// they just become hosted by the person who made them (ON DELETE SET NULL)
const removeSampleGroups = async () => {
    const names = SAMPLE_GROUPS.map((group) => group.name);
    const creators = [...new Set(SAMPLE_GROUPS.map((group) => group.admins[0]))];
    const namePlaceholders = names.map((_, index) => `$${index + 1}`).join(', ');
    const creatorPlaceholders = creators.map((_, index) => `$${names.length + index + 1}`).join(', ');
    const result = await pool.query(
        `DELETE FROM groups WHERE name IN (${namePlaceholders})
         AND creator_id IN (SELECT id FROM users WHERE username IN (${creatorPlaceholders}))`,
        [...names, ...creators]
    );
    console.log(`Removed ${result.rowCount} sample groups.`);
};

const main = async () => {
    if (!connectionString) {
        console.error('DATABASE_URL is not set. Set it to your database\'s connection string first.');
        process.exitCode = 1;
        return;
    }
    try {
        if (process.argv.includes('--remove')) {
            await removeSampleGroups();
        } else {
            await seedSampleGroups();
        }
    } catch (error) {
        if (error.code === 'MISSING_USERS') {
            console.error(error.message);
        } else if (error.code === '42P01') {
            // 42P01 is Postgres' "table does not exist" code
            console.error('Tables are missing. Start server.js once so it creates them, then run this again.');
        } else {
            console.error('Could not save sample groups:', error.message);
        }
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
};

main();
