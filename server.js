require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cloudinary = require('cloudinary').v2;

const app = express();
app.use(cors());

const port = process.env.PORT || 3000;

// Configurar Cloudinary (solo para videos)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_KEY,
  api_secret: process.env.CLOUDINARY_SECRET,
});

// Crear carpeta uploads si no existe
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Multer config
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (_, file, cb) => cb(null, uuidv4() + path.extname(file.originalname)),
});
const upload = multer({ storage });

// Función para comprimir imagen a WebP
async function compressImageToWebP(inputPath, quality = 85) {
  const outputPath = `uploads/compressed_${uuidv4()}.webp`;
  try {
    await sharp(inputPath)
      .webp({ quality })
      .resize(800, 800, { 
        fit: 'inside',
        withoutEnlargement: true 
      })
      .toFile(outputPath);
    return outputPath;
  } catch (error) {
    console.error('Error compressing image:', error);
    throw error;
  }
}

// Función para subir a ImgBB
async function uploadToImgBB(imagePath, apiKey) {
  const FormData = require('form-data');
  const fetch = require('node-fetch');
  const form = new FormData();
  form.append('image', fs.createReadStream(imagePath));

  const response = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
    method: 'POST',
    body: form
  });

  const data = await response.json();
  if (data.success) {
    return data.data.url;
  } else {
    throw new Error('Error uploading to ImgBB: ' + data.error.message);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    cloudinary: {
      configured: !!(process.env.CLOUDINARY_NAME && process.env.CLOUDINARY_KEY && process.env.CLOUDINARY_SECRET)
    }
  });
});

// Endpoint original para videos
app.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No se proporcionó archivo de video' });
  }

  const inputPath = req.file.path;
  const outputPath = `uploads/compressed_${uuidv4()}.mp4`;

  ffmpeg(inputPath)
    .outputOptions([
      '-vf',
      'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2'
    ])
    .fps(30)
    .videoBitrate('800k')
    .output(outputPath)
    .on('end', async () => {
      try {
        const result = await cloudinary.uploader.upload(outputPath, {
          resource_type: 'video',
          folder: 'seami_compressed',
        });
        
        // Limpiar archivos temporales
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);
        
        res.json({ success: true, videoUrl: result.secure_url });
      } catch (error) {
        console.error('Error al subir a Cloudinary:', error);
        
        // Limpiar archivos temporales en caso de error
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        
        res.status(500).json({ success: false, error: 'Error al subir a Cloudinary: ' + error.message });
      }
    })
    .on('error', err => {
      console.error('Error al comprimir el video:', err);
      
      // Limpiar archivo temporal
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      
      res.status(500).json({ success: false, error: 'Error al comprimir el video: ' + err.message });
    })
    .run();
});

// Nuevo endpoint para comprimir imágenes y subirlas a ImgBB
app.post('/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se proporcionó archivo de imagen' });
    }

    const inputPath = req.file.path;
    const fileExtension = path.extname(req.file.originalname).toLowerCase();
    const imgbbApiKey = '10be477c62336a10f1d1151961458302'; // Tu API key de ImgBB

    // Verificar que sea una imagen
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp'];
    if (!allowedExtensions.includes(fileExtension)) {
      fs.unlinkSync(inputPath);
      return res.status(400).json({ 
        success: false, 
        error: 'Formato no soportado. Solo imágenes.' 
      });
    }

    // Comprimir imagen a WebP
    const compressedPath = await compressImageToWebP(inputPath, 85);

    // Subir a ImgBB
    const imageUrl = await uploadToImgBB(compressedPath, imgbbApiKey);

    // Limpiar archivos temporales
    fs.unlinkSync(inputPath);
    fs.unlinkSync(compressedPath);

    res.json({ 
      success: true, 
      imageUrl: imageUrl,
      originalFormat: fileExtension,
      compressedFormat: 'webp'
    });
  } catch (error) {
    console.error('Error processing image:', error);
    
    // Limpiar archivos temporales
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Error al procesar la imagen: ' + error.message 
    });
  }
});

app.listen(port, () => {
  console.log(`🚀 Servidor backend escuchando en http://localhost:${port}`);
  console.log(`📦 Cloudinary configurado: ${!!(process.env.CLOUDINARY_NAME && process.env.CLOUDINARY_KEY)}`);
});
