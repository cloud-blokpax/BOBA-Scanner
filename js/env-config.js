'use strict';

const Joi = require('joi');

// Environment variable schema
const envSchema = Joi.object({
    NODE_ENV: Joi.string().valid('development', 'production', 'test').required(),
    PORT: Joi.number().integer().default(3000),
    DATABASE_URL: Joi.string().uri().required(),
    API_KEY: Joi.string().required(),
}).unknown();

// Validate environment variables
const { error, value: envVars } = envSchema.validate(process.env);

if (error) {
    console.error('Invalid environment variables:', error.details);
    process.exit(1);
}

module.exports = envVars;