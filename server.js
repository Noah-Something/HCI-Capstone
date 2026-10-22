// Backend for the server, holds and manages passwords and other data
const express = require('express');
const bcrypt = require('bcrypt'); // Encrypt Usernames and Passwords using rounds of bcrypt
const crypto = require('crypto'); // Create token upon logging in
const cors = require('cors');

const app = express();

app.use(express.json());

app.use(cors({
    origin: 'http://127.0.0.1:5500',
    methods: ['POST'],
    allowedHeaders: ['Content-Type']
}))

// This function will contain access to database, currently does not do so (tentative)
const findUserInDatabase = async (username) => {
    if (username === "testUser") {
        return {
            // Password corresponds to "secretPassword", 12 rounds of hashing by bcrypt
            username: "testUser",
            hashedPassword: "$2a$12$tPPiNZHr/V8Q1fmL4UegL.rdU8d6kXgKEcs0lzQWGhRtiU7wvtIeK"
        };
    }
    return null;
};

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

app.listen(3000, () => console.log('Authentication server running on port 3000'));