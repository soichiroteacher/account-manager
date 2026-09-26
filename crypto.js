(function () {
  "use strict";

  // 以前の形式(version 1)のデータファイルを読むためだけの処理。
  // 2026-09-27 に「データの暗号化は原則しない」と共通ルールで決めたため、新しく暗号化して保存することはない。
  // ただし、それより前に作ったデータファイルやバックアップはパスコードで暗号化されているので、
  // それを開けるよう、復号(暗号を元に戻す)の処理だけを残している。消さないこと。
  //
  // 暗号の方式: パスコード + ソルト から PBKDF2-SHA256 で鍵を作り、AES-GCM で復号する。

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

  async function deriveKey(password, salt, iterations) {
    const baseKey = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
  }

  /** 暗号化された中身(iv と data)を復号して、元のデータに戻す。パスコードが違うとエラーになる。 */
  async function decryptWithKey(key, box) {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(box.iv) }, key, fromBase64(box.data)
    );
    return JSON.parse(new TextDecoder().decode(plain));
  }

  /** データファイルに書かれたソルトと回数を使って、パスコードから鍵を作る。 */
  async function keyFromEnvelope(password, envelope) {
    return deriveKey(password, fromBase64(envelope.salt), envelope.iter);
  }

  window.AppCrypto = {
    randomBytes,
    toBase64,
    fromBase64,
    decryptWithKey,
    keyFromEnvelope,
  };
})();
