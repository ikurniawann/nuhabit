import { describe, expect, test } from "vitest";
import { scoreMcq, scorePapi } from "./psikotes-scoring";

const mcqQuestion = (id: string, correct: string) => ({
  id,
  answer_key: { correct },
});

const papiQuestion = (id: string, scaleA: string, scaleB: string) => ({
  id,
  options: { a: { scale: scaleA }, b: { scale: scaleB } },
});

describe("scoreMcq", () => {
  test("returns 100 when all answers are correct", () => {
    // Arrange
    const questions = [mcqQuestion("q1", "a"), mcqQuestion("q2", "c")];
    const answers = { q1: "a", q2: "c" };

    // Act
    const result = scoreMcq(questions, answers);

    // Assert
    expect(result.score).toBe(100);
    expect(result.detail.correct).toBe(2);
    expect(result.detail.total).toBe(2);
  });

  test("rounds score for partial correctness (2 of 3 = 67)", () => {
    // Arrange
    const questions = [mcqQuestion("q1", "a"), mcqQuestion("q2", "b"), mcqQuestion("q3", "c")];
    const answers = { q1: "a", q2: "b", q3: "d" };

    // Act
    const result = scoreMcq(questions, answers);

    // Assert
    expect(result.score).toBe(67);
    expect(result.detail.correct).toBe(2);
  });

  test("counts unanswered questions as wrong", () => {
    // Arrange
    const questions = [mcqQuestion("q1", "a"), mcqQuestion("q2", "b")];
    const answers = { q1: "a" };

    // Act
    const result = scoreMcq(questions, answers);

    // Assert
    expect(result.score).toBe(50);
    expect(result.detail.per_question).toEqual([
      { id: "q1", given: "a", correct_key: "a", is_correct: true },
      { id: "q2", given: null, correct_key: "b", is_correct: false },
    ]);
  });

  test("returns score 0 when question list is empty", () => {
    // Act
    const result = scoreMcq([], {});

    // Assert
    expect(result.score).toBe(0);
    expect(result.detail.total).toBe(0);
  });

  test("treats answers to unknown option keys as wrong", () => {
    // Arrange
    const questions = [mcqQuestion("q1", "a")];
    const answers = { q1: "z" };

    // Act
    const result = scoreMcq(questions, answers);

    // Assert
    expect(result.score).toBe(0);
  });

  test("skips questions without answer_key from scoring", () => {
    // Arrange
    const questions = [mcqQuestion("q1", "a"), { id: "q2", answer_key: null }];
    const answers = { q1: "a" };

    // Act
    const result = scoreMcq(questions, answers);

    // Assert — hanya q1 dinilai
    expect(result.detail.total).toBe(1);
    expect(result.score).toBe(100);
  });
});

describe("scorePapi", () => {
  test("counts chosen statement scales across all 20 scales", () => {
    // Arrange
    const questions = [
      papiQuestion("q1", "A", "G"),
      papiQuestion("q2", "A", "L"),
      papiQuestion("q3", "P", "A"),
    ];
    const answers = { q1: "a", q2: "a", q3: "b" } as const;

    // Act
    const result = scorePapi(questions, answers);

    // Assert — A dipilih 3x (q1.a, q2.a, q3.b)
    expect(result.scales.A).toBe(3);
    expect(result.scales.G).toBe(0);
    expect(result.answered).toBe(3);
    expect(result.total).toBe(3);
  });

  test("returns single dominant scale with label", () => {
    // Arrange
    const questions = [papiQuestion("q1", "A", "G"), papiQuestion("q2", "A", "L")];
    const answers = { q1: "a", q2: "a" } as const;

    // Act
    const result = scorePapi(questions, answers);

    // Assert
    expect(result.dominant).toEqual([
      { code: "A", label: "Dorongan Berprestasi", count: 2 },
    ]);
  });

  test("returns all tied scales as dominant, sorted by code", () => {
    // Arrange
    const questions = [papiQuestion("q1", "L", "G"), papiQuestion("q2", "A", "P")];
    const answers = { q1: "a", q2: "a" } as const;

    // Act
    const result = scorePapi(questions, answers);

    // Assert — A dan L sama-sama 1
    expect(result.dominant.map((d) => d.code)).toEqual(["A", "L"]);
  });

  test("ignores unanswered pairs and invalid choices", () => {
    // Arrange
    const questions = [papiQuestion("q1", "A", "G"), papiQuestion("q2", "L", "P")];
    const answers = { q1: "x" } as const;

    // Act
    const result = scorePapi(questions, answers as Record<string, string>);

    // Assert
    expect(result.answered).toBe(0);
    expect(result.dominant).toEqual([]);
  });

  test("skips pairs without options payload", () => {
    // Arrange
    const questions = [papiQuestion("q1", "A", "G"), { id: "q2", options: null }];
    const answers = { q1: "a", q2: "a" };

    // Act
    const result = scorePapi(questions, answers);

    // Assert
    expect(result.total).toBe(1);
    expect(result.scales.A).toBe(1);
  });
});
