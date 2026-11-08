# InkFrame Duo 🖼️✨

A self-hosted, lightweight web studio and coordination hub for cordless 7.3-inch 6-color e-paper desk frames ([Waveshare ESP32-S3-PhotoPainter](https://www.waveshare.com/esp32-s3-photopainter.htm) or [Seeed Studio reTerminal E1002](https://www.seeedstudio.com/reTerminal-E1002-p-6533.html)).

InkFrame Duo allows partners, families, or individuals to send handwritten notes, doodles, and dithered photographs directly to each other's physical wooden e-ink frames over a local network.

---

## Architecture & Key Features

- **Dual-Layer Spectra 6 Compositor (800×480)**:
  - **Background Layer**: Accepts photos and templates, applying exposure/contrast normalization and calibrated error diffusion (**Floyd-Steinberg**, **Atkinson**, or **Nearest-Neighbor**) matched against the *perceived* reflective color palette.
  - **Foreground Ink Layer**: Captures smooth handwriting strokes and text using the 6 native Spectra colors (**Black**, **White**, **Red**, **Yellow**, **Green**, **Blue**). Foreground strokes **bypass dithering** so handwriting remains razor-sharp on top of dithered photos.
  - **Dual-Palette Output**: Emits both a `preview.png` (perceived reflective colors for web browsers) and `device.png` (theoretical RGB LUT for ESP32 hardware).
- **Strict `esp32-photoframe` Wire Protocol**:
  - Serves `GET /api/frame/:deviceId` with deterministic SHA-256 `ETag` headers.
  - Returns `304 Not Modified` with an empty body when polled with a matching `If-None-Match`, preserving the frame's ~10 µA deep-sleep power budget and preventing panel flash.
  - Serves a crisp Spectra 6 onboarding welcome card on first boot before any note is sent.
  - Ingests incoming telemetry headers (`X-Battery-Percentage`, `X-Battery-Voltage`, `X-Ambient-Temperature`, `X-Ambient-Humidity`, `X-Firmware-Version`, `X-Sleep-Duration`) into SQLite.
- **Dynamic Multi-Device Configuration (`1..N` Frames)**:
  - Configurable via environment variables (`INKFRAME_DEVICES`). Supports 1, 2, or any number of frames with custom IDs, display names, and optional per-device access tokens.
- **Zero-Friction Authentication Defaults**:
  - Open by default on trusted home LANs (no tokens required). Optional Bearer tokens and web UI PIN protection can be enabled via environment variables.
- **Turnkey Docker Deployment**:
  - Single-container multi-arch (`amd64`/`arm64`) Docker container with SQLite WAL storage and built-in healthcheck.

---

## 1. Hardware & On-Device Firmware Setup

### 1.1 Hardware Requirements
- **Display Frame**: [Waveshare ESP32-S3-PhotoPainter (7.3" E6)](https://www.waveshare.com/esp32-s3-photopainter.htm) with solid-wood frame and lithium battery, or Seeed Studio reTerminal E1002.
  - Display: 7.3-inch E Ink Spectra 6 (800×480 resolution)
  - Controller: ESP32-S3-WROOM-1-N16R8 (16 MB Flash, 8 MB PSRAM)
  - RTC: PCF85063 with independent battery backup
- **USB-C Cable**: For initial firmware flashing and charging.
- **MicroSD Card (Optional)**: For offline Wi-Fi provisioning.

### 1.2 Flashing the Open-Source Firmware
The frames use the open-source [`aitjcize/esp32-photoframe`](https://github.com/aitjcize/esp32-photoframe) firmware unmodified.

#### Method A: Chrome Web Flasher (Easiest)
1. Connect the ESP32-S3 frame to your computer via USB-C.
2. Open Google Chrome or Microsoft Edge and visit the web installer link in the [`aitjcize/esp32-photoframe`](https://github.com/aitjcize/esp32-photoframe) repository.
3. Select **Waveshare PhotoPainter 7.3"** and click **Install / Flash**.
4. Select the serial port (e.g. `/dev/cu.usbmodem...` on macOS or `COMx` on Windows) and complete the flash.

#### Method B: Command-Line (`esptool.py`)
1. Download `photoframe-firmware-waveshare_photopainter_73-merged.bin` from [esp32-photoframe GitHub Releases](https://github.com/aitjcize/esp32-photoframe/releases).
2. Run:
   ```bash
   esptool.py --chip esp32s3 --port /dev/ttyUSB0 --baud 921600 write_flash 0x0 photoframe-firmware-waveshare_photopainter_73-merged.bin
   ```

---

## 2. Wi-Fi & Frame Configuration

### 2.1 Connect Frame to Your Wi-Fi
You can connect the frame using either a MicroSD card or the built-in hotspot:

- **Via MicroSD card**: Create a plain text file named `wifi.txt` in the root of the microSD card:
  ```text
  YourWiFiSSID
  YourWiFiPassword
  FrameWife
  ```
  Insert the card into the frame and power it on.
- **Via SoftAP Hotspot**:
  1. Turn on the frame. If Wi-Fi is not configured, it creates an access point named `PhotoFrame-XXXXXX`.
  2. Connect to this network on your phone or laptop.
  3. A captive portal will open (or navigate to `http://192.168.4.1/`).
  4. Select your home Wi-Fi SSID, enter the password, and save. Note the local IP assigned to the frame (e.g., `192.168.1.120`).

### 2.2 Configure Auto-Rotate URL
1. Open a browser and navigate to the frame's web interface at `http://<frame-ip>/`.
2. Go to **Settings** → **Auto Rotate**:
   - **Mode / Source**: Set to **URL** (Fetch image from URL).
   - **URL**: Enter the polling URL for this frame from your InkFrame Duo server:
     ```text
     http://<server-ip>:3000/api/frame/<deviceId>
     ```
     *(Example for Wife's frame: `http://192.168.1.50:3000/api/frame/frame-wife`)*
   - **Access Token**: Leave blank (unless you configured `FRAME_TOKEN` in your `.env`).
   - **Rotation Interval**: Set to `15 minutes` (or your preferred schedule).
3. Go to **Settings** → **General**:
   - Enable **Deep Sleep**.
   - Save settings.

> [!TIP]
> **Deep Sleep & Instant Refresh**: While in deep sleep, the frame consumes only ~10 µA. To wake the frame immediately and check for a new note without waiting for the 15-minute timer, press the physical **`KEY`** button located on the back of the wooden frame.

---

## 3. Running InkFrame Duo in Docker

### 3.1 Quick Start with Docker Compose

1. Clone this repository:
   ```bash
   git clone https://github.com/mblackman/inkframe-duo.git
   cd inkframe-duo
   ```

2. Copy the sample environment file:
   ```bash
   cp .env.example .env
   ```

3. Launch the container:
   ```bash
   docker compose up -d
   ```

4. Open `http://localhost:3000` (or `http://<your-nas-or-server-ip>:3000`) in your browser.

---

## 4. Environment Configuration (`.env`)

InkFrame Duo supports dynamic configuration of any number of frames:

```env
PORT=3000
DATA_DIR=/data

# ------------------------------------------------------------------------------
# Configured Devices (1..N Frames)
# Format: "deviceId:Display Name[:optionalToken]" (comma-separated)
# ------------------------------------------------------------------------------
# Example 1: Default 2 frames (Wife & Matt)
INKFRAME_DEVICES=frame-wife:Wife's Desk Frame,frame-matt:Matt's Desk Frame

# Example 2: 3-device household setup
# INKFRAME_DEVICES=kitchen:Kitchen Frame,office:Office Desk,bedroom:Bedroom Frame

# Example 3: Devices with individual Bearer tokens
# INKFRAME_DEVICES=frame-wife:Wife's Desk Frame:token-wife-123,frame-matt:Matt's Desk Frame:token-matt-456

# ------------------------------------------------------------------------------
# Optional Security Tokens (Leave commented for trusted LAN setup)
# ------------------------------------------------------------------------------
# FRAME_TOKEN=secret-global-token   # Requires Authorization: Bearer <token> for all frame polls
# WEB_PIN=1234                      # Requires entering PIN in Web UI before sending notes
```

---

## 5. Web Studio & Features

- **Device Coordination Grid**:
  - Live preview of the note currently on each frame.
  - Real-time battery indicator (`%` and `mV`), room temperature, and humidity.
  - Copyable Auto-Rotate URL for easy frame configuration.
  - **Simulate Frame Poll**: Simulates a physical frame waking up, sending telemetry headers, and validating `304 Not Modified` / `200 OK` caching.
- **800×480 Dual-Layer Canvas**:
  - Smooth drawing with quadratic Bézier smoothing and pressure/velocity dynamics.
  - 6 native Spectra colors + Eraser.
  - Multi-step Undo / Redo / Clear.
  - Optional background photo uploader with **Floyd-Steinberg**, **Atkinson**, or **Nearest** dithering.
  - Target selection: send to an individual frame or **All Frames** simultaneously.
- **Flipbook History**:
  - Archive of past notes with recipient badges.
  - Toggle between **Perceived Reflective Look** and **Theoretical Hardware Pixel Map**.
  - One-click **Re-Send** to cycle any past note back onto any frame.

---

## 6. Local Development & Verification

### Running Locally without Docker
Requires [Bun](https://bun.sh) (`v1.2+`):

```bash
# 1. Install dependencies
bun install

# 2. Run automated test suite
bun test

# 3. Build frontend
bun run build

# 4. Start production server
bun run start
```

For hot-reloading development:
```bash
# Terminal 1: Backend API watch mode
bun run dev:server

# Terminal 2: Vite React client
bun run dev:client
```

### Manual Verification via `curl`

1. **Verify Welcome Screen**:
   ```bash
   curl -i http://localhost:3000/api/frame/frame-wife
   # Returns: 200 OK, Content-Type: image/png, ETag: "e6-welcome-frame-wife"
   ```

2. **Verify 304 Caching**:
   ```bash
   curl -i -H 'If-None-Match: "e6-welcome-frame-wife"' http://localhost:3000/api/frame/frame-wife
   # Returns: 304 Not Modified (empty body, saves frame battery)
   ```

3. **Verify Telemetry Ingestion**:
   ```bash
   curl -i \
     -H "X-Battery-Percentage: 88" \
     -H "X-Battery-Voltage: 4.12" \
     -H "X-Ambient-Temperature: 22.4" \
     -H "X-Ambient-Humidity: 46.5" \
     http://localhost:3000/api/frame/frame-wife
   ```
   Check `http://localhost:3000/api/state` to verify telemetry is stored in SQLite.

---

## License

MIT
