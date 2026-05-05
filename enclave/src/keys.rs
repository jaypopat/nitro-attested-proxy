use std::sync::OnceLock;

use hpke::aead::AesGcm256;
use hpke::kdf::HkdfSha256;
use hpke::kem::X25519HkdfSha256;
use hpke::{Deserializable, Kem, OpModeR, Serializable, setup_receiver};
use rand_core::OsRng;

// RFC 9180 suite 0x0020 / 0x0001 / 0x0002. Matches our TS client (also uses hpke and same cipher suite)
type Aead = AesGcm256;
type Kdf = HkdfSha256;
type KemAlgo = X25519HkdfSha256;
type PrivateKey = <KemAlgo as Kem>::PrivateKey;
type EncappedKey = <KemAlgo as Kem>::EncappedKey;

struct EnclaveKeys {
    sk: PrivateKey,
    pk_bytes: [u8; 32],
}

static KEYS: OnceLock<EnclaveKeys> = OnceLock::new();

pub fn init() {
    KEYS.get_or_init(|| {
        let (sk, pk) = KemAlgo::gen_keypair(&mut OsRng);
        let pk_bytes = pk
            .to_bytes()
            .as_slice()
            .try_into()
            .expect("X25519 pubkey is 32 bytes");
        EnclaveKeys { sk, pk_bytes }
    });
}

pub fn public_key_bytes() -> [u8; 32] {
    KEYS.get().expect("keys::init not called").pk_bytes
}

pub struct Opened {
    pub plaintext: Vec<u8>,
    pub response_key: [u8; 32],
    pub response_nonce: [u8; 12],
}

pub fn open_and_export_response(
    enc_bytes: &[u8],
    ciphertext: &[u8],
    info: &[u8],
    response_key_label: &[u8],
    response_nonce_label: &[u8],
) -> Result<Opened, hpke::HpkeError> {
    let sk = &KEYS.get().expect("keys::init not called").sk;
    let enc = EncappedKey::from_bytes(enc_bytes)?;
    let mut ctx = setup_receiver::<Aead, Kdf, KemAlgo>(&OpModeR::Base, sk, &enc, info)?;
    let plaintext = ctx.open(ciphertext, &[])?;

    let mut response_key = [0u8; 32];
    let mut response_nonce = [0u8; 12];
    ctx.export(response_key_label, &mut response_key)?;
    ctx.export(response_nonce_label, &mut response_nonce)?;

    Ok(Opened {
        plaintext,
        response_key,
        response_nonce,
    })
}

#[cfg(test)]
mod tests {
    use hpke::{OpModeS, setup_sender};

    use super::*;

    const INFO: &[u8] = b"attested-proxy/v1 test";
    const KEY_LABEL: &[u8] = b"resp key";
    const NONCE_LABEL: &[u8] = b"resp nonce";

    // Mirrors the full client→enclave→client crypto round-trip:
    // sender seals → receiver opens → both export the same response material.
    #[test]
    fn hpke_round_trip_and_export() {
        let (sk, pk) = KemAlgo::gen_keypair(&mut OsRng);

        let (enc, mut sender) =
            setup_sender::<Aead, Kdf, KemAlgo, _>(&OpModeS::Base, &pk, INFO, &mut OsRng).unwrap();
        let ct = sender.seal(b"hello world", &[]).unwrap();

        // Receiver setup mirrors `open_and_export_response` but doesn't use
        // the singleton — direct call to setup_receiver with the local sk.
        let mut receiver =
            setup_receiver::<Aead, Kdf, KemAlgo>(&OpModeR::Base, &sk, &enc, INFO).unwrap();
        let pt = receiver.open(&ct, &[]).unwrap();
        assert_eq!(pt.as_slice(), b"hello world");

        // Both sides should export the same response key + nonce material.
        let mut sender_key = [0u8; 32];
        let mut sender_nonce = [0u8; 12];
        let mut receiver_key = [0u8; 32];
        let mut receiver_nonce = [0u8; 12];
        sender.export(KEY_LABEL, &mut sender_key).unwrap();
        sender.export(NONCE_LABEL, &mut sender_nonce).unwrap();
        receiver.export(KEY_LABEL, &mut receiver_key).unwrap();
        receiver.export(NONCE_LABEL, &mut receiver_nonce).unwrap();
        assert_eq!(sender_key, receiver_key);
        assert_eq!(sender_nonce, receiver_nonce);
    }
}
