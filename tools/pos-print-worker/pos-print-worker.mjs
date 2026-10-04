#!/usr/bin/env node

const args = new Set(process.argv.slice(2));
const baseUrl = process.env.PRINT_QUEUE_BASE_URL || "http://localhost:3000";
const workerToken = process.env.POS_PRINT_WORKER_TOKEN || "";
const station = process.env.PRINT_QUEUE_STATION || "";
const intervalMs = Number(process.env.PRINT_QUEUE_INTERVAL_MS || 3000);
const once = args.has("--once");
const dryRun = args.has("--dry-run");
const sample = args.has("--sample");

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function stationLabel(value) {
  const labels = {
    kitchen: "Kitchen",
    bar: "Bar",
    bakery: "Bakery",
    dessert: "Dessert",
  };
  return labels[value] || value || "Printer";
}

function renderTicket(job) {
  const lines = [];
  const items = job.payload?.items || [];
  const orderNumber = job.order?.order_number || job.order_id?.slice(0, 8) || "ORDER";

  lines.push("================================");
  lines.push(stationLabel(job.station).toUpperCase().padStart(20, " "));
  lines.push(String(job.job_type || "ticket").toUpperCase().padStart(20, " "));
  lines.push("--------------------------------");
  lines.push(`ORDER : ${orderNumber}`);
  lines.push(`TYPE  : ${job.order?.order_type || "-"}`);
  lines.push(`TIME  : ${formatDateTime(job.requested_at)}`);
  lines.push("--------------------------------");

  if (items.length === 0) {
    lines.push("Tidak ada item.");
  } else {
    for (const item of items) {
      lines.push(`${item.quantity || 1}x ${item.product_name || "Item"}`);
      if (item.notes) lines.push(`   Note: ${item.notes}`);
    }
  }

  lines.push("--------------------------------");
  lines.push("SULU IN WOUNDERLAND POS PRINT QUEUE");
  lines.push("================================");
  return lines.join("\n");
}

async function requestJson(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (workerToken) {
    headers["x-pos-print-worker-token"] = workerToken;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });
  const json = await response.json().catch(() => ({}));

  if (!response.ok || json.success === false) {
    throw new Error(json.error || `Request failed with status ${response.status}`);
  }

  return json;
}

async function updateJob(jobId, action, error) {
  return requestJson(`/api/pos/print-jobs/${jobId}`, {
    method: "PATCH",
    body: JSON.stringify({ action, error }),
  });
}

async function pollOnce() {
  const params = new URLSearchParams({ status: "pending", limit: "20" });
  if (station) params.set("station", station);

  const json = await requestJson(`/api/pos/print-jobs?${params.toString()}`);
  const jobs = json.data || [];

  if (jobs.length === 0) {
    console.log(`[${new Date().toISOString()}] no pending print jobs`);
    return;
  }

  for (const job of jobs) {
    try {
      await updateJob(job.id, "mark_printing");
      const ticket = renderTicket(job);
      console.log(ticket);

      if (!dryRun) {
        // Adapter printer fisik bisa dipasang di sini: ESC/POS USB, network TCP, atau command vendor.
        console.log(`[${job.id}] printed by local worker mock adapter`);
      } else {
        console.log(`[${job.id}] dry-run, tidak mengirim ke printer fisik`);
      }

      await updateJob(job.id, "mark_printed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Print worker failed";
      console.error(`[${job.id}] ${message}`);
      await updateJob(job.id, "mark_failed", message).catch((patchError) => {
        console.error(`[${job.id}] failed to mark failed:`, patchError);
      });
    }
  }
}

if (sample) {
  console.log(renderTicket({
    id: "sample",
    order_id: "sample-order",
    station: station || "kitchen",
    job_type: station === "bar" ? "bar_ticket" : "kitchen_ticket",
    status: "pending",
    requested_at: new Date().toISOString(),
    order: { order_number: "POS-SAMPLE-001", order_type: "dine_in" },
    payload: {
      items: [
        { product_name: "Kentang Goreng", quantity: 1, notes: "Extra crispy" },
        { product_name: "Es Teh Manis", quantity: 2 },
      ],
    },
  }));
} else {
  if (!workerToken) {
    console.warn("POS_PRINT_WORKER_TOKEN belum diset. Worker hanya bisa jalan jika endpoint mengizinkan session browser.");
  }

  do {
    await pollOnce().catch((error) => {
      console.error(`[${new Date().toISOString()}] ${error instanceof Error ? error.message : error}`);
    });
    if (!once) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (!once);
}
