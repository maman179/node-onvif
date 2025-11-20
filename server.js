// server.js
// import express from "express";
import express from "express";
import Swal from "sweetalert2";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import expressEjsLayouts from "express-ejs-layouts";
import expressLayouts from "express-ejs-layouts";
import { body, validationResult, check} from "express-validator";
import os from "os";
import onvif from"node-onvif";
import { title } from "process";
import flash from "connect-flash";
import cookieParser from "cookie-parser";
import session from "express-session";
// import {loadCameras, findCamera, addCamera, cekDuplikat, deleteCamera, updateCameras} from './utils/cameras.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Membuat Folder Data
const dirPath='./data';
if(!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
}

// buat file contact.json jika belumada
const dataPath=`./data/cameras.json`;
if(!fs.existsSync(dataPath)) {
fs.writeFileSync(dataPath, '[ ]', 'utf-8');
}

// Folder tempat video disimpan
// const videoDir = path.join(__dirname, 'public/records');
const CAMERA_FILE = path.join(__dirname, "data/cameras.json");
const ONVIF = path.join(__dirname, "scan.json");

app.set('view engines', 'ejs');

// third party middleware
app.use(expressLayouts);

app.use(express.json());

// app.use(express.static(__dirname + "/public"));
app.use(express.static('public'));

//config flash message
app.use(cookieParser('secret'));

app.use(session({
  cookie:{maxAge: 6000 },
  secret: 'secret',
  resave: true,
  saveUninitialized:true,
}));

app.use(flash());

// 📁 Folder untuk menyimpan hasil rekaman
const RECORDS_DIR = path.join(__dirname, "records");

app.use("/videos", express.static(RECORDS_DIR));

// Pastikan folder "records" ada, kalau belum maka buat otomatis
if (!fs.existsSync(RECORDS_DIR)) {
  fs.mkdirSync(RECORDS_DIR, { recursive: true });
}
  
// Helper: load & save camera.json
function loadCameras() {
  if (!fs.existsSync(CAMERA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(CAMERA_FILE, "utf-8"));
  } catch (e) {
    console.error("❌ Gagal baca cameras.json:", e.message);
    return [];
  }
}

//ambil semua data onvif.json
const loadOnvif=()=> {
    const file=fs.readFileSync('scan.json','utf-8');
    const onvif=JSON.parse(file);
    return onvif;
};

// Fungsi untuk mencari kamera berdasarkan ID
function findCamera(id) {
  const cameras = loadCameras();
  const camera = cameras.find(cam => cam.id === id);
  return camera || null; // Kembalikan null jika tidak ditemukan
}

function findOnvif(id) {
  const cameras = loadOnvif();
  const camera = cameras.find(cam => String(cam.id) === String(id));
  return camera || null;
}


function saveCameras(cameras) {
  fs.writeFileSync(CAMERA_FILE, JSON.stringify(cameras, null, 2));
}

function saveOnvif(cameras) {
  fs.writeFileSync(ONVIF, JSON.stringify(cameras, null, 2));
}

// cek nama duplikat
const cekDuplikat=(name)=> {
const cameras=loadCameras();
return cameras.find((camera)=>camera.name===name);
}

// cek nama duplikat
const cekDuplikatip=(ip)=> {
const cameras=loadCameras();
return cameras.find((camera)=>camera.ip===ip);
}

const addCamera = (camera) => {
  const cameras = loadCameras();
  const newId = cameras.length > 0 ? String(parseInt(cameras[cameras.length - 1].id) + 1) : "1";
  camera.id = newId;
  cameras.push(camera);
  saveCameras(cameras);
};

// proses delete camera
const deleteCamera=(id)=> {
    const cameras=loadCameras();
    const filteredCameras=cameras.filter((camera)=> camera.id !==id);
    console.log(filteredCameras);
    saveCameras(filteredCameras);
};

// proses update contact
const updateCameras=(cameraBaru)=> {
    const cameras=loadCameras();
    // hilangkan contact lama yg namanya sama dengan oldNama
    const filteredCameras=cameras.filter((camera)=> camera.name !==cameraBaru.oldName);
    // console.log(filteredContacts,contactBaru);
    delete cameraBaru.oldName;
    filteredCameras.push(cameraBaru);
    saveCameras(filteredCameras);
}

// Fungsi untuk parse RTSP URL
function parseRtsp(rtspUrl) {
  try {
    const u = new URL(rtspUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    return {
      protocol: u.protocol.replace(":", ""),
      host: u.hostname,
      port: parseInt(u.port) || 554,
      path: u.pathname,
      segments: parts,
      streamType: parts[0] || null,
      streamName: parts[1] || null,
      username: u.username || null,
      password: u.password || null,
    };
  } catch (err) {
    console.warn("Gagal parse RTSP:", rtspUrl);
    return null;
  }
}

// Load cameras
const cameras = JSON.parse(fs.readFileSync(CAMERA_FILE, "utf-8"));;

// Keep maps
const ffmpegMap = {};        // ffmpeg process per camera for MJPEG
const wssMap = {};           // WebSocketServer per camera
const recordMap = {};        // ffmpeg process per camera for recording

// Start FFmpeg MJPEG per camera and WSS
function startCameraPipeline(cam) {
  if (ffmpegMap[cam.id]) return;

  // create a WebSocketServer object (no http server binding here, we will integrate upgrade)
  const wss = new WebSocketServer({ noServer: true });
  wssMap[cam.id] = wss;

  // FFmpeg args tuned for low-latency MJPEG output
  const args = [
    "-rtsp_transport", "tcp",
    "-fflags", "nobuffer",
    "-flags", "low_delay",
    "-i", cam.rtsp,
    "-an",                // drop audio
    "-f", "mjpeg",
    "-q:v", "5",
    "-r", "15",           // frame rate
    "-"                   // output to stdout
  ];

  console.log(`Start FFmpeg MJPEG for ${cam.name}: ffmpeg ${args.join(" ")}`);
  const ff = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
  ffmpegMap[cam.id] = ff;

  ff.stderr.on("data", d => {
    // optional: reduce spam by filtering
    const s = d.toString();
    if (!s.includes("frame=")) console.log(`[ffmpeg ${cam.id}]`, s.trim());
  });

  ff.on("close", (code, signal) => {
    console.log(`ffmpeg MJPEG for ${cam.name} stopped (code=${code} signal=${signal})`);
    delete ffmpegMap[cam.id];
  });

  // broadcast stdout chunks to all connected clients
  ff.stdout.on("data", chunk => {
    // chunk contains jpeg frame(s) — broadcast raw bytes
    wss.clients.forEach(client => {
      if (client.readyState === client.OPEN) {
        try { client.send(chunk); } catch(e) { /* ignore send error */ }
      }
    });
  });
}

// Start pipelines for all cameras (lazy start could be implemented)
cameras.forEach(cam => startCameraPipeline(cam));

// HTTP server and upgrade handling
const server = app.listen(PORT, () => console.log(`Server running: http://localhost:${PORT}`));

// handle upgrade for ws://localhost:3000/stream/:id
server.on("upgrade", (req, socket, head) => {
  const url = req.url || "";
  // expected url: /stream/ID
  const parts = url.split("/");
  // parts: ["", "stream", "<id>"]
  if (parts.length >= 3 && parts[1] === "stream") {
    const camId = parts[2];
    const wss = wssMap[camId];
    if (wss) {
      wss.handleUpgrade(req, socket, head, ws => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  } else {
    socket.destroy();
  }
});

// Static files
app.use(express.static(__dirname));

//
app.get("/", (req, res) => {
  const cameras=loadCameras();
  res.render('home.ejs', {
    layout:"layouts/main-layouts.ejs",
    title:"Aplikasi Camera IP",
    cameras,
    msg:req.flash('msg')
  });
})

app.get("/live", (req, res) => {
  res.render('index.ejs', {
    layout:"layouts/main-layouts.ejs",
    title:"Aplikasi Camera IP",
    cameras
  });
})

// ============================
// 🔍 Endpoint SCAN Kamera
// ============================
app.get("/scan", async (req, res) => {
  console.log("🔍 Mencari kamera ONVIF...");
  const manualCameras = loadCameras();

  try {
    const device_list = await onvif.startProbe();
    const results = [...manualCameras];

    for (const cam of device_list) {
      if (!cam.xaddrs || cam.xaddrs.length === 0) continue;

      let ipAddress = "unknown";
      const username = "admin";
      const password = "admin123";

      try {
        const parsed = new URL(cam.xaddrs[0]);
        ipAddress = parsed.hostname;
      } catch (e) {
        console.warn("⚠️ Gagal parse IP dari:", cam.xaddrs[0]);
      }

      const device = new onvif.OnvifDevice({
        xaddr: cam.xaddrs[0],
        user: username,
        pass: password,
      });

      try {
        await device.init();
        const info = device.getInformation();
        const profilesResponse = await device.services.media.getProfiles();
        const profiles = profilesResponse.data.GetProfilesResponse.Profiles;
        const profileToken = profiles[0].$.token;

        const uriResponse = await device.services.media.getStreamUri({
          ProfileToken: profileToken,
          Protocol: "RTSP",
        });

        // 🔗 Buat dua RTSP URL: rekam & preview
        const rtspRecord = `rtsp://${username}:${password}@${ipAddress}:10554/tcp/av0_1`;
        const rtspPreview = `rtsp://${username}:${password}@${ipAddress}:10554/tcp/av0_0`;

        // 🔍 Parse kedua RTSP
        const rtspParsedRecord = parseRtsp(rtspRecord);
        const rtspParsedPreview = parseRtsp(rtspPreview);

        results.push({
          id: String(results.length + 1),
          name: cam.name || "ONVIF Camera",
          ip: ipAddress,
          username,
          password,
          xaddr: cam.xaddrs[0],
          manufacturer: info.Manufacturer,
          model: info.Model,
          firmwareVersion: info.FirmwareVersion,
          serialNumber: info.SerialNumber,
          rtspRecord,
          rtspPreview,
          rtspRecordParsed: rtspParsedRecord,
          rtspPreviewParsed: rtspParsedPreview,
          url: uriResponse.data.GetStreamUriResponse.MediaUri.Uri,
        });
      } catch (e) {
        console.warn(`⚠️ Gagal ambil info untuk ${cam.xaddrs[0]}:`, e.message);
      }
    }

    // 💾 Simpan hasil ke file JSON
    fs.writeFileSync("scan.json", JSON.stringify(results, null, 2));

    // 📤 Tampilkan ke EJS
    const result = loadOnvif();
    res.render("discover.ejs", {
      layout: "layouts/main-layouts.ejs",
      title: "Aplikasi Camera IP",
      result,
    });
  } catch (err) {
    console.error("❌ Error scan:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Manual Camera
app.get('/camera/add-manual', (req, res) => {
  res.render('add-camera-manual.ejs', {
    layout: 'layouts/main-layouts.ejs',
    title: 'Add Camera',
  });
});

// proses tambah data camera
app.post('/camera/manual', [
  body('name').custom((value) => {
    const duplikat = cekDuplikat(value);
    if (duplikat) {
      throw new Error('Camera sudah ada');
    }
    return true;
  }),
  body('ip').custom((value) => {
    const duplikat = cekDuplikatip(value);
    if (duplikat) {
      throw new Error('IP camera sudah ada');
    }
    return true;
  })
  ],(req, res) => {
 const errors = validationResult(req);
  if (!errors.isEmpty()) {
   req.flash('error', 'Camera Sudah Ada');
    res.redirect('/list');
  } else {
    // 🔹 Ambil data dari form
    const { name, ip, port, username, password} = req.body;

    // 🔹 Buat format RTSP otomatis
    // const cameras = loadCameras();   
    const rtsp = `rtsp://${username}:${password}@${ip}:${port}/tcp/av0_1`;
    const rtsp1 = `rtsp://${username}:${password}@${ip}:${port}/tcp/av0_0`;
    const lastId = cameras.length > 0 ? cameras[cameras.length - 1].id || 0 : 0;

    // 🔹 Gabungkan jadi satu objek camera
    const newCamera = {name, ip, username, password, rtsp, rtsp1};

    // 🔹 Simpan data ke JSON / DB
    addCamera(newCamera);

    req.flash('msg', 'Data kamera berhasil disimpan!');
    res.redirect('/list');
  }
});

// Tambah Kamera via scan
app.get('/camera/add/:id', (req, res) => {
  
  const camera = findOnvif(req.params.id);
  console.log("📷 Hasil findOnvif:", req.params.id, camera);
  if (!camera) {
    return res.status(404).send("Camera not found");
  }
  res.render('add-camera.ejs', {
    layout: 'layouts/main-layouts.ejs',
    title: 'Add Camera',
    camera
  });
});

// proses tambah data camera
app.post('/camera', [
  body('name').custom((value) => {
    const duplikat = cekDuplikat(value);
    if (duplikat) {
      throw new Error('Camera sudah ada');
    }
    return true;
  }),
  body('ip').custom((value) => {
    const duplikat = cekDuplikatip(value);
    if (duplikat) {
      throw new Error('IP camera sudah ada');
    }
    return true;
  })
  ],(req, res) => {
 const errors = validationResult(req);
  if (!errors.isEmpty()) {
   req.flash('error', 'Camera Sudah Ada');
    res.redirect('/list');
  } else {
    // 🔹 Ambil data dari form
    const { id_camera, protocol, rec, preview, name, ip, port, username, password, SerialNumber, FirmwareVersion } = req.body;

    // 🔹 Buat format RTSP otomatis
       
    const rtsp = `${protocol}://${username}:${password}@${ip}:${port}${rec}`;
    const rtsp1 = `${protocol}://${username}:${password}@${ip}:${port}${preview}`;

    // 🔹 Gabungkan jadi satu objek camera
    const newCamera = {id_camera, name, ip, username, password, SerialNumber, FirmwareVersion, rtsp, rtsp1};

    // 🔹 Simpan data ke JSON / DB
    addCamera(newCamera);

    req.flash('msg', 'Data kamera berhasil disimpan!');
    res.redirect('/list');
  }
});

//halaman ubah data camera
app.get('/camera/edit/:id',(req,res)=>{
const camera=findCamera(req.params.id);
  res.render('edit-camera.ejs',{
    layout: 'layouts/main-layouts.ejs',
    title:'Edit Data Camera',
    camera
  });
});

//proses ubah data contact
app.post('/camera/update',[ 
  body('name').custom((value,{req}) => {
    const duplikat=cekDuplikat(value);
    if(value !== req.body.oldName && duplikat) {
      throw new Error('Nama Camera Sudah ada');
    }
    return true;
  }),
  
], (req,res)=>{
  const errors=validationResult(req);
  if(!errors.isEmpty()) {
      res.render('edit-camera.ejs', {
      title : 'Form Edit Data Camera',
      layout: 'layouts/main-layouts.ejs',
      errors: errors.array(),
      camera: req.body,
    });
  } else {
    updateCameras(req.body);
    req.flash('msg','Data Berhasil di Ubah');
    res.redirect('/list');
  }
});

// API: start recording for camera
app.get("/start-record/:id", (req, res) => {
  const id = req.params.id;
  const cam = cameras.find(c => c.id === id);
  if (!cam) return res.status(404).send("Camera not found");

  if (recordMap[id]) return res.status(400).send("Recording already running");

  const filename = `record_${id}_${Date.now()}.ts`;
  const filepath = path.join(RECORDS_DIR, filename);

  // jangan "ignore" stdin
  const args = [
    "-rtsp_transport", "tcp",
  "-i", cam.rtsp1,
  "-c:v", "copy",
  "-c:a", "aac",     // encode audio agar compatible di MP4
  "-b:a", "128k",    // bitrate audio
  "-movflags", "+faststart", // agar cepat di-play
  "-y",
  filepath
  ];

  console.log(`🎥 Start recording ${cam.name} -> ${filename}`);
  const rec = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });
  recordMap[id] = { proc: rec, file: filename, filepath };

  rec.stderr.on("data", d => {
    const line = d.toString();
    if (line.includes("frame=")) console.log(`[ffmpeg ${id}] ${line.trim()}`);
  });

  rec.on("close", (code, sig) => {
    console.log(`Recording ${cam.name} stopped (code=${code}, sig=${sig})`);
    delete recordMap[id];
  });

  res.json({ message: "Sedang merekam...", file: filename });
});

// API: stop recording
app.get("/stop-record/:id", (req, res) => {
  const id = req.params.id;
  const recObj = recordMap[id];
  if (!recObj) return res.status(400).send("Tidak ada proses rekaman");

  console.log(`🛑 Stop recording ${id}`);

  // kirim sinyal berhenti dengan aman
  try {
    recObj.proc.stdin.write('q');
  } catch (err) {
    console.error("stdin write failed:", err);
    try {
      recObj.proc.kill("SIGINT");
    } catch (e) {}
  }

  // tunggu ffmpeg selesai menulis file
  recObj.proc.on("close", () => {
    const inputFile = recObj.filepath;
    const outputFile = inputFile.replace(".ts", ".mp4");

    console.log(`🎞️ Konversi ${inputFile} → ${outputFile}`);

    const conv = spawn("ffmpeg", [
      "-i", inputFile,
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      "-y",
      outputFile
    ]);

    conv.stderr.on("data", d => console.log(`[convert] ${d.toString().trim()}`));

    conv.on("close", (code) => {
      console.log(`✅ Konversi selesai (code=${code})`);
      res.json({
        message: "Rekaman selesai dan sudah dikonversi ke MP4",
        file: path.basename(outputFile)
      });
    });
  });
});


// API: list cameras
// Endpoint API untuk ambil daftar kamera dari file JSON
app.get('/api/cameras', (req, res) => {
  try {
    if (!fs.existsSync('data/cameras.json')) {
      return res.json([]); // kalau belum ada file
    }
    const data = JSON.parse(fs.readFileSync('data/cameras.json', 'utf8'));
    res.json(data);
  } catch (err) {
    console.error('Error baca cameras.json:', err);
    res.status(500).json({ error: 'Gagal baca data kamera' });
  }
});

// API: list recordings
app.get("/api/records", (req, res) => {
  const files = fs.readdirSync(RECORDS_DIR).filter(f => f.endsWith(".mp4"));
  res.json(files);
});

app.get('/home', (req, res) => {
  const cameras=loadCameras(); 
  res.render('home.ejs',{
     layout: 'layouts/main-layouts.ejs',
     title:'Home',
     cameras,
     msg:req.flash('msg')

  });
})

// Endpoint untuk mendapatkan daftar video
app.get('/api/videos', (req, res) => {
  fs.readdir(RECORDS_DIR, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Gagal membaca folder video' });
    }
    // Filter hanya file video dengan ekstensi tertentu
    const videoFiles = files.filter(file =>
      file.endsWith('.mp4') ||
      file.endsWith('.avi') ||
      file.endsWith('.webm')
    );
    res.json(videoFiles);
  });
});

app.get('/videos', (req, res) => { 
  res.render('video.ejs',{
     layout: 'layouts/sub-layouts.ejs',
     title:'Directori Videos',
  });
})

// proses delete data camera
app.get('/camera/delete/:id',(req, res) => {
const camera=findCamera(req.params.id);
//jika kontak tida ada
if(!camera){
  res.status(404);
  res.render('404.ejs',{
  layout: 'layouts/main-layouts.ejs',
  title:'Erorr',
  status:'404',
  message:"Page Not Found"
  });
} else {
  deleteCamera(req.params.id);
  req.flash('msg','Data Berhasil dihapus');
  res.redirect('/list');
}
});

// API Download Videos
app.get("/download/:filename", (req, res) => {
  const file = req.params.filename;
  const filePath = path.join(RECORDS_DIR, file);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File tidak ditemukan" });
  }

  res.download(filePath, file, (err) => {
    if (err) {
      // Jangan kirim response kedua kali jika sudah dikirim sebelumnya
      if (!res.headersSent) {
        console.error("Gagal download:", err.message);
        return res.status(500).json({ error: "Gagal mengunduh file" });
      }
    }
  });
});


// ✅ API untuk hapus file video
app.delete("/api/videos/:filename", (req, res) => {
  const file = req.params.filename;
  const filePath = path.join(RECORDS_DIR, file);

  fs.unlink(filePath, (err) => {
    if (err) return res.status(500).json({ error: "Gagal menghapus file" });
    res.json({ message: "File berhasil dihapus" });
  });
});

app.get('/list', (req, res) => {
   const cameras=loadCameras()
   res.render('camera.ejs',{
     layout: 'layouts/main-layouts.ejs',
     title:'Daftar Kamera',
     cameras,
     msg: req.flash('msg'),
     error: req.flash('error')
  });
})

// halaman detail contact
app.get('/camera/:id', (req, res) => {
  const camera=findCamera(req.params.id);
  console.log(camera);
   res.render('detail.ejs',{
     layout: 'layouts/main-layouts.ejs',
    title:'Detail Camera',
    camera
    });
})

app.get('/about', (req, res) => {
   res.render('about.ejs',{
     layout: 'layouts/sub-layouts.ejs',
     title:'About'
  });
})

// === Ambil IP Lokal ===
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
// === START SERVER ===
app.listen(PORT, () => {
  const ip = getLocalIP();
  console.log(`🚀 Server running at:`);
  console.log(` -> http://localhost:${PORT}`);
  console.log(` -> http://${ip}:${PORT}  (🌐 akses dari HP dalam satu WiFi)`);
});

}
