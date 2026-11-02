use reqwest::{Client, StatusCode};
use std::{sync::OnceLock, time::Duration};

pub fn client() -> Result<Client, String> {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client.clone());
    }
    let client = Client::builder()
        .user_agent("Lumaire/0.1 (desktop music player)")
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;
    let _ = CLIENT.set(client.clone());
    Ok(client)
}

// Long provider cooldowns are surfaced instead of sleeping indefinitely or
// retrying earlier than requested. All retries are bounded (three attempts).
fn retry_delay(status: StatusCode, retry_after: Option<&str>, attempt: u32) -> Option<Duration> {
    if attempt >= 2 || !(status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()) {
        return None;
    }
    let seconds = match retry_after {
        Some(value) => value.parse::<u64>().ok()?,
        None => 1 << attempt,
    };
    (seconds <= 5).then(|| Duration::from_secs(seconds.max(1)))
}

pub async fn get(url: &str, params: &[(&str, String)]) -> Result<reqwest::Response, String> {
    get_with_cookie(url, params, "").await
}

pub async fn get_with_cookie(url: &str, params: &[(&str, String)], cookie: &str) -> Result<reqwest::Response, String> {
    let client = client()?;
    for attempt in 0..3 {
        let mut request = client.get(url).query(params);
        if !cookie.is_empty() { request = request.header(reqwest::header::COOKIE, cookie); }
        let response = request.send().await;
        match response {
            Ok(response) => {
                let status = response.status();
                if let Some(delay) = retry_delay(
                    status,
                    response
                        .headers()
                        .get("retry-after")
                        .and_then(|v| v.to_str().ok()),
                    attempt,
                ) {
                    eprintln!(
                        "[Provider] {} returned {}; retrying in {:?}",
                        url, status, delay
                    );
                    drop(response);
                    tokio::time::sleep(delay).await;
                    continue;
                }
                return Ok(response);
            }
            Err(error) if attempt < 2 && (error.is_timeout() || error.is_connect()) => {
                tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
            }
            Err(_) => {
                return Err(
                    "Could not reach the metadata/lyrics service. Check your connection and retry."
                        .into(),
                )
            }
        }
    }
    unreachable!()
}

/// One bounded request for optional enrichment; avoid stacking retries on the page's critical path.
pub async fn optional_json(url: &str, params: &[(&str, String)]) -> Result<serde_json::Value, String> {
    let mut response = client()?.get(url).query(params)
        .header("User-Agent", "Lumaire/1.0.5 (https://github.com/arushn47/music-player)")
        .timeout(Duration::from_secs(6)).send().await.map_err(|_| "Metadata provider timed out or could not be reached.".to_string())?;
    if !response.status().is_success() { return Err(format!("Metadata provider returned HTTP {}.", response.status())); }
    const LIMIT: usize = 2 * 1024 * 1024;
    if response.content_length().is_some_and(|length| length > LIMIT as u64) { return Err("Metadata response exceeded its limit.".into()); }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "Metadata response was interrupted.")? {
        if bytes.len() + chunk.len() > LIMIT { return Err("Metadata response exceeded its limit.".into()); }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "Metadata provider returned invalid JSON.".into())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    pub fn server(
        responses: Vec<(&'static str, String)>,
    ) -> (String, thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let mut requests = vec![];
            for (status, body) in responses {
                let (mut socket, _) = listener.accept().expect("mock provider accept failed");
                socket
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut request = vec![];
                let mut chunk = [0; 2048];
                while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                    let size = socket.read(&mut chunk).unwrap();
                    if size == 0 {
                        break;
                    }
                    request.extend_from_slice(&chunk[..size]);
                }
                if let Some(header_end) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n")
                {
                    let length = String::from_utf8_lossy(&request[..header_end])
                        .lines()
                        .find_map(|line| {
                            line.to_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|value| value.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    while request.len() < header_end + 4 + length {
                        let size = socket.read(&mut chunk).unwrap();
                        if size == 0 {
                            break;
                        }
                        request.extend_from_slice(&chunk[..size]);
                    }
                }
                requests.push(String::from_utf8_lossy(&request).into_owned());
                write!(socket, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nRetry-After: 1\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
            requests
        });
        (url, handle)
    }

    #[test]
    fn actual_http_retries_503_and_returns_success() {
        let (url, server) = server(vec![
            ("503 Service Unavailable", "{}".into()),
            ("200 OK", "{}".into()),
        ]);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        assert!(runtime
            .block_on(get(&url, &[]))
            .unwrap()
            .status()
            .is_success());
        assert_eq!(server.join().unwrap().len(), 2);
    }
    #[test]
    fn retries_transient_failures_only_and_respects_retry_after() {
        assert_eq!(
            retry_delay(StatusCode::SERVICE_UNAVAILABLE, Some("3"), 0),
            Some(Duration::from_secs(3))
        );
        assert!(retry_delay(StatusCode::TOO_MANY_REQUESTS, Some("60"), 0).is_none());
        assert!(retry_delay(StatusCode::NOT_FOUND, None, 0).is_none());
        assert!(retry_delay(StatusCode::FORBIDDEN, None, 0).is_none());
        assert!(retry_delay(StatusCode::SERVICE_UNAVAILABLE, None, 2).is_none());
    }
}
