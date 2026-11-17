import type {
  InventorySlotItem,
  LootDropState,
  LootDropWireState,
  NetInventorySlot,
  PlayerNetState,
  PlayerNetWireState,
  RoomInitPayload,
  RoomInitWirePayload,
  RoomTickPayload,
  RoomTickWirePayload,
  WeaponBlueprint,
} from './types.ts';

/**
 * Camada de hidratação do cliente.
 *
 * O servidor transmite slots e loot apenas como referências (`weaponId`). O
 * blueprint completo chega uma vez em `room:init.contentItems` ou em
 * `content:items`. Este módulo junta as duas coisas para as views (HUD e
 * renderização) continuarem recebendo `InventorySlotItem` completo.
 *
 * Se o conteúdo ainda não chegou, o slot é hidratado sem `weapon`: o HUD
 * mostra nome/munição e o renderizador pula o modelo até o próximo tick.
 */

export function mergeWeaponContent(
  cache: Map<string, WeaponBlueprint>,
  weapons: readonly WeaponBlueprint[] | null | undefined,
): number {
  if (!weapons || weapons.length === 0) return 0;
  let added = 0;
  for (const weapon of weapons) {
    if (!weapon || typeof weapon.id !== 'string' || !weapon.id) continue;
    if (cache.has(weapon.id)) continue;
    cache.set(weapon.id, weapon);
    added += 1;
  }
  return added;
}

export function hydrateInventorySlot(
  slot: NetInventorySlot | null | undefined,
  cache: ReadonlyMap<string, WeaponBlueprint>,
): InventorySlotItem | null {
  if (!slot) return null;
  const item: InventorySlotItem = {
    id: slot.id,
    kind: slot.kind,
    name: slot.name,
    massKg: slot.massKg,
  };
  if (typeof slot.ammo === 'number') item.ammo = slot.ammo;
  if (typeof slot.ammoMax === 'number') item.ammoMax = slot.ammoMax;
  if (slot.relicId) item.relicId = slot.relicId;
  if (slot.weaponId) {
    const weapon = cache.get(slot.weaponId);
    if (weapon) item.weapon = weapon;
  }
  return item;
}

export function hydratePlayer(
  player: PlayerNetWireState,
  cache: ReadonlyMap<string, WeaponBlueprint>,
): PlayerNetState {
  return {
    ...player,
    slots: player.slots.map((slot) => hydrateInventorySlot(slot, cache)),
  };
}

export function hydrateLootDrop(
  drop: LootDropWireState,
  cache: ReadonlyMap<string, WeaponBlueprint>,
): LootDropState | null {
  const item = hydrateInventorySlot(drop.item, cache);
  if (!item) return null;
  return { id: drop.id, position: drop.position, item };
}

export function hydrateRoomInit(
  init: RoomInitWirePayload,
  cache: Map<string, WeaponBlueprint>,
): RoomInitPayload {
  mergeWeaponContent(cache, init.contentItems);
  const { contentItems: _contentItems, ...rest } = init;
  return {
    ...rest,
    players: init.players.map((player) => hydratePlayer(player, cache)),
    lootDrops: init.lootDrops
      .map((drop) => hydrateLootDrop(drop, cache))
      .filter((drop): drop is LootDropState => drop !== null),
  };
}

export function hydrateRoomTick(
  tick: RoomTickWirePayload,
  cache: ReadonlyMap<string, WeaponBlueprint>,
): RoomTickPayload {
  return {
    ...tick,
    players: tick.players.map((player) => hydratePlayer(player, cache)),
    lootDrops: tick.lootDrops
      .map((drop) => hydrateLootDrop(drop, cache))
      .filter((drop): drop is LootDropState => drop !== null),
  };
}
