/** Parse ACS GET DATA (FF CA 00 00 00) transmit response into hex UID. */
export function parseUidFromTransmit(data: Uint8Array | Buffer): string | null {
  if (data.length < 3) return null;
  const sw1 = data[data.length - 2];
  const sw2 = data[data.length - 1];
  if (sw1 !== 0x90 || sw2 !== 0x00) return null;
  const uid = data.subarray(0, data.length - 2);
  if (uid.length === 0) return null;
  return Buffer.from(uid).toString("hex").toUpperCase();
}
