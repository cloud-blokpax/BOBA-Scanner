// env-config.js
// This file is designed to manage environment variables securely.

const dotenv = require('dotenv');

dotenv.config();

module.exports = {
    DB_URI: process.env.DB_URI,
    API_KEY: process.env.API_KEY,
    // Add any other environment variables needed
};