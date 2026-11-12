import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { DialogPresence } from "./dialog-presence";

function EditDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const [draft, setDraft] = useState(name);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>Edit {name}</DialogTitle>
        <input aria-label="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
      </DialogContent>
    </Dialog>
  );
}

function Page() {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <>
      <button onClick={() => setEditing("Ana")}>open</button>
      <button onClick={() => setEditing(null)}>close</button>
      <DialogPresence value={editing}>
        {(editing) => <EditDialog name={editing} onClose={() => setEditing(null)} />}
      </DialogPresence>
    </>
  );
}

describe("DialogPresence", () => {
  it("keeps the last value while the exit animation runs, then unmounts", async () => {
    let finishExit = () => {};
    const exit = new Promise<void>((resolve) => (finishExit = resolve));
    const spy = vi.fn(() => [{ finished: exit } as unknown as Animation]);
    Element.prototype.getAnimations = spy;
    try {
      render(<Page />);
      fireEvent.click(screen.getByText("open"));
      expect(screen.getByRole("dialog")).toHaveTextContent("Edit Ana");

      fireEvent.click(screen.getByText("close"));
      await waitFor(() => expect(screen.getByRole("dialog")).toHaveAttribute("data-closed"));
      expect(screen.getByRole("dialog")).toHaveTextContent("Edit Ana");

      finishExit();
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    } finally {
      delete (Element.prototype as { getAnimations?: unknown }).getAnimations;
    }
  });

  it("mounts a fresh instance on reopen", async () => {
    render(<Page />);
    fireEvent.click(screen.getByText("open"));
    fireEvent.change(screen.getByLabelText("draft"), { target: { value: "changed" } });
    fireEvent.click(screen.getByText("close"));
    fireEvent.click(screen.getByText("open"));
    await waitFor(() => expect(screen.getByLabelText("draft")).toHaveValue("Ana"));
  });

  it("closes on Escape through the caller's onClose", async () => {
    render(<Page />);
    fireEvent.click(screen.getByText("open"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
