// Fonnte WhatsApp API integration

// Endpoint resmi Fonnte. Jangan diubah ke /api/send-message — path itu 404
// dan membuat seluruh pengiriman WA gagal diam-diam.
const FONNTE_API_URL = "https://api.fonnte.com/send";

export interface FonnteMessagePayload {
  target: string; // phone number, e.g. "6281234567890"
  message: string;
  file?: string; // optional file URL
}

export interface FonnteResponse {
  success: boolean;
  message?: string;
  reason?: string;
}

export async function sendWhatsApp(
  payload: FonnteMessagePayload
): Promise<FonnteResponse> {
  const apiKey = process.env.FONNTE_API_KEY;

  if (!apiKey) {
    console.warn("FONNTE_API_KEY is not set");
    return { success: false, reason: "API key not configured" };
  }

  try {
    const response = await fetch(FONNTE_API_URL, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    return { success: data.status || response.ok, reason: data.reason };
  } catch (error) {
    return {
      success: false,
      reason: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
