'use client';

import { useState } from 'react';
import { MinusCircle, PlusCircle, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from '@/components/ui/dialog';
import { generateRowId } from '../product-rules';
import type { PosCatalogProduct, PosProductModifier, PosProductModifierGroup } from '../types';

const cloneGroups = (groups: PosProductModifierGroup[]) =>
  groups.map((group) => ({ ...group, modifiers: group.modifiers.map((modifier) => ({ ...modifier })) }));

/** Editor grup modifier (disimpan lokal di halaman). Render dengan key=product.id. */
export function ModifiersDialog({
  product,
  onClose,
  onSave,
}: {
  product: PosCatalogProduct;
  onClose: () => void;
  onSave: (groups: PosProductModifierGroup[]) => void;
}) {
  const [groups, setGroups] = useState(() => cloneGroups(product.modifierGroups));
  const updateGroup = (id: string, patch: Partial<PosProductModifierGroup>) =>
    setGroups((prev) => prev.map((group) => (group.id === id ? { ...group, ...patch } : group)));
  const updateModifiers = (groupId: string, fn: (modifiers: PosProductModifier[]) => PosProductModifier[]) =>
    setGroups((prev) => prev.map((group) => (group.id === groupId ? { ...group, modifiers: fn(group.modifiers) } : group)));
  const updateModifier = (groupId: string, modifierId: string, patch: Partial<PosProductModifier>) =>
    updateModifiers(groupId, (modifiers) =>
      modifiers.map((modifier) => (modifier.id === modifierId ? { ...modifier, ...patch } : modifier))
    );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelHeader>
          <DialogPanelTitle>Manage Modifier Groups</DialogPanelTitle>
          <DialogPanelDescription>{product.name}</DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="max-h-[60vh] space-y-6 overflow-y-auto">
          {groups.map((group) => (
            <div key={group.id} className="space-y-4 rounded-lg border border-gray-200/70 bg-gray-50/80 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">Group Name</label>
                    <Input value={group.name} onChange={(e) => updateGroup(group.id, { name: e.target.value })} placeholder="Sugar Level" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">Max Select</label>
                    <Input
                      type="number"
                      value={group.maxSelect}
                      onChange={(e) => updateGroup(group.id, { maxSelect: Number.parseInt(e.target.value, 10) || 1 })}
                      min="1"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">Status</label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => updateGroup(group.id, { active: !group.active })}
                      className={group.active ? 'border-green-200 text-green-700' : ''}
                    >
                      {group.active ? 'Active' : 'Inactive'}
                    </Button>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Hapus grup"
                  onClick={() => setGroups((prev) => prev.filter((item) => item.id !== group.id))}
                  className="mt-6 h-8 w-8"
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={group.required}
                  onChange={(e) => updateGroup(group.id, { required: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-pink-600"
                />
                Required (customer must select at least one)
              </label>

              <div className="space-y-2 border-l-2 border-gray-200/80 pl-4">
                <p className="text-xs uppercase tracking-wide text-gray-500">Modifiers</p>
                {group.modifiers.map((modifier, modifierIndex) => (
                  <div key={modifier.id} className="flex items-center gap-2">
                    <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                      <Input
                        value={modifier.name}
                        onChange={(e) => updateModifier(group.id, modifier.id, { name: e.target.value })}
                        placeholder={`Modifier ${modifierIndex + 1}`}
                      />
                      <Input
                        type="number"
                        value={modifier.priceAdj}
                        onChange={(e) =>
                          updateModifier(group.id, modifier.id, { priceAdj: Number.parseInt(e.target.value, 10) || 0 })
                        }
                        placeholder="Price adj."
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Hapus modifier"
                      onClick={() => updateModifiers(group.id, (modifiers) => modifiers.filter((m) => m.id !== modifier.id))}
                    >
                      <MinusCircle className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    updateModifiers(group.id, (modifiers) => [
                      ...modifiers,
                      { id: generateRowId(), name: '', priceAdj: 0, active: true },
                    ])
                  }
                >
                  <PlusCircle className="mr-1 h-3 w-3" />
                  Add Modifier
                </Button>
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setGroups((prev) => [
                ...prev,
                { id: generateRowId(), name: '', required: false, maxSelect: 1, active: true, modifiers: [] },
              ])
            }
            className="w-full"
          >
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Modifier Group
          </Button>
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onSave(groups)} className="purchasing-main-button">
            <Save className="mr-2 h-4 w-4" />
            Save
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
