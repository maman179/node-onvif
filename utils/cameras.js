//readline
const { name } = require('ejs');
const fs=require('fs');
// const { json } = require('stream/consumers');

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

// 📁 Folder untuk menyimpan hasil rekaman
const RECORDS_DIR = path.join(__dirname, "records");

// Pastikan folder "records" ada, kalau belum maka buat otomatis
if (!fs.existsSync(RECORDS_DIR)) {
  fs.mkdirSync(RECORDS_DIR, { recursive: true });
}

//ambil semua data json
const loadCameras=()=> {
    const file=fs.readFileSync('data/cameras.json','utf-8');
    const cameras=JSON.parse(file);
    return cameras;
};

//cari ontak berdasarkan nama
const findCamera=(name)=>{
    const cameras=loadCameras();
    const camera = cameras.find((camera)=>camera.name.toLowerCase()===name.toLowerCase());
    return camera;
};

// menimpa/menuliskan file data contacts.json dgn data baru
const saveCameras=(cameras)=>{
    fs.writeFileSync('data/cameras.json', JSON.stringify(cameras));
};

//menambah data contact baru
const addCamera=(camera)=>{
    const cameras=loadCameras();// panggil file contacs.json
    cameras.push(camera); //kirim ke file contacts.json
    saveCameras(cameras);// simpan
};
// cek nama duplikat
const cekDuplikat=(name)=> {
const cameras=loadCameras();
return cameras.find((camera)=>camera.name===name);
}

// proses delete contact
const deleteCamera=(name)=> {
    const cameras=loadCameras();
    const filteredCameras=cameras.filter((camera)=> camera.name !==name);
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


module.exports={loadCameras, findCamera, addCamera, cekDuplikat, deleteCamera, updateCameras};