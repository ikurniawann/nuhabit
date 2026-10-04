"use client";

import { PencilIcon, TrashIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";

interface MasterTableActionsProps {
  onEdit: () => void;
  onDelete: () => void;
}

export function MasterTableActions({ onEdit, onDelete }: MasterTableActionsProps) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onEdit}
        className="h-8 w-8 p-0 text-gray-600 hover:bg-gray-100 hover:text-pink-600"
        aria-label="Edit"
      >
        <PencilIcon className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onDelete}
        className="h-8 w-8 p-0 text-red-500 hover:bg-red-50 hover:text-red-600"
        aria-label="Hapus"
      >
        <TrashIcon className="h-4 w-4" />
      </Button>
    </div>
  );
}
