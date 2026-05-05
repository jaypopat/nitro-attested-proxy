use std::io::{Read, Write};
use std::sync::{Arc, OnceLock};

use rustls::pki_types::ServerName;
use rustls::{ClientConfig, ClientConnection, RootCertStore, StreamOwned};
use vsock::VsockStream;

// Nitro's parent CID is 3, not the standard vsock VMADDR_CID_HOST=2.
const PARENT_CID: u32 = 3;
const PROXY_PORT: u32 = 8001;

const MAX_RESPONSE_BYTES: u64 = 1 << 20;

#[derive(Debug)]
pub enum UpstreamError {
    Io(std::io::Error),
    Tls(rustls::Error),
    InvalidServerName,
    Http(String),
}

impl std::fmt::Display for UpstreamError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "io: {e}"),
            Self::Tls(e) => write!(f, "tls: {e}"),
            Self::InvalidServerName => write!(f, "invalid server name"),
            Self::Http(s) => write!(f, "http: {s}"),
        }
    }
}

impl std::error::Error for UpstreamError {}

// rustls requires a global crypto provider before any ClientConfig::builder().
pub fn install_crypto_provider() {
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("install ring crypto provider");
}

static CLIENT_CONFIG: OnceLock<Arc<ClientConfig>> = OnceLock::new();

fn client_config() -> Arc<ClientConfig> {
    CLIENT_CONFIG
        .get_or_init(|| {
            let mut roots = RootCertStore::empty();
            roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            Arc::new(
                ClientConfig::builder()
                    .with_root_certificates(roots)
                    .with_no_client_auth(),
            )
        })
        .clone()
}

pub fn post(host: &str, path: &str, body: &[u8]) -> Result<Vec<u8>, UpstreamError> {
    let server_name =
        ServerName::try_from(host.to_owned()).map_err(|_| UpstreamError::InvalidServerName)?;

    let conn = ClientConnection::new(client_config(), server_name).map_err(UpstreamError::Tls)?;
    let sock =
        VsockStream::connect_with_cid_port(PARENT_CID, PROXY_PORT).map_err(UpstreamError::Io)?;
    let mut stream = StreamOwned::new(conn, sock);

    write!(
        stream,
        "POST {path} HTTP/1.1\r\n\
         Host: {host}\r\n\
         Content-Type: application/octet-stream\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         \r\n",
        body.len(),
    )
    .map_err(UpstreamError::Io)?;
    stream.write_all(body).map_err(UpstreamError::Io)?;

    let mut raw = Vec::new();
    // httpbin closes without TLS close_notify; rustls reports UnexpectedEof.
    match (&mut stream)
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut raw)
    {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof && !raw.is_empty() => {}
        Err(e) => return Err(UpstreamError::Io(e)),
    }
    if raw.len() as u64 > MAX_RESPONSE_BYTES {
        return Err(UpstreamError::Http(format!(
            "response exceeded {MAX_RESPONSE_BYTES}-byte cap"
        )));
    }

    let mut headers = [httparse::EMPTY_HEADER; 32];
    let mut response = httparse::Response::new(&mut headers);
    let body_offset = match response
        .parse(&raw)
        .map_err(|e| UpstreamError::Http(format!("parse: {e}")))?
    {
        httparse::Status::Complete(n) => n,
        httparse::Status::Partial => {
            return Err(UpstreamError::Http("response headers incomplete".into()));
        }
    };
    match response.code {
        Some(200..=299) => {}
        Some(code) => {
            return Err(UpstreamError::Http(format!(
                "non-2xx: {code} {}",
                response.reason.unwrap_or(""),
            )));
        }
        None => return Err(UpstreamError::Http("no status code".into())),
    }

    Ok(raw[body_offset..].to_vec())
}
