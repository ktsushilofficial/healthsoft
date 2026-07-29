export type ParsedPillDispenserCode = {
  deviceSn: string;
  model: string | null;
};

function cleanCode(value: string): string {
  return value.trim().replace(/^DN\s*:\s*/i, '');
}

function validateDeviceSn(value: string): string {
  const normalized = cleanCode(value);
  if (
    normalized.length < 6 ||
    normalized.length > 80 ||
    !/^[a-z0-9._-]+$/i.test(normalized)
  ) {
    throw new Error('Enter the DN code printed beside the dispenser QR code.');
  }
  return normalized;
}

export function parsePillDispenserCode(input: string): ParsedPillDispenserCode {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Enter or scan the dispenser DN code.');
  }

  const dnMatch = trimmed.match(/[?&]dn=([^&#\s]+)/i);
  if (!dnMatch) {
    return {
      deviceSn: validateDeviceSn(trimmed),
      model: null,
    };
  }

  const modelMatch = trimmed.match(/[?&]model=([^&#\s]+)/i);
  return {
    deviceSn: validateDeviceSn(decodeURIComponent(dnMatch[1])),
    model: modelMatch ? decodeURIComponent(modelMatch[1]).trim() || null : null,
  };
}
