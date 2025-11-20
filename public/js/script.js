  
async function init() {
  const res = await fetch("/api/cameras");
  const cams = await res.json();
  const grid = document.getElementById("grid");

  cams.forEach(cam => {
    const card = document.createElement("div");
    card.className = "cam";
    card.innerHTML = `
      <h3>${cam.name}</h3>
      <canvas id="canvas-${cam.id}"></canvas>
      <div class="controls">
        <button id="btn-preview-${cam.id}" class="btn btn-primary">Start Preview</button>
        <button id="btn-stop-${cam.id}" disabled>Stop Preview</button>
        <button id="btn-rec-${cam.id}">Start Record</button>
        <button id="btn-stoprec-${cam.id}" disabled>Stop Record</button>
        <span id="status-${cam.id}" style="margin-left:auto;color:#666;font-size:13px;"></span>
      </div>
    `;
    grid.appendChild(card);

    setupCamera(cam);
  });
}

async function scanCameras() {
      document.getElementById("cameraTable").style.display = "none";
      document.querySelector("#cameraTable tbody").innerHTML = "";
      const res = await fetch("/scan");
      const data = await res.json();

      if (data.length === 0) {
        alert("Tidak ada kamera ditemukan.");
        return;
      }

      const tbody = document.querySelector("#cameraTable tbody");
      data.forEach((cam) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${cam.name}</td>
          <td>${cam.xaddr}</td>
          <td>${cam.manufacturer}</td>
          <td>${cam.FirmwareVersion}</td>
          <td>${cam.SerialNumber}</td>
          <td>${cam.rtsp}</td>
          <td><button class="btn btn-outline-primary rounded" onclick="showCamera('${cam.rtsp}')">Tampilkan</button></td>
        `;
        tbody.appendChild(tr);
      });

      document.getElementById("cameraTable").style.display = "table";
    }

function setupCamera(cam) {
  const canvas = document.getElementById(`canvas-${cam.id}`);
  const ctx = canvas.getContext("2d");
  const btnPreview = document.getElementById(`btn-preview-${cam.id}`);
  const btnStop = document.getElementById(`btn-stop-${cam.id}`);
  const btnRec = document.getElementById(`btn-rec-${cam.id}`);
  const btnStopRec = document.getElementById(`btn-stoprec-${cam.id}`);
  const status = document.getElementById(`status-${cam.id}`);

  let ws = null;
  let animationId = null;

  // single bitmap rendering loop to avoid flicker
  async function handleFrame(arrayBuffer) {
    try {
      const blob = new Blob([arrayBuffer], { type: "image/jpeg" });
      const bitmap = await createImageBitmap(blob);
      // resize canvas only when dims change
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
    } catch (e) {
      console.error("bitmap decode err", e);
    }
  }

  function startWS() {
    if (ws) return;
    ws = new WebSocket(`ws://${location.host}/stream/${cam.id}`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      status.textContent = "Previewing";
      btnPreview.disabled = true;
      btnStop.disabled = false;
    };
    ws.onmessage = (evt) => {
      // evt.data is ArrayBuffer or Blob; we set binaryType 'arraybuffer'
      handleFrame(evt.data);
    };
    ws.onerror = (e) => {
      console.error("ws error", e);
      status.textContent = "WS error";
    };
    ws.onclose = () => {
      status.textContent = "Stopped";
      btnPreview.disabled = false;
      btnStop.disabled = true;
      ws = null;
    };
  }

  function stopWS() {
    if (!ws) return;
    ws.close();
    ws = null;
  }

  btnPreview.addEventListener("click", startWS);
  btnStop.addEventListener("click", stopWS);

  btnRec.addEventListener("click", async () => {
    try {
      const r = await fetch(`/start-record/${cam.id}`);
      // const txt = await r.text();
      status.textContent = "Recording";
      btnRec.disabled = true;
      btnStopRec.disabled = false;
      // alert(txt);
      
    Swal.fire({
      title: "Recording!",
      text: "",
      timer: 1000,
      icon: "success",
      showConfirmButton: false
    });
  
    } catch (e) { console.error(e); }
  });

  btnStopRec.addEventListener("click", async () => {
    try {
      const r = await fetch(`/stop-record/${cam.id}`);
      const txt = await r.text();
      
      status.textContent = "Recording stopped";
      btnRec.disabled = false;
      btnStopRec.disabled = true;
      // alert(txt);
      
      Swal.fire({
      title: "Record completed!",
      text: txt,
      timer:1000,
      showConfirmButton: false,
      icon: "info"
    });
    } catch (e) { console.error(e); }
  });

  // cleanup on page unload
  window.addEventListener("beforeunload", () => {
    if (ws) ws.close();
  });
}

init();
