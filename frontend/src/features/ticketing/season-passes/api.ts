import type {
  IssuePassValues,
  IssuedPassResult,
  IssuedPassRow,
  PassGateResult,
  PassOption,
} from "./types";

async function parseError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    message = body.error ?? body.message ?? fallback;
  } catch {
    // body bukan JSON
  }
  throw new Error(message);
}

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) await parseError(res, fallback);
  return ((await res.json()) as { data: T }).data;
}

export const fetchPassOptions = () =>
  getJson<PassOption[]>(
    "/api/ticketing/season-passes/pass-options",
    "Gagal memuat produk pass"
  );

export const fetchPasses = (q: string) =>
  getJson<IssuedPassRow[]>(
    `/api/ticketing/season-passes?q=${encodeURIComponent(q)}`,
    "Gagal memuat daftar pass"
  );

export const issuePass = async (
  values: IssuePassValues
): Promise<IssuedPassResult> => {
  const res = await fetch("/api/ticketing/season-passes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) await parseError(res, "Gagal menerbitkan pass");
  return ((await res.json()) as { data: IssuedPassResult }).data;
};

export const renewPass = async (
  id: string
): Promise<{ id: string; valid_until: string; quota_reset: boolean }> => {
  const res = await fetch(`/api/ticketing/season-passes/${id}/renew`, {
    method: "POST",
  });
  if (!res.ok) await parseError(res, "Gagal memperpanjang pass");
  return (
    (await res.json()) as {
      data: { id: string; valid_until: string; quota_reset: boolean };
    }
  ).data;
};

export const passGateTap = async (
  code: string,
  gateLabel?: string
): Promise<PassGateResult> => {
  const res = await fetch("/api/ticketing/gate/pass-tap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, gate_label: gateLabel }),
  });
  if (!res.ok) await parseError(res, "Gagal memproses scan pass");
  return ((await res.json()) as { data: PassGateResult }).data;
};
