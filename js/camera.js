export class CameraController {
  constructor(videoElement, onStatus = () => {}) {
    this.video = videoElement;
    this.onStatus = onStatus;
    this.stream = null;
    this.facingMode = "environment";
    this.zoom = 1;
    this.isDigitalZoom = true;
  }

  async start(facingMode = this.facingMode, requireFacingMode = false) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access requires a supported browser and a secure HTTPS connection.");
    }
    this.stop();
    this.facingMode = facingMode;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: requireFacingMode ? { exact: facingMode } : { ideal: facingMode } },
        audio: false
      });
      const videoTrack = this.stream.getVideoTracks()[0];
      if (!videoTrack || videoTrack.readyState !== "live") {
        throw new Error("The browser did not provide an active camera stream.");
      }
      videoTrack.addEventListener("ended", () => {
        if (this.stream?.getVideoTracks().includes(videoTrack)) this.onStatus("Camera preview ended.");
      }, { once: true });
      this.video.srcObject = this.stream;
      const actualFacingMode = videoTrack.getSettings?.().facingMode;
      if (actualFacingMode === "user" || actualFacingMode === "environment") this.facingMode = actualFacingMode;
      await this.video.play();
      if (!this.video.videoWidth) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            cleanup();
            reject(new Error("The camera opened but did not provide an image. Please try again."));
          }, 5000);
          const cleanup = () => {
            clearTimeout(timeout);
            this.video.removeEventListener("loadedmetadata", onReady);
            this.video.removeEventListener("error", onError);
          };
          const onReady = () => {
            cleanup();
            resolve();
          };
          const onError = () => {
            cleanup();
            reject(new Error("The camera stream could not be read."));
          };
          this.video.addEventListener("loadedmetadata", onReady, { once: true });
          this.video.addEventListener("error", onError, { once: true });
          if (this.video.videoWidth) onReady();
        });
      }
      await this.setZoom(this.zoom);
      this.onStatus("Camera preview is active. Scene analysis starts only when requested.");
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  async switchCamera() {
    const previousMode = this.facingMode;
    const nextMode = previousMode === "environment" ? "user" : "environment";
    try {
      await this.start(nextMode, true);
    } catch (error) {
      try {
        await this.start(previousMode, true);
      } catch (restoreError) {
        throw new Error(`Could not switch camera (${error.message}); the previous camera could not be restored (${restoreError.message}).`);
      }
      throw new Error(`Could not switch camera. The previous camera is still active: ${error.message}`);
    }
    return this.facingMode;
  }

  async setZoom(value) {
    const requestedZoom = Math.max(1, Math.min(4, Number(value) || 1));
    this.zoom = requestedZoom;
    const track = this.stream?.getVideoTracks()[0];
    const capabilities = track?.getCapabilities?.();
    const zoomCapability = capabilities?.zoom;
    this.isDigitalZoom = true;

    if (track && zoomCapability && requestedZoom >= zoomCapability.min && requestedZoom <= zoomCapability.max) {
      try {
        await track.applyConstraints({ advanced: [{ zoom: requestedZoom }] });
        this.isDigitalZoom = false;
      } catch {
        this.isDigitalZoom = true;
      }
    }

    this.video.style.transform = this.isDigitalZoom ? `scale(${this.zoom})` : "";
    return { zoom: this.zoom, isDigitalZoom: this.isDigitalZoom };
  }

  stop() {
    const stream = this.stream;
    this.stream = null;
    stream?.getTracks().forEach(track => track.stop());
    if (this.video) {
      this.video.srcObject = null;
      this.video.style.transform = "";
    }
  }
}
