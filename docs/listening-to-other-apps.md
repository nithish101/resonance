# Visualizing audio from other tabs and apps

Resonance can visualize music that's playing somewhere else: YouTube Music in another tab, a
desktop app like Spotify, or anything your computer is playing. Audio is analysed locally and
never leaves your browser.

## Another browser tab (Chrome, Edge, and other Chromium browsers on desktop)

1. Start the music in its tab, for example YouTube Music.
2. In Resonance, choose **Listen to another tab**.
3. In the share dialog, open the **Chrome tab** list and pick the music tab.
4. Make sure **Share tab audio** is on (it's a toggle under the preview), then click **Share**.

You keep hearing the music from its own tab; Resonance only listens. The Resonance tab needs to
stay visible to draw, but the music tab can be in the background. Click **Stop sharing** in
the browser's sharing bar (or the × in Resonance) to stop.

If you forget the **Share tab audio** toggle, Resonance says so and offers to try again. If the
shared tab is silent for a few seconds, a hint appears. Some DRM-protected players are captured
as silence by the browser.

## Everything the computer plays

- **Chrome on Windows and ChromeOS, and on macOS since Chrome 141:** choose **Listen to another
  tab**, switch to **Entire screen**, and turn on **Share system audio**.
- **Any browser, any OS:** install a loopback driver, send your system output through it, and
  pick it as Resonance's microphone input:
  - macOS: [BlackHole](https://github.com/ExistentialAudio/BlackHole). Create a Multi-Output
    Device in Audio MIDI Setup so you still hear the sound.
  - Windows: [VB-Cable](https://vb-audio.com/Cable/). Enable "Listen to this device" on the
    cable's recording side to keep hearing it.
  - Linux (PulseAudio or PipeWire): the "Monitor of …" source of your output device.

  In Resonance, choose **Microphone** once (so the browser shows device names), then pick the
  loopback device in the input list.

## Firefox and Safari

Both browsers ignore audio in screen sharing, so tab capture isn't offered. Use the loopback
method above, or the microphone.

## Why the microphone path disables voice processing

Browsers apply echo cancellation, noise suppression, and automatic gain control to microphones
by default. Those are tuned for speech and reshape a music spectrum, so Resonance turns all
three off (PRD IN-3).
