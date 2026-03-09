import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import multer from "multer";
import sqlite3pkg from "sqlite3";
import { fileURLToPath } from "url";

const sqlite3 = sqlite3pkg.verbose();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Static hosting
app.use(express.static("public"));
app.use("/src", express.static("src"));
app.use("/assets", express.static("assets"));

const uploadsDir = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use("/uploads", express.static(uploadsDir));

// GraphHopper Proxy
const GH_BASE = "http://localhost:8989";

app.post("/api/route", async (req, res) => {
  try {
    const ghResp = await fetch(`${GH_BASE}/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    // forward status + content-type
    res.status(ghResp.status);
    const ct = ghResp.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);

    const buf = Buffer.from(await ghResp.arrayBuffer());
    res.send(buf);
  } catch (e) {
    res.status(502).json({ error: "GraphHopper unreachable", detail: String(e) });
  }
});

app.get("/api/info", async (req, res) => {
  try {
    const ghResp = await fetch(`${GH_BASE}/info`);
    res.status(ghResp.status);

    const ct = ghResp.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);

    const buf = Buffer.from(await ghResp.arrayBuffer());
    res.send(buf);
  } catch (e) {
    res.status(502).json({ error: "GraphHopper unreachable", detail: String(e) });
  }
});

// -----------------------------
// SQLite database
// -----------------------------
const dbPath = path.join(__dirname, "database.sqlite");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Database connection failed:", err.message);
  } else {
    console.log("Connected to SQLite database.");
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS spatial_barriers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barrier_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      description TEXT,
      image_path TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT,
      rating INTEGER NOT NULL,
      comments TEXT,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// -----------------------------
// File upload config
// -----------------------------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeName = String(file.originalname || "upload").replace(/\s+/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({ storage });

// -----------------------------
// Barrier APIs
// -----------------------------
app.post("/api/barriers", upload.single("photo"), (req, res) => {
  const { lat, lng, type, severity, description } = req.body;
  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

  if (!lat || !lng || !type || !severity) {
    return res.status(400).json({ error: "lat, lng, type, and severity are required" });
  }

  const sql = `
    INSERT INTO spatial_barriers (barrier_type, severity, description, image_path, lat, lng)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  db.run(sql, [type, severity, description || "", imagePath, lat, lng], function (err) {
    if (err) {
      console.error(err.message);
      return res.status(500).json({ error: "Failed to save barrier." });
    }

    res.status(201).json({
      id: this.lastID,
      status: "pending",
      image_path: imagePath,
    });
  });
});

app.get("/api/barriers", (_req, res) => {
  db.all(
    `
    SELECT id, barrier_type, severity, description, image_path, lat, lng, status
    FROM spatial_barriers
    ORDER BY created_at DESC
    `,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.put('/api/barriers/:id/status', (req, res) => {
  const id = Number(req.params.id)
  const status = String(req.body?.status || '').trim().toLowerCase()

  const allowed = new Set(['pending', 'in_review', 'resolved'])
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid barrier id' })
  }
  if (!allowed.has(status)) {
    return res.status(400).json({ error: 'Invalid status value' })
  }

  db.run(
    `UPDATE spatial_barriers SET status = ? WHERE id = ?`,
    [status, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message })
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Barrier not found' })
      }
      res.json({ message: 'Barrier status updated.', id, status })
    }
  )
})

// Optional admin endpoint
app.get("/api/admin/data", (_req, res) => {
  db.all(`SELECT * FROM spatial_barriers ORDER BY created_at DESC`, [], (err, barriers) => {
    if (err) return res.status(500).json({ error: err.message });

    db.all(`SELECT * FROM user_feedback ORDER BY submitted_at DESC`, [], (err2, feedback) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ barriers, feedback });
    });
  });
});

// -----------------------------
// Feedback API
// -----------------------------
app.post("/api/feedback", (req, res) => {
  const { name, rating, comment } = req.body;

  if (!rating) {
    return res.status(400).json({ error: "rating is required" });
  }

  db.run(
    `INSERT INTO user_feedback (user_name, rating, comments) VALUES (?, ?, ?)`,
    [name || "", rating, comment || ""],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ message: "Feedback received." });
    }
  );
});

app.listen(5173, "localhost", () => {
  console.log("App: http://localhost:5173");
});