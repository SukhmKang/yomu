// camera.js — Live camera via getUserMedia, with file-input fallback

const Camera = (() => {
  const MAX_DIM = 2048;

  let stream       = null;
  let facingMode   = 'environment'; // start with rear camera
  let onCaptureCb  = null;

  // ---- DOM refs (set during init) ----
  let previewEl, videoEl, shutterBtn, cancelBtn, flipBtn, fileInputEl;

  function init(callbacks) {
    previewEl  = document.getElementById('camera-preview');
    videoEl    = document.getElementById('camera-video');
    shutterBtn = document.getElementById('shutter-btn');
    cancelBtn  = document.getElementById('camera-cancel-btn');
    flipBtn    = document.getElementById('camera-flip-btn');
    fileInputEl = document.getElementById('camera-input');

    onCaptureCb = callbacks.onCapture;

    shutterBtn.addEventListener('click', capture);
    cancelBtn.addEventListener('click', close);
    flipBtn.addEventListener('click', flipCamera);
    fileInputEl.addEventListener('change', onFileSelected);
  }

  /** Open the live camera. Falls back to file picker if unavailable. */
  async function open() {
    if (!navigator.mediaDevices?.getUserMedia) {
      fileInputEl.click();
      return;
    }
    try {
      await startStream(facingMode);
      previewEl.classList.remove('hidden');
    } catch (err) {
      console.warn('getUserMedia failed, falling back to file input:', err.message);
      fileInputEl.click();
    }
  }

  async function startStream(facing) {
    stopStream();
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: facing,
        width:  { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    videoEl.srcObject = stream;
    await videoEl.play();
  }

  async function flipCamera() {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    try {
      await startStream(facingMode);
    } catch {
      // revert if the other camera isn't available
      facingMode = facingMode === 'environment' ? 'user' : 'environment';
    }
  }

  function capture() {
    if (!stream) return;

    const w = videoEl.videoWidth;
    const h = videoEl.videoHeight;
    if (!w || !h) return;

    const canvas = document.createElement('canvas');
    // Respect MAX_DIM
    const scale = Math.max(w, h) > MAX_DIM ? MAX_DIM / Math.max(w, h) : 1;
    canvas.width  = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);

    close();

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const base64  = dataUrl.split(',')[1];
    onCaptureCb({ dataUrl, base64, naturalWidth: canvas.width, naturalHeight: canvas.height });
  }

  function close() {
    stopStream();
    previewEl.classList.add('hidden');
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    videoEl.srcObject = null;
  }

  // ---- File input fallback ----
  function onFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    fileInputEl.value = '';
    processFile(file).then(onCaptureCb).catch(err => App.showToast(err.message));
  }

  function processFile(file) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) {
        reject(new Error('Please select an image file.'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read file.'));
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = () => reject(new Error('Failed to decode image.'));
        img.onload = () => {
          const scale = Math.max(img.naturalWidth, img.naturalHeight) > MAX_DIM
            ? MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight) : 1;
          const w = Math.round(img.naturalWidth  * scale);
          const h = Math.round(img.naturalHeight * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
          resolve({ dataUrl, base64: dataUrl.split(',')[1], naturalWidth: w, naturalHeight: h });
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  return { init, open };
})();
