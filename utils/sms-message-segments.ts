const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

const GSM7_EXTENDED = "^{}\\[~]|€";

function isGsm7Char(char: string): boolean {
  return GSM7_BASIC.includes(char) || GSM7_EXTENDED.includes(char);
}

export function isGsm7Message(text: string): boolean {
  for (const char of text) {
    if (!isGsm7Char(char)) {
      return false;
    }
  }
  return true;
}

export function countSmsUnits(text: string): {
  characters: number;
  encoding: "GSM-7" | "Unicode";
  singleSegmentSize: number;
  segments: number;
} {
  const characters = [...text].length;
  const gsm7 = isGsm7Message(text);
  const singleSegmentSize = gsm7 ? 160 : 70;
  const segments =
    characters === 0
      ? 0
      : Math.ceil(characters / singleSegmentSize);
  return {
    characters,
    encoding: gsm7 ? "GSM-7" : "Unicode",
    singleSegmentSize,
    segments,
  };
}
