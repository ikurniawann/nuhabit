import { describe, expect, it } from "vitest";
import { pickDrawnAnswers, sanitizeQuestions, toMcqAnswerKey, toPapiOptions } from "./psikotes-runner";

describe("sanitizeQuestions", () => {
  it("MCQ: hanya key & teks opsi, tanpa kunci", () => {
    const [q] = sanitizeQuestions("mcq", [
      { id: "q1", body: "2+2?", options: [{ key: "a", text: "4", correct: true }] },
    ]);
    expect(q).toEqual({ id: "q1", body: "2+2?", options: [{ key: "a", text: "4" }] });
  });

  it("PAPI: teks pasangan tanpa kode skala", () => {
    const [q] = sanitizeQuestions("forced_choice", [
      { id: "p1", body: "", options: { a: { text: "Saya rajin", scale: "N" }, b: { text: "Saya tenang", scale: "E" } } },
    ]);
    expect(q.options).toEqual({ a: { text: "Saya rajin" }, b: { text: "Saya tenang" } });
  });

  it("opsi rusak jadi kosong, bukan crash", () => {
    expect(sanitizeQuestions("mcq", [{ id: "q", body: "x", options: null }])[0].options).toEqual([]);
    expect(sanitizeQuestions("forced_choice", [{ id: "p", body: "", options: null }])[0].options).toEqual({
      a: { text: "" },
      b: { text: "" },
    });
  });
});

describe("narrowing jsonb", () => {
  it("toMcqAnswerKey", () => {
    expect(toMcqAnswerKey({ correct: "b" })).toEqual({ correct: "b" });
    expect(toMcqAnswerKey({ correct: 2 })).toBeNull();
    expect(toMcqAnswerKey(null)).toBeNull();
  });

  it("toPapiOptions", () => {
    expect(toPapiOptions({ a: { scale: "N", text: "x" }, b: { scale: "G" } })).toEqual({
      a: { scale: "N" },
      b: { scale: "G" },
    });
    expect(toPapiOptions({ a: { scale: "N" } })).toBeNull();
  });
});

it("pickDrawnAnswers membuang soal di luar undian", () => {
  const test = { answers: { question_ids: ["q1", "q2"] } };
  expect(pickDrawnAnswers(test, { q1: "a", q9: "b" })).toEqual({ q1: "a" });
  expect(pickDrawnAnswers({ answers: null }, { q1: "a" })).toEqual({});
});
