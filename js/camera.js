export class CameraController {
  constructor(videoElement, onStatus = () => {}) {
    this.video = videoElement;
    this.onStatus = onStatus;
    this.stream = null;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access requires a supported browser and a secure HTTPS connection.");
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.onStatus("Camera preview is active. Scene understanding is not available in this prototype.");
  }

  stop() {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }
}
