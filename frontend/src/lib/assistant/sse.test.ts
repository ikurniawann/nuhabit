import { describe, expect, it } from "vitest";
import { extractSseData, readOpenAiDelta, splitSseEvents } from "./sse";

describe("splitSseEvents", () => {
  it("memisahkan event utuh dan menyisakan potongan terakhir", () => {
    const { events, rest } = splitSseEvents("data: a\n\ndata: b\n\ndata: cse");
    expect(events).toEqual(["data: a", "data: b"]);
    expect(rest).toBe("data: cse");
  });

  it("mengembalikan seluruh buffer sebagai sisa bila belum ada event utuh", () => {
    const { events, rest } = splitSseEvents("data: setengah");
    expect(events).toEqual([]);
    expect(rest).toBe("data: setengah");
  });

  it("event yang berakhir tepat di batas tidak menyisakan apa pun", () => {
    const { events, rest } = splitSseEvents("data: a\n\n");
    expect(events).toEqual(["data: a"]);
    expect(rest).toBe("");
  });

  it("menyatukan event yang terbelah antar dua chunk", () => {
    // Inilah kasus yang bikin jawaban terpotong kalau sisa buffer dibuang.
    const first = splitSseEvents('data: {"x":1');
    const second = splitSseEvents(first.rest + '}\n\n');
    expect(second.events).toEqual(['data: {"x":1}']);
  });
});

describe("extractSseData", () => {
  it("mengambil isi baris data", () => {
    expect(extractSseData("data: halo")).toEqual(["halo"]);
  });

  it("mengabaikan baris non-data seperti komentar keep-alive", () => {
    expect(extractSseData(": ping\ndata: halo")).toEqual(["halo"]);
  });

  it("mendukung lebih dari satu baris data dalam satu event", () => {
    expect(extractSseData("data: satu\ndata: dua")).toEqual(["satu", "dua"]);
  });

  it("melewati baris data kosong", () => {
    expect(extractSseData("data: \ndata: isi")).toEqual(["isi"]);
  });
});

describe("readOpenAiDelta", () => {
  it("mengambil potongan teks", () => {
    expect(readOpenAiDelta('{"choices":[{"delta":{"content":"Ha"}}]}')).toBe("Ha");
  });

  it("mengembalikan null untuk penanda selesai", () => {
    expect(readOpenAiDelta("[DONE]")).toBeNull();
  });

  it("mengembalikan null untuk delta tanpa konten (mis. delta role pertama)", () => {
    expect(readOpenAiDelta('{"choices":[{"delta":{"role":"assistant"}}]}')).toBeNull();
  });

  it("tidak melempar saat payload rusak", () => {
    expect(readOpenAiDelta('{"choices":')).toBeNull();
  });
});
