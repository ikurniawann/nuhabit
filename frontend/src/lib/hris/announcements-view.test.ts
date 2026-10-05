import { describe, expect, it } from "vitest";
import {
  EMPTY_ANNOUNCEMENT_FORM,
  addTag,
  announcementFormFrom,
  announcementPayload,
  isoToLocalInput,
  localInputToIso,
  toggleId,
  validateAnnouncementForm,
  videoWatchUrl,
} from "./announcements-view";

const row = {
  title: "Libur Lebaran",
  body_html: "<p>Halo</p>",
  cover_image_url: "a.webp",
  video_provider: "youtube",
  video_id: "dQw4w9WgXcQ",
  tags: null,
  status: "published",
  is_pinned: true,
  target_scope: "department",
  department_ids: ["d1"],
  publish_at: "2026-03-01T02:30:00.000Z",
  expires_at: null,
};

// Round trips hold in any process timezone (CI runs UTC, dev machines WIB).
describe("konversi datetime-local", () => {
  it("bolak-balik ISO ↔ input lokal", () => {
    expect(localInputToIso(isoToLocalInput("2026-03-01T02:30:00.000Z"))).toBe("2026-03-01T02:30:00.000Z");
    expect(isoToLocalInput(localInputToIso("2026-03-01T02:30"))).toBe("2026-03-01T02:30");
  });

  it("kosong atau tidak valid", () => {
    expect(isoToLocalInput(null)).toBe("");
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("bukan-tanggal")).toBeNull();
  });
});

describe("announcementFormFrom", () => {
  it("membangun ulang URL video dan default daftar kosong", () => {
    const form = announcementFormFrom(row);
    expect(form.video_url).toBe("https://youtu.be/dQw4w9WgXcQ");
    expect(form.tags).toEqual([]);
    expect(form.target_scope).toBe("department");
    expect(localInputToIso(form.publish_at)).toBe(row.publish_at);
    expect(form.expires_at).toBe("");
  });

  it("URL Vimeo dan tanpa video", () => {
    expect(videoWatchUrl("vimeo", "123456789")).toBe("https://vimeo.com/123456789");
    expect(videoWatchUrl(null, null)).toBe("");
  });
});

describe("validateAnnouncementForm", () => {
  it("judul wajib", () => {
    expect(validateAnnouncementForm(EMPTY_ANNOUNCEMENT_FORM)).toBe("Judul wajib diisi");
  });

  it("URL video harus provider yang didukung", () => {
    expect(
      validateAnnouncementForm({ ...EMPTY_ANNOUNCEMENT_FORM, title: "X", video_url: "https://example.com/v" })
    ).toBe("URL video harus YouTube atau Vimeo yang valid");
  });

  it("target departemen wajib punya departemen", () => {
    expect(
      validateAnnouncementForm({ ...EMPTY_ANNOUNCEMENT_FORM, title: "X", target_scope: "department" })
    ).toBe("Pilih minimal satu departemen atau ubah target ke global");
    expect(validateAnnouncementForm({ ...EMPTY_ANNOUNCEMENT_FORM, title: "X" })).toBeNull();
  });
});

describe("announcementPayload", () => {
  it("target global mengosongkan departemen dan merapikan teks", () => {
    const payload = announcementPayload({
      ...EMPTY_ANNOUNCEMENT_FORM,
      title: " Info ",
      video_url: "  ",
      department_ids: ["d1"],
    });
    expect(payload.title).toBe("Info");
    expect(payload.video_url).toBeNull();
    expect(payload.department_ids).toEqual([]);
    expect(payload.publish_at).toBeNull();
  });
});

describe("tag & departemen", () => {
  it("addTag mengabaikan kosong dan duplikat", () => {
    expect(addTag(["Acara"], " Libur ")).toEqual(["Acara", "Libur"]);
    expect(addTag(["Acara"], "Acara")).toEqual(["Acara"]);
    expect(addTag(["Acara"], "  ")).toEqual(["Acara"]);
  });

  it("toggleId menambah dan menghapus", () => {
    expect(toggleId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleId(["a", "b"], "a")).toEqual(["b"]);
  });
});
