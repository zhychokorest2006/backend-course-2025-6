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

// ===== 1. Налаштування CLI параметрів =====
const program = new Command();
program
  .requiredOption("--host <host>", "Server host")
  .requiredOption("--port <port>", "Server port")
  .requiredOption("--cache <path>", "Cache directory path");
program.parse();
const args = program.opts();

const HOST = args.host;
const PORT = Number(args.port);
const CACHE = path.resolve(args.cache);

// Створюємо папку для фото, якщо немає
if (!fs.existsSync(CACHE)) {
  fs.mkdirSync(CACHE, { recursive: true });
}

const app = express();

// ===== 2. Middleware =====
app.use(express.json());
// Важливо для обробки даних з HTML-форм (search)
app.use(express.urlencoded({ extended: true }));

// "База даних" в оперативній пам'яті
let db = [];
let nextId = 1;

// Налаштування завантаження файлів
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, CACHE),
  filename: (_, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const upload = multer({ storage });

// ===== 3. Swagger Документація =====
const swaggerDoc = {
  openapi: "3.0.0",
  info: { title: "Inventory API", version: "1.0.0", description: "Lab 6 API" },
  servers: [{ url: `http://${HOST}:${PORT}` }],
  paths: {
    "/inventory": {
      get: { summary: "Get all items", responses: { 200: { description: "List of items" } } }
    },
    "/inventory/{id}": {
      get: {
        summary: "Get item by ID",
        parameters: [{ in: "path", name: "id", required: true, schema: { type: "integer" } }],
        responses: { 200: { description: "Found" }, 404: { description: "Not found" } }
      },
      delete: {
        summary: "Delete item",
        parameters: [{ in: "path", name: "id", required: true, schema: { type: "integer" } }],
        responses: { 200: { description: "Deleted" } }
      }
    },
    "/register": {
      post: {
        summary: "Register new item",
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  inventory_name: { type: "string" },
                  description: { type: "string" },
                  photo: { type: "string", format: "binary" }
                }
              }
            }
          }
        },
        responses: { 201: { description: "Created" } }
      }
    },
    "/search": {
      post: {
        summary: "Search item by ID",
        requestBody: {
          content: {
            "application/x-www-form-urlencoded": {
              schema: {
                type: "object",
                properties: {
                  id: { type: "integer" },
                  has_photo: { type: "string", description: "Send 'on' to include photo link" }
                }
              }
            }
          },
        },
        responses: { 200: { description: "Found" }, 404: { description: "Not found" } }
      }
    }
  }
};

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDoc));

// ===== 4. HTML Форми (Статика) =====
app.get("/RegisterForm.html", (_, res) => {
    const filePath = path.join(__dirname, "RegisterForm.html");
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.status(404).send("File RegisterForm.html not found");
});

app.get("/SearchForm.html", (_, res) => {
    const filePath = path.join(__dirname, "SearchForm.html");
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.status(404).send("File SearchForm.html not found");
});

// ===== 5. API Методи =====

// GET /inventory - Отримати список (з готовими посиланнями)
app.get("/inventory", (req, res) => {
  const responseList = db.map(item => {
    const itemCopy = { ...item };
    if (itemCopy.photo) {
      itemCopy.photo = `http://${HOST}:${PORT}/inventory/${item.id}/photo`;
    }
    return itemCopy;
  });
  res.json(responseList);
});

// GET /inventory/:id - Отримати один товар
app.get("/inventory/:id", (req, res) => {
  const item = db.find(x => x.id == req.params.id);
  if (!item) return res.status(404).json({ error: "not found" });

  const responseItem = { ...item };
  if (responseItem.photo) {
    responseItem.photo = `http://${HOST}:${PORT}/inventory/${item.id}/photo`;
  }
  res.json(responseItem);
});

// GET /inventory/:id/photo - Скачати файл фото
app.get("/inventory/:id/photo", (req, res) => {
  const item = db.find(x => x.id == req.params.id);
  if (!item || !item.photo) return res.status(404).json({ error: "no photo associated" });

  const filePath = path.join(CACHE, item.photo);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "file missing on server" });

  res.sendFile(filePath);
});

// POST /register - Створити товар
app.post("/register", upload.single("photo"), (req, res) => {
  if (!req.body.inventory_name) {
    return res.status(400).json({ error: "inventory_name required" });
  }

  const item = {
    id: nextId++,
    name: req.body.inventory_name,
    description: req.body.description || "",
    // У базі зберігаємо лише фізичне ім'я файлу
    photo: req.file ? req.file.filename : null 
  };

  db.push(item);

  // Для відповіді формуємо красивий об'єкт з посиланням
  const responseItem = { ...item };
  if (responseItem.photo) {
    responseItem.photo = `http://${HOST}:${PORT}/inventory/${item.id}/photo`;
  }

  res.status(201).json(responseItem);
});

// PUT /inventory/:id - Оновити дані
app.put("/inventory/:id", (req, res) => {
  const item = db.find(x => x.id == req.params.id);
  if (!item) return res.status(404).json({ error: "not found" });

  if (req.body.name) item.name = req.body.name;
  if (req.body.description) item.description = req.body.description;

  res.json(item);
});

// PUT /inventory/:id/photo - Оновити фото
app.put("/inventory/:id/photo", upload.single("photo"), (req, res) => {
  const item = db.find(x => x.id == req.params.id);
  if (!item) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "no file uploaded" });

  if (item.photo) {
    const oldPath = path.join(CACHE, item.photo);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  item.photo = req.file.filename;
  res.json({ ok: true, photo: `http://${HOST}:${PORT}/inventory/${item.id}/photo` });
});

// DELETE /inventory/:id - Видалити товар
app.delete("/inventory/:id", (req, res) => {
  const index = db.findIndex(x => x.id == req.params.id);
  if (index === -1) return res.status(404).json({ error: "not found" });

  const item = db[index];
  if (item.photo) {
    const filePath = path.join(CACHE, item.photo);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  db.splice(index, 1);
  res.json({ ok: true, message: "Item deleted" });
});

// ===== POST /search (ЗМІНЕНО) =====
app.post("/search", (req, res) => {
  const id = req.body.id;
  const hasPhotoVal = req.body.has_photo;

  // Шукаємо в базі
  const item = db.find(x => x.id == id);
  if (!item) {
    return res.status(404).json({ error: "Not Found" });
  }

  // Перевіряємо чи хоче користувач фото
  // "on" - це стандарт для checkbox, "" - якщо в Postman порожнє Value
  const wantsPhoto = hasPhotoVal === "on" || hasPhotoVal === "true" || hasPhotoVal === "";

  // Формуємо об'єкт відповіді
  const response = {
    id: item.id,
    name: item.name,
    description: item.description,
    photo: null // За замовчуванням null
  };

  // Якщо просили фото і воно є фізично
  if (wantsPhoto && item.photo) {
    // Додаємо в ОКРЕМЕ поле, а не в опис
    response.photo = `http://${HOST}:${PORT}/inventory/${item.id}/photo`;
  }

  res.json(response);
});

// 404 Handler
app.use((req, res) => {
  res.status(404).send("Route not found");
});

// ===== 6. Запуск сервера =====
http.createServer(app).listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
  console.log(`Swagger Docs at http://${HOST}:${PORT}/docs`);
});