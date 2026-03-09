require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;
let connectPromise = null;

async function connectMongo() {
    if (mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }

    if (!MONGODB_URI) {
        throw new Error('MONGODB_URI is missing. Add it to server/.env');
    }

    if (!connectPromise) {
        connectPromise = mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 10000,
        }).then(() => {
            console.log('[MongoDB] Connected');
            return mongoose.connection;
        }).catch((error) => {
            connectPromise = null;
            throw error;
        });
    }

    return connectPromise;
}

module.exports = { mongoose, connectMongo };

