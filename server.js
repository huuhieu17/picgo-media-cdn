import async from "async";
import crypto from "crypto";
import express from "express";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import multer from "multer";
import path from "path";
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const PORT = 4444;

// Folders
const UPLOAD_DIR = path.join("./uploads");
const ORIG_DIR = path.join(UPLOAD_DIR, "original");
const HLS_DIR = path.join(UPLOAD_DIR, "hls");
[UPLOAD_DIR, ORIG_DIR, HLS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Hỗ trợ file ảnh/video
const imageExts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic"];
const videoExts = [".mp4", ".mov", ".mkv", ".avi"];

// Generate unique file name
const generateFileName = (userId, originalName) => {
  const ext = path.extname(originalName);
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString("hex");
  return `${userId}-${timestamp}-${random}${ext}`;
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ORIG_DIR),
  filename: (req, file, cb) => {
    const userId = req.body.userId || req.query.userId;
    if (!userId) return cb(new Error("userId is required"));
    cb(null, generateFileName(userId, file.originalname));
  }
});

const upload = multer({ storage }).fields([
  { name: "file", maxCount: 30 }
]);

// --- Upload chung (ảnh/video) ---
app.post("/upload", upload, (req, res) => {
  const files = req.files?.file; // mảng file
  if (!files || files.length === 0) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const results = [];

  const processFile = (file, callback) => {
    const ext = path.extname(file.filename).toLowerCase();

    // 1. Ảnh → trả URL trực tiếp
    if (imageExts.includes(ext)) {
      const fileUrl = `${file.filename}`;
      results.push({ type: "image", url: fileUrl });
      return callback();
    }

    // 2. Video → convert HLS
    if (videoExts.includes(ext)) {
      const filename = path.basename(file.filename, ext);
      const hlsFolder = path.join(HLS_DIR, filename);
      if (!fs.existsSync(hlsFolder)) fs.mkdirSync(hlsFolder);

      const hlsPath = path.join(hlsFolder, "index.m3u8");

      ffmpeg(file.path)
        .outputOptions([
          "-profile:v baseline",
          "-level 3.0",
          "-start_number 0",
          "-hls_time 10",
          "-hls_list_size 0",
          "-f hls"
        ])
        .output(hlsPath)
        .on("end", () => {
          // Xóa file gốc sau khi convert
          fs.unlink(file.path, err => {
            if (err) console.error("Failed to delete original file:", err);
          });

          const url = `${filename}/index.m3u8`;
          results.push({ type: "video", url });
          callback();
        })
        .on("error", err => {
          console.error(err);
          results.push({ type: "video", error: "Failed to convert video" });
          callback();
        })
        .run();
      return;
    }

    // 3. File không hỗ trợ → skip
    fs.unlink(file.path, () => {});
    results.push({ type: "unsupported", error: "File type not supported" });
    return callback();
  };


  async.eachSeries(files, processFile, () => {
    res.json(results);
  });
});


app.delete("/delete", (req, res) => {
  const { filename, userId } = req.body;
  if (!filename || !userId) return res.status(400).json({ error: "filename and userId required" });

  // Kiểm tra quyền: file phải bắt đầu bằng userId-
  if (!filename.startsWith(userId + "-")) return res.status(403).json({ error: "Forbidden" });

  const ext = path.extname(filename).toLowerCase();

  // Xoá ảnh
  if (imageExts.includes(ext)) {
    const filePath = path.join(ORIG_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });
    fs.unlink(filePath, err => {
      if (err) return res.status(500).json({ error: "Failed to delete file" });
      res.json({ success: true });
    });
    return;
  }

  // Xoá video HLS
  const folderName = path.basename(filename, ext);
  const hlsFolder = path.join(HLS_DIR, folderName);
  if (!fs.existsSync(hlsFolder)) return res.status(404).json({ error: "File not found" });

  fs.rm(hlsFolder, { recursive: true, force: true }, err => {
    if (err) return res.status(500).json({ error: "Failed to delete video" });
    res.json({ success: true });
  });
});

// --- Serve /view ---
app.use("/view", express.static(ORIG_DIR)); // ảnh
app.use("/view", express.static(HLS_DIR));  // video HLS

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
