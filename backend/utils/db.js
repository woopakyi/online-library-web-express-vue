const { MongoClient, ObjectId } = require('mongodb');

process.env.MONGODB_URI = '';

if (!process.env.MONGODB_URI) {
    throw new Error('Please define the MONGODB_URI environment variable inside .env.local');
}

// Connect to MongoDB
async function connectToDB() {
    const client = await MongoClient.connect(process.env.MONGODB_URI);
    const db = client.db('milestoneDB');
    db.client = client;
    return db;
}

module.exports = { connectToDB, ObjectId };