(function () {
  "use strict";

  // OWASP (2023) recommendation for PBKDF2-HMAC-SHA256.
  const PBKDF2_ITERATIONS = 600000;

  function randomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length));
  }

  function toBase64(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function fromBase64(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function isAvailable() {
    return Boolean(window.crypto && window.crypto.subtle);
  }

  async function deriveKey(password, salt, iterations) {
    const baseKey = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptWithKey(key, value) {
    const iv = randomBytes(12);
    const plain = new TextEncoder().encode(JSON.stringify(value));
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
    return { iv: toBase64(iv), data: toBase64(cipher) };
  }

  async function decryptWithKey(key, box) {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(box.iv) }, key, fromBase64(box.data)
    );
    return JSON.parse(new TextDecoder().decode(plain));
  }

  /** Encrypts with a fresh salt; the returned envelope carries everything needed to decrypt except the password. */
  async function encryptWithPassword(password, value) {
    const salt = randomBytes(16);
    const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
    const box = await encryptWithKey(key, value);
    return { v: 1, kdf: "PBKDF2-SHA256", iter: PBKDF2_ITERATIONS, salt: toBase64(salt), ...box };
  }

  async function keyFromEnvelope(password, envelope) {
    return deriveKey(password, fromBase64(envelope.salt), envelope.iter);
  }

  window.AppCrypto = {
    PBKDF2_ITERATIONS,
    isAvailable,
    randomBytes,
    toBase64,
    fromBase64,
    deriveKey,
    encryptWithKey,
    decryptWithKey,
    encryptWithPassword,
    keyFromEnvelope,
  };
})();
