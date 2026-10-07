const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST || "postgres",
  port: 5432,
  user: process.env.DB_USER || "appuser",
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "appdb",
});

async function initDb(retries = 20) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS tasks (
           id SERIAL PRIMARY KEY,
           title TEXT NOT NULL,
           created_at TIMESTAMP DEFAULT NOW()
         )`
      );
      console.log("Database ready");
      return;
    } catch (err) {
      console.log(`DB not ready (${i}/${retries}): ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  console.error("Could not connect to database, exiting");
  process.exit(1);
}

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.get("/api/tasks", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM tasks ORDER BY id DESC");
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/tasks", async (req, res) => {
  const title = (req.body.title || "").trim();
  if (!title) return res.status(400).json({ error: "title required" });
  try {
    const { rows } = await pool.query(
      "INSERT INTO tasks(title) VALUES($1) RETURNING *",
      [title]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/tasks/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM tasks WHERE id=$1", [req.params.id]);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

initDb().then(() => app.listen(3000, () => console.log("Backend on :3000")));
