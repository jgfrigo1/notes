const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = './data';
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');

// Middleware
app.use(express.json());
app.use(cors({
    origin: ['http://localhost:3000', 'https://yourdomain.github.io'], // Add your GitHub Pages URL
    credentials: true
}));

// Ensure data directory exists
async function ensureDataDir() {
    try {
        await fs.access(DATA_DIR);
    } catch {
        await fs.mkdir(DATA_DIR, { recursive: true });
    }
}

// Load notes from file
async function loadNotes(userId) {
    try {
        const data = await fs.readFile(NOTES_FILE, 'utf8');
        const allNotes = JSON.parse(data);
        return allNotes[userId] || { notes: [], timestamp: new Date().toISOString() };
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { notes: [], timestamp: new Date().toISOString() };
        }
        throw error;
    }
}

// Save notes to file
async function saveNotes(userId, userData) {
    try {
        let allNotes = {};
        try {
            const data = await fs.readFile(NOTES_FILE, 'utf8');
            allNotes = JSON.parse(data);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
        
        allNotes[userId] = {
            ...userData,
            timestamp: new Date().toISOString()
        };
        
        await fs.writeFile(NOTES_FILE, JSON.stringify(allNotes, null, 2));
        return allNotes[userId];
    } catch (error) {
        console.error('Error saving notes:', error);
        throw error;
    }
}

// Generate user ID from password (simple approach)
function generateUserId(password) {
    return crypto.createHash('sha256').update(password).digest('hex').substring(0, 16);
}

// Verify token and extract user info
function verifyToken(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('Invalid authorization header');
    }
    
    const token = authHeader.substring(7);
    try {
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        const [password, timestamp] = decoded.split(':');
        
        // Simple validation - in production, use proper JWT tokens
        if (!password || !timestamp) {
            throw new Error('Invalid token format');
        }
        
        // Token should not be older than 24 hours
        const tokenTime = new Date(parseInt(timestamp));
        const now = new Date();
        if (now - tokenTime > 24 * 60 * 60 * 1000) {
            throw new Error('Token expired');
        }
        
        return {
            userId: generateUserId(password),
            password
        };
    } catch (error) {
        throw new Error('Invalid token');
    }
}

// Routes

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Sync notes
app.post('/sync-notes', async (req, res) => {
    try {
        const { notes, timestamp } = req.body;
        
        // Verify authorization
        const { userId } = verifyToken(req.headers.authorization);
        
        if (!Array.isArray(notes)) {
            return res.status(400).json({ error: 'Notes must be an array' });
        }
        
        // Load existing notes
        const existingData = await loadNotes(userId);
        
        let responseData;
        
        if (timestamp && new Date(timestamp) <= new Date(existingData.timestamp)) {
            // Client data is older or same, return server data
            responseData = existingData;
        } else {
            // Client data is newer, save it
            responseData = await saveNotes(userId, { notes, timestamp });
        }
        
        res.json(responseData);
        
    } catch (error) {
        console.error('Sync error:', error);
        if (error.message.includes('Invalid') || error.message.includes('expired')) {
            res.status(401).json({ error: error.message });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// Get notes (alternative endpoint)
app.get('/notes', async (req, res) => {
    try {
        const { userId } = verifyToken(req.headers.authorization);
        const data = await loadNotes(userId);
        res.json(data);
    } catch (error) {
        console.error('Get notes error:', error);
        if (error.message.includes('Invalid') || error.message.includes('expired')) {
            res.status(401).json({ error: error.message });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// Save notes (alternative endpoint)
app.post('/notes', async (req, res) => {
    try {
        const { notes } = req.body;
        const { userId } = verifyToken(req.headers.authorization);
        
        if (!Array.isArray(notes)) {
            return res.status(400).json({ error: 'Notes must be an array' });
        }
        
        const savedData = await saveNotes(userId, { notes });
        res.json(savedData);
        
    } catch (error) {
        console.error('Save notes error:', error);
        if (error.message.includes('Invalid') || error.message.includes('expired')) {
            res.status(401).json({ error: error.message });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function startServer() {
    try {
        await ensureDataDir();
        app.listen(PORT, () => {
            console.log(`🚀 Notes backend server running on port ${PORT}`);
            console.log(`📁 Data stored in: ${path.resolve(DATA_DIR)}`);
            console.log(`🌐 Health check: http://localhost:${PORT}/health`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();