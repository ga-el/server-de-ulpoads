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

// Endpoint original para videos
app.post('/upload', upload.single('video'), async (req, res) => {
  const inputPath = req.file.path;
  const outputPath = `compressed_${uuidv4()}.mp4`;

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

// Nuevo endpoint para comprimir imágenes y subirlas a ImgBB
app.post('/upload-image', upload.single('image'), async (req, res) => {
  try {
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
  console.log(`Servidor escuchando en http://localhost:${port}`);
});