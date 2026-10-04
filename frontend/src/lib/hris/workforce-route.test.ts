import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("./workforce-auth", () => ({ getWorkforceActor: vi.fn() }));

const { ApiError } = await import("@/lib/api/auth");
const { parseInput, readJson, requireUuid, unwrap, unwrapSingle } = await import("./workforce-route");

const jsonRequest = (body: string) => new Request("http://x", { method: "POST", body });

describe("requireUuid", () => {
  it("UUID lolos, selain itu 400 dengan pesan route", () => {
    expect(requireUuid("00000000-0000-0000-0000-000000000001")).toBe("00000000-0000-0000-0000-000000000001");
    expect(() => requireUuid("abc", "ID kontrak tidak valid")).toThrow("ID kontrak tidak valid");
  });
});

describe("readJson / parseInput", () => {
  const schema = z.object({ name: z.string().min(1, "Nama wajib diisi") });

  it("body bukan JSON → 400", async () => {
    await expect(readJson(jsonRequest("bukan-json"), schema)).rejects.toMatchObject({ status: 400 });
  });

  it("pesan issue pertama dipakai bila tanpa pesan khusus", async () => {
    await expect(readJson(jsonRequest('{"name":""}'), schema)).rejects.toMatchObject({
      status: 400,
      message: "Nama wajib diisi",
    });
  });

  it("pesan khusus menimpa, issue tetap di details", () => {
    try {
      parseInput(schema, {}, "Validation failed");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as InstanceType<typeof ApiError>).message).toBe("Validation failed");
      expect(Array.isArray((error as InstanceType<typeof ApiError>).details)).toBe(true);
    }
  });
});

describe("unwrap / unwrapSingle", () => {
  it("galat query dilempar dengan kode Postgres", () => {
    expect(() => unwrap({ data: null, error: { message: "dup", code: "23505" } })).toThrow(
      expect.objectContaining({ code: "23505" })
    );
  });
  it("tidak ada baris → 404", () => {
    expect(() =>
      unwrapSingle({ data: null, error: { message: "No rows", code: "PGRST116" } }, "Tidak ada")
    ).toThrow(expect.objectContaining({ status: 404, message: "Tidak ada" }));
    expect(unwrapSingle({ data: { id: 1 }, error: null }, "x")).toEqual({ id: 1 });
  });
});
