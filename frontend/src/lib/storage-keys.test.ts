import { describe, expect, it } from "vitest";
import { STORAGE_KEYS, migrateStorageKey, readStorage, removeStorage, writeStorage, type StorageKey } from "./storage-keys";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

const DEF: StorageKey = { key: "nuhabit.test", legacy: "arkiv-test" };

describe("readStorage", () => {
  it("membaca kunci baru bila ada dan membiarkan kunci lama", () => {
    const storage = memoryStorage({ "nuhabit.test": "baru", "arkiv-test": "lama" });
    expect(readStorage(DEF, storage)).toBe("baru");
    expect(storage.getItem("arkiv-test")).toBe("lama");
  });

  it("jatuh ke kunci lama sekali lalu memindahkannya", () => {
    const storage = memoryStorage({ "arkiv-test": "lama" });
    expect(readStorage(DEF, storage)).toBe("lama");
    expect(storage.getItem("nuhabit.test")).toBe("lama");
    expect(storage.getItem("arkiv-test")).toBeNull();
    expect(readStorage(DEF, storage)).toBe("lama");
  });

  it("null bila keduanya kosong atau storage tidak tersedia", () => {
    expect(readStorage(DEF, memoryStorage())).toBeNull();
    expect(readStorage(DEF, null)).toBeNull();
  });

  it("tetap mengembalikan nilai lama bila penulisan migrasi gagal", () => {
    const storage = memoryStorage({ "arkiv-test": "lama" });
    storage.setItem = () => {
      throw new Error("QuotaExceeded");
    };
    expect(readStorage(DEF, storage)).toBe("lama");
  });

  it("null bila getItem melempar", () => {
    const storage = memoryStorage();
    storage.getItem = () => {
      throw new Error("SecurityError");
    };
    expect(readStorage(DEF, storage)).toBeNull();
  });
});

describe("writeStorage / removeStorage / migrateStorageKey", () => {
  it("menulis hanya ke kunci baru", () => {
    const storage = memoryStorage();
    writeStorage(DEF, "x", storage);
    expect(storage.getItem("nuhabit.test")).toBe("x");
    expect(storage.getItem("arkiv-test")).toBeNull();
  });

  it("menghapus kunci baru dan lama", () => {
    const storage = memoryStorage({ "nuhabit.test": "a", "arkiv-test": "b" });
    removeStorage(DEF, storage);
    expect(storage.length).toBe(0);
  });

  it("migrateStorageKey memindahkan nilai dan mengembalikan nama baru", () => {
    const storage = memoryStorage({ "arkiv-test": "id" });
    expect(migrateStorageKey(DEF, storage)).toBe("nuhabit.test");
    expect(storage.getItem("nuhabit.test")).toBe("id");
    expect(migrateStorageKey(DEF, null)).toBe("nuhabit.test");
  });

  it("menulis tanpa melempar saat storage menolak", () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error("QuotaExceeded");
    };
    expect(() => writeStorage(DEF, "x", storage)).not.toThrow();
  });
});

describe("STORAGE_KEYS", () => {
  it("semua kunci baru berawalan nuhabit. dan unik", () => {
    const defs = Object.values(STORAGE_KEYS);
    expect(defs.every((def) => def.key.startsWith("nuhabit."))).toBe(true);
    expect(new Set(defs.map((def) => def.key)).size).toBe(defs.length);
    expect(new Set(defs.map((def) => def.legacy)).size).toBe(defs.length);
  });
});
