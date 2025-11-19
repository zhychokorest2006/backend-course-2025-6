import http from "http";
import express from "express";
import multer from "multer";
import { Command } from "commander";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import swaggerUi from "swagger-ui-express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== CLI параметри =====
const program = new Command();
program
  .requiredOption("--host <host>")
  .requiredOption("--port <port>")
  .requiredOption("--cache <path>");
program.parse();
const args = program.opts();

const HOST = args.host;
const PORT = Number(args.port);
const CACHE = path.resolve(args.cache);

if (!fs.existsSync(CACHE)) {
  fs.mkdirSync(CACHE, { recursive: true });
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// "База" в пам'яті
let db = [];
let nextId = 1;

// Multer для фото
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, CACHE),
  filename: (_, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const upload = multer({ storage });

// ===== Swagger (мінімальний) =====
const swaggerDoc = {
  openapi: "3.0.0",
  info: {
    title: "Inventory API",
    version: "1.0.0",
    description: "Simple inventory service for lab 6"
  },
  paths: {
    "/inventory": {
      get: { summary: "Get all items", responses: { 200: { description: "OK" } } }
    },
    "/register": {
      post: {
        summary: "Register item",
        responses: { 201: { description: "Created" }, 400: { description: "Bad request" } }
      }
    },
    "/search": {
      post: {
        summary: "Search item by ID",
        responses: { 200: { description: "Found" }, 404: { description: "Not found" } }
      }
    }
  }
};

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDoc));

// HTML-форми
app.get("/RegisterForm.html", (_, res) => {
  res.sendFile(path.join(__dirname, "RegisterForm.html"));
});

app.get("/SearchForm.html", (_, res) => {
  res.sendFile(path.join(__dirname, "SearchForm.html"));
});

// ===== POST /register =====
app.post("/register", upload.single("photo"), (req, res) => {
  if (!req.body.inventory_name) {
    return res.status(400).json({ error: "inventory_name required" });
  }

  const item = {
    id: nextId++,
    name: req.body.inventory_name,
    description: req.body.description || "",
    photo: req.file ? req.file.filename : null
  };

  db.push(item);
  res.status(201).json(item);
});

// ===== GET /inventory =====
app.get("/inventory", (_, res) => {
  res.json(db);
});

// ===== GET /inventory/:id =====
app.get("/inventory/:id", (req, res) => {
  const item = db.find(x => x.id == req.params.id);
  if (!item) return res.status(404).json({ error: "not found" });
  res.json(item);
});

// ===== GET /inventory/:id/photo =====
app.get("/inventory/:id/photo", (req, res) => {
  const item = db.find(x => x.id == req.params.id);
  if (!item || !item.photo) {
    return res.status(404).json({ error: "no photo" });
  }

  const filePath = path.join(CACHE, item.photo);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "file missing" });
  }

  res.sendFile(filePath);
});

// ===== PUT /inventory/:id =====
app.put("/inventory/:id", (req, res) => {
  const item = db.find(x => x.id == req.params.id);
  if (!item) return res.status(404).json({ error: "not found" });

  if (req.body.name) item.name = req.body.name;
  if (req.body.description) item.description = req.body.description;

  res.json(item);
});

// ===== PUT /inventory/:id/photo =====
app.put("/inventory/:id/photo", upload.single("photo"), (req, res) => {
  const item = db.find(x => x.id == req.params.id);
  if (!item) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "no file" });

  // видалити старе фото
  if (item.photo) {
    const oldPath = path.join(CACHE, item.photo);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  item.photo = req.file.filename;
  res.json({ ok: true });
});

// ===== DELETE /inventory/:id =====
app.delete("/inventory/:id", (req, res) => {
  const index = db.findIndex(x => x.id == req.params.id);

  if (index === -1) return res.status(404).json({ error: "not found" });

  const item = db[index];

  // Видалити фото з папки
  if (item.photo) {
    const filePath = path.join(CACHE, item.photo);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  db.splice(index, 1);

  res.json({ ok: true, message: "Item and photo removed" });
});

// ===== POST /search =====
app.post("/search", (req, res) => {
  const item = db.find(x => x.id == req.body.id);
  if (!item) return res.status(404).json({ error: "not found" });

  let desc = item.description;

  if (req.body.has_photo && item.photo) {
    desc += "\nФото: /inventory/" + item.id + "/photo";
  }

  res.json({
    id: item.id,
    name: item.name,
    description: desc
  });
});

// ===== 405 CATCH-ALL =====
app.use((req, res) => {
  res.status(405).send("Method not allowed");
});

// ===== START SERVER =====
http.createServer(app).listen(PORT, HOST, () => {
  console.log("Server running at http://" + HOST + ":" + PORT);
});