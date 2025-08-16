require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cloudinary = require('cloudinary').v2;

const app = express();
app.use(cors());
const port = process.env.PORT || 3000;

// Configurar Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_KEY,
  api_secret: process.env.CLOUDINARY_SECRET,
});

// Multer config
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (_, file, cb) => cb(null, uuidv4() + path.extname(file.originalname)),
});
const upload = multer({ storage });

app.post('/upload', upload.single('video'), async (req, res) => {
  const inputPath = req.file.path;
  const outputPath = `compressed_${uuidv4()}.mp4`;

  // Comprimir video sin deformar
  ffmpeg(inputPath)
    .outputOptions([
      '-vf',
      'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2'
    ])
    .fps(30)                 // 30 fps
    .videoBitrate('800k')    // bitrate ajustado (puedes bajarlo si quieres menos peso)
    .output(outputPath)
    .on('end', async () => {
      try {
        // Subir a Cloudinary
        const result = await cloudinary.uploader.upload(outputPath, {
          resource_type: 'video',
          folder: 'seami_compressed', // opcional
        });

        // Limpiar archivos temporales
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);

        res.json({ success: true, videoUrl: result.secure_url });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al subir a Cloudinary' });
      }
    })
    .on('error', err => {
      console.error(err);
      res.status(500).json({ error: 'Error al comprimir el video' });
    })
    .run();
});

app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});