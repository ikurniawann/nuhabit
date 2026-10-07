export type ParsedBridgeMessage =
  | { kind: "card"; uid: string }
  | { kind: "reader"; name: string }
  | { kind: "ignore" };

export function parseBridgeMessage(data: unknown): ParsedBridgeMessage {
  if (typeof data !== "string") {
    return { kind: "ignore" };
  }

  try {
    const parsed = JSON.parse(data) as { type?: unknown; uid?: unknown; name?: unknown };

    if ((parsed.type === "card" || parsed.type === "scan") && typeof parsed.uid === "string") {
      return { kind: "card", uid: parsed.uid };
    }

    if (parsed.type === "reader" && typeof parsed.name === "string") {
      return { kind: "reader", name: parsed.name };
    }
  } catch {
    return { kind: "ignore" };
  }

  return { kind: "ignore" };
}
