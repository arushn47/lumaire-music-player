//! Read-only, process-scoped output capture. Never changes the playback device or stream.
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::ipc::Channel;
static GENERATION: AtomicU64 = AtomicU64::new(0);

#[cfg_attr(target_os = "android", allow(dead_code))]
fn waveform(samples: &[f32]) -> [f32; 24] {
    std::array::from_fn(|index| {
        let start = index * samples.len() / 24;
        let end = (index + 1) * samples.len() / 24;
        let slice = &samples[start..end];
        if slice.is_empty() { return 0.0; }
        let power = slice.iter().map(|sample| if sample.is_finite() { sample * sample } else { 0.0 }).sum::<f32>() / slice.len() as f32;
        (power.sqrt() * 3.0).clamp(0.0, 1.0)
    })
}

#[tauri::command]
pub async fn start_audio_analysis(webview: tauri::WebviewWindow, on_frame: Channel<[f32; 24]>) -> Result<(), String> {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    #[cfg(windows)]
    {
        let (send, receive) = tokio::sync::oneshot::channel();
        webview.with_webview(move |view| {
            let result = unsafe {
                let mut pid = 0;
                view.controller().CoreWebView2().and_then(|browser| browser.BrowserProcessId(&mut pid)).map(|_| pid).map_err(|error| error.to_string())
            };
            let _ = send.send(result);
        }).map_err(|error| error.to_string())?;
        let pid = tokio::time::timeout(std::time::Duration::from_secs(2), receive).await.map_err(|_| "WebView audio process lookup timed out")?.map_err(|error| error.to_string())??;
        if pid == 0 { return Err("WebView audio process is unavailable".into()); }
        return tauri::async_runtime::spawn_blocking(move || windows_capture::capture_process(generation, pid, move |frame| on_frame.send(frame).is_ok())).await.map_err(|error| error.to_string())?;
    }
    #[cfg(not(windows))]
    { let _ = (generation, webview, on_frame); Err("Native output analysis is available on Windows only.".into()) }
}

#[tauri::command]
pub fn stop_audio_analysis() { GENERATION.fetch_add(1, Ordering::SeqCst); }

#[cfg(windows)]
mod windows_capture {
    use super::*;
    use std::{collections::VecDeque, mem::{size_of, ManuallyDrop}, sync::mpsc, time::{Duration, Instant}};
    use windows::{core::{implement, Interface, Ref, HRESULT}, Win32::{Foundation::{CloseHandle, HANDLE}, Media::Audio::*, System::{Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED, BLOB, StructuredStorage::{PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0}}, Threading::{CreateEventW, WaitForSingleObject}, Variant::VT_BLOB}}};

    #[implement(IActivateAudioInterfaceCompletionHandler)]
    struct Activated { ready: mpsc::Sender<()>, params: Box<AUDIOCLIENT_ACTIVATION_PARAMS> }
    impl IActivateAudioInterfaceCompletionHandler_Impl for Activated_Impl {
        fn ActivateCompleted(&self, _: Ref<IActivateAudioInterfaceAsyncOperation>) -> windows::core::Result<()> { let _ = self.ready.send(()); Ok(()) }
    }
    struct Com;
    impl Drop for Com { fn drop(&mut self) { unsafe { CoUninitialize(); } } }
    struct Event(HANDLE);
    impl Drop for Event { fn drop(&mut self) { unsafe { let _ = CloseHandle(self.0); } } }
    struct Started(IAudioClient);
    impl Drop for Started { fn drop(&mut self) { unsafe { let _ = self.0.Stop(); } } }

    #[cfg(test)]
    pub fn capture(generation: u64, emit: impl FnMut([f32; 24]) -> bool) -> Result<(), String> {
        capture_process(generation, std::process::id(), emit)
    }
    pub fn capture_process(generation: u64, pid: u32, emit: impl FnMut([f32; 24]) -> bool) -> Result<(), String> {
        unsafe { run(generation, pid, emit).map_err(|error| format!("Windows audio analysis is unavailable: {error}")) }
    }
    unsafe fn run(generation: u64, pid: u32, mut emit: impl FnMut([f32; 24]) -> bool) -> windows::core::Result<()> {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
        let _com = Com;
        let activation = Box::new(AUDIOCLIENT_ACTIVATION_PARAMS {
            ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
            Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 { ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                // WebView2's audio service belongs to its browser process group, not the host's audio session.
                TargetProcessId: pid, ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            } },
        });
        let (send, receive) = mpsc::channel();
        let handler = Activated { ready: send, params: activation };
        // The blob borrows handler-owned memory; PROPVARIANT's automatic clear must not free it.
        let params = ManuallyDrop::new(PROPVARIANT { Anonymous: PROPVARIANT_0 { Anonymous: ManuallyDrop::new(PROPVARIANT_0_0 {
            vt: VT_BLOB, Anonymous: PROPVARIANT_0_0_0 { blob: BLOB { cbSize: size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32, pBlobData: handler.params.as_ref() as *const _ as *mut u8 } }, ..Default::default()
        }) } });
        let completed: IActivateAudioInterfaceCompletionHandler = handler.into();
        let operation = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, &IAudioClient::IID, Some(&*params), &completed)?;
        receive.recv_timeout(Duration::from_secs(5)).map_err(|_| windows::core::Error::from_hresult(HRESULT(0x800705B4u32 as i32)))?;
        let mut status = HRESULT(0); let mut unknown = None;
        operation.GetActivateResult(&mut status, &mut unknown)?; status.ok()?;
        let client: IAudioClient = unknown.ok_or_else(windows::core::Error::from_thread)?.cast()?;
        let format = WAVEFORMATEX { wFormatTag: 1, nChannels: 2, nSamplesPerSec: 44100, nAvgBytesPerSec: 176400, nBlockAlign: 4, wBitsPerSample: 16, cbSize: 0 };
        client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, 0, 0, &format, None)?;
        let event = Event(CreateEventW(None, false, false, None)?);
        client.SetEventHandle(event.0)?;
        let capture: IAudioCaptureClient = client.GetService()?;
        client.Start()?; let _started = Started(client);
        let mut samples = VecDeque::from(vec![0.0f32; 1024]);
        let mut last_frame = Instant::now(); let mut last_packet = Instant::now();
        while GENERATION.load(Ordering::SeqCst) == generation {
            let _ = WaitForSingleObject(event.0, 40);
            while capture.GetNextPacketSize()? > 0 {
                let mut data = std::ptr::null_mut(); let mut frames = 0; let mut flags = 0;
                capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None)?;
                if frames > 44100 * 2 { capture.ReleaseBuffer(frames)?; return Err(windows::core::Error::from_hresult(HRESULT(0x80004005u32 as i32))); }
                let silent = flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null();
                for index in 0..frames as usize {
                    let sample = if silent { 0.0 } else {
                        let offset = index * 4;
                        let left = std::ptr::read_unaligned(data.add(offset) as *const i16) as f32;
                        let right = std::ptr::read_unaligned(data.add(offset + 2) as *const i16) as f32;
                        left.abs().max(right.abs()) / 32768.0
                    };
                    if samples.len() == 1024 { samples.pop_front(); } samples.push_back(sample);
                }
                capture.ReleaseBuffer(frames)?;
                last_packet = Instant::now();
            }
            if last_frame.elapsed() >= Duration::from_millis(34) {
                let levels = if last_packet.elapsed() >= Duration::from_millis(100) { [0.0; 24] } else { waveform(samples.make_contiguous()) };
                if !emit(levels) { break; }
                last_frame = Instant::now();
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn waveform_is_only_measured_pcm_with_silence_and_amplitude_preserved() {
        assert_eq!(waveform(&[0.0; 1024]), [0.0; 24]);
        let quiet = waveform(&[0.05; 1024]); let loud = waveform(&[0.2; 1024]);
        assert!(loud.iter().zip(quiet).all(|(loud, quiet)| *loud > quiet));
        let mut samples = [0.0; 240]; samples[100..110].fill(0.2);
        let bands = waveform(&samples); assert!(bands[10] > 0.0); assert_eq!(bands.iter().filter(|value| **value > 0.0).count(), 1);
        assert!(waveform(&[f32::NAN; 240]).iter().all(|value| *value == 0.0));
    }
    #[cfg(windows)]
    #[test]
    #[ignore = "explicit Windows process-loopback test; plays a one-second low-volume test tone"]
    fn live_process_loopback_measures_own_output_and_returns_to_silence() {
        use std::{sync::mpsc, time::Duration};
        use windows::{core::PCWSTR, Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_MEMORY, SND_SYNC}};
        let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        let (send, receive) = mpsc::channel();
        let capture = std::thread::spawn(move || windows_capture::capture(generation, |frame| send.send(frame).is_ok()));
        let initial = receive.recv_timeout(Duration::from_secs(8)).expect("Process-loopback capture must initialize");
        let initial_peak = initial.iter().copied().fold(0.0f32, f32::max);
        println!("Initial isolated capture peak: {initial_peak}");
        assert!(initial_peak < 0.0005, "Other apps' sound must not appear in this process capture: {initial_peak}");
        let rate = 22050u32; let size = rate * 2;
        let mut wav = Vec::new(); wav.extend_from_slice(b"RIFF"); wav.extend_from_slice(&(size+36).to_le_bytes()); wav.extend_from_slice(b"WAVEfmt "); wav.extend_from_slice(&16u32.to_le_bytes()); wav.extend_from_slice(&1u16.to_le_bytes()); wav.extend_from_slice(&1u16.to_le_bytes()); wav.extend_from_slice(&rate.to_le_bytes()); wav.extend_from_slice(&(rate*2).to_le_bytes()); wav.extend_from_slice(&2u16.to_le_bytes()); wav.extend_from_slice(&16u16.to_le_bytes()); wav.extend_from_slice(b"data"); wav.extend_from_slice(&size.to_le_bytes());
        for sample in 0..rate { wav.extend_from_slice(&((sample as f32 / rate as f32 * 440.0 * std::f32::consts::TAU).sin().mul_add(150.0,0.0) as i16).to_le_bytes()); }
        struct StopTone;
        impl Drop for StopTone { fn drop(&mut self) { unsafe { let _ = PlaySoundW(PCWSTR::null(), None, SND_SYNC); } } }
        let _stop = StopTone;
        assert!(unsafe { PlaySoundW(PCWSTR(wav.as_ptr() as *const u16), None, SND_MEMORY | SND_ASYNC) }.as_bool());
        let mut peak = 0.0f32;
        for _ in 0..50 { let frame = receive.recv_timeout(Duration::from_secs(2)).unwrap(); peak = frame.into_iter().fold(peak, f32::max); }
        assert!(peak > 0.001, "Captured waveform must respond to actual process audio, got {peak}");
        let silence = receive.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(silence.iter().all(|value| *value < 0.0005));
        GENERATION.fetch_add(1, Ordering::SeqCst);
        capture.join().unwrap().unwrap();
        println!("Process-isolated PCM capture: silence → real tone (peak={peak}) → silence; clean shutdown.");
    }
}
