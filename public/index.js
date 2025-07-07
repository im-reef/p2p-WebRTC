const signaling = new WebSocket("ws://YOUR PUBLIC ADDRESS: PORT");

const peer = new RTCPeerConnection({
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
});

let channel = peer.createDataChannel("file");
let remoteMeta = null;
let fileBuffer = [];
let bytesReceived = 0;

channel.onopen = () => {
  console.log("✅ Data channel open");
  document.getElementById("sendBtn").disabled = false;
};

channel.onmessage = async (event) => {
  if (typeof event.data === "string") {
    const msg = JSON.parse(event.data);
    if (msg.type === "file-meta") {
      remoteMeta = msg;
      fileBuffer = [];
      bytesReceived = 0;
      console.log("Receiving file:", msg.name, msg.mime);
    }
  } else {
    fileBuffer.push(event.data);
    bytesReceived += event.data.byteLength;

    // Wait until full file received
    if (bytesReceived >= remoteMeta.size) {
      const blob = new Blob(fileBuffer, { type: remoteMeta.mime });
      const url = URL.createObjectURL(blob);
      const fileName = remoteMeta.name;

      const downloadBtn = document.createElement("button");
      downloadBtn.textContent = `Download ${fileName}`;
      downloadBtn.onclick = () => {
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
      };

      document.body.appendChild(downloadBtn);

      // Clean up
      remoteMeta = null;
      fileBuffer = [];
      bytesReceived = 0;
    }
  }
};

signaling.onopen = async () => {
  console.log("📡 WebSocket connected");
  await start();
};

signaling.onmessage = async ({ data }) => {
  if (data instanceof Blob) data = await data.text();
  const msg = JSON.parse(data);

  if (msg.offer) {
    await peer.setRemoteDescription(new RTCSessionDescription(msg.offer));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    signaling.send(JSON.stringify({ answer }));
  } else if (msg.answer && peer.signalingState === "have-local-offer") {
    await peer.setRemoteDescription(new RTCSessionDescription(msg.answer));
  } else if (msg.ice) {
    try {
      await peer.addIceCandidate(msg.ice);
    } catch (e) {
      console.error("ICE Error:", e);
    }
  }
};

peer.onicecandidate = ({ candidate }) => {
  if (candidate && signaling.readyState === WebSocket.OPEN) {
    signaling.send(JSON.stringify({ ice: candidate }));
  }
};

peer.ondatachannel = (e) => {
  channel = e.channel;
  channel.onmessage = channel.onmessage;
  channel.onopen = channel.onopen;
};

async function start() {
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  signaling.send(JSON.stringify({ offer }));
}

async function sendFile() {
  const file = document.getElementById("fileInput").files[0];
  if (!file) return;

  const chunkSize = 16 * 1024; // 16KB
  const arrayBuffer = await file.arrayBuffer();
  const totalSize = arrayBuffer.byteLength;

  // Send metadata
  channel.send(JSON.stringify({
    type: "file-meta",
    name: file.name,
    mime: file.type,
    size: totalSize
  }));

  // Break into chunks
  for (let offset = 0; offset < totalSize; offset += chunkSize) {
    const chunk = arrayBuffer.slice(offset, offset + chunkSize);
    channel.send(chunk);
  }

  console.log("✅ File sent:", file.name);
}

