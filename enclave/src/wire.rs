use std::io::Write;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use serde::{Deserialize, Serialize};

// JSONL framing: one record per connection
//
//   request:  {"mode":"attest","nonce":"<b64-32B>"}
//             {"mode":"send","enc":"<b64-32B>","ct":"<b64>"}
//   response: {"ok":"<b64>"} | {"error":"<msg>","code":"<symbol>"}

#[derive(Deserialize)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum Request {
    Attest { nonce: String },
    Send { enc: String, ct: String },
}

pub mod codes {
    pub const INVALID_REQUEST: &str = "invalid_request";
    pub const BAD_NONCE: &str = "bad_nonce";
    pub const NSM_ERROR: &str = "nsm_error";
    pub const BAD_ENC: &str = "bad_enc";
    pub const BAD_CIPHERTEXT: &str = "bad_ciphertext";
    pub const HPKE_OPEN_FAILED: &str = "hpke_open_failed";
    pub const UPSTREAM_FAILED: &str = "upstream_failed";
}

#[derive(Serialize)]
struct Ok<'a> {
    ok: &'a str,
}

#[derive(Serialize)]
struct Err<'a> {
    error: &'a str,
    code: &'a str,
}

pub fn write_ok<W: Write>(writer: &mut W, bytes: &[u8]) -> std::io::Result<()> {
    let body = Ok {
        ok: &B64.encode(bytes),
    };
    let line = serde_json::to_string(&body).expect("serialize ok envelope");
    writer.write_all(line.as_bytes())?;
    writer.write_all(b"\n")
}

pub fn write_err<W: Write>(writer: &mut W, code: &str, error: &str) -> std::io::Result<()> {
    let body = Err { error, code };
    let line = serde_json::to_string(&body).expect("serialize err envelope");
    writer.write_all(line.as_bytes())?;
    writer.write_all(b"\n")
}

pub fn decode_b64(s: &str) -> Result<Vec<u8>, base64::DecodeError> {
    B64.decode(s)
}
