// Use the OS photo picker: no persistent getUserMedia stream or repeated camera prompt.
const Camera = {
  async processFile(file) {
    if (!file.type.startsWith('image/')) throw new Error('Choose a photo or screenshot.');
    if (file.size > 30 * 1024 * 1024) throw new Error('Choose an image smaller than 30 MB.');
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      const scale = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      return { dataUrl, base64: dataUrl.split(',')[1], naturalWidth: canvas.width, naturalHeight: canvas.height };
    } catch { throw new Error('This image could not be opened. Try a JPEG, PNG, or screenshot.'); }
    finally { URL.revokeObjectURL(url); }
  },
};
