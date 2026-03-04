const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- 1. DATABASE INITIALIZATION (SQLite) ---
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("Database connection failed:", err.message);
    else console.log("Connected to the SQLite portable database.");
});

// Create tables automatically on startup
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS spatial_barriers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barrier_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        description TEXT,
        image_path TEXT,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS user_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_name TEXT,
        rating INTEGER NOT NULL,
        comments TEXT,
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// --- 2. IMAGE UPLOAD CONFIGURATION ---
const storageEngine = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'uploads')),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const uploadManager = multer({ storage: storageEngine });

// --- 3. API ROUTES ---

// Submit a new barrier
app.post('/api/barriers', uploadManager.single('photo'), (req, res) => {
    const { lat, lng, type, severity, description } = req.body;
    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

    const sql = `INSERT INTO spatial_barriers (barrier_type, severity, description, image_path, lat, lng) 
                 VALUES (?, ?, ?, ?, ?, ?)`;
    
    db.run(sql, [type, severity, description, imagePath, lat, lng], function(err) {
        if (err) {
            console.error(err.message);
            return res.status(500).json({ error: "Failed to save barrier." });
        }
        res.status(201).json({ id: this.lastID, status: 'pending' });
    });
});

// Fetch barriers for the map
app.get('/api/barriers', (req, res) => {
    db.all(`SELECT id, barrier_type, severity, description, image_path, lat, lng, status FROM spatial_barriers`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Admin data retrieval
app.get('/api/admin/data', (req, res) => {
    db.all(`SELECT * FROM spatial_barriers ORDER BY created_at DESC`, [], (err, barriers) => {
        if (err) return res.status(500).json({ error: err.message });
        db.all(`SELECT * FROM user_feedback ORDER BY submitted_at DESC`, [], (err, feedback) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ barriers, feedback });
        });
    });
});

// User feedback
app.post('/api/feedback', (req, res) => {
    const { name, rating, comment } = req.body;
    db.run(`INSERT INTO user_feedback (user_name, rating, comments) VALUES (?, ?, ?)`, 
           [name, rating, comment], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: "Feedback received." });
    });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\nSUCCESS: UCC AccessPath Backend is running!`);
    console.log(`Maps to: http://localhost:${PORT}\n`);
});