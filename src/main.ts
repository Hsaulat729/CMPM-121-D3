// @deno-types="npm:@types/leaflet"
import leaflet from "leaflet";

import "leaflet/dist/leaflet.css";
import "./_leafletWorkaround.ts";
import luck from "./_luck.ts";
import "./style.css";

// =====================================================
// DEBUG HELPERS — no-explicit-any removed
// =====================================================
function DBG(tag: string, ...args: unknown[]) {
  console.log(`[${tag}]`, ...args);
}
const DBG_CELL = (...a: unknown[]) => DBG("CELL", ...a);
const DBG_GRID = (...a: unknown[]) => DBG("GRID", ...a);
const DBG_MOVE = (...a: unknown[]) => DBG("MOVE", ...a);
const DBG_INV = (...a: unknown[]) => DBG("INV", ...a);

// =====================================================
// CONSTANTS
// =====================================================

const GRID_ORIGIN = { lat: 0, lng: 0 };
const VISUAL_ORIGIN = leaflet.latLng(
  36.997936938057016,
  -122.05703507501151,
);

const TILE_DEGREES = 0.0001;
const INTERACT_RANGE = 3;

let playerLatLng = VISUAL_ORIGIN.clone();

// =====================================================
// DOM SETUP
// =====================================================

const inventoryDiv = document.createElement("div");
inventoryDiv.id = "inventory";
document.body.appendChild(inventoryDiv);

const mapDiv = document.createElement("div");
mapDiv.id = "map";
document.body.appendChild(mapDiv);

let heldToken: number | null = null;
updateInventoryUI();

// =====================================================
// MAP SETUP
// =====================================================

const map = leaflet.map(mapDiv, {
  center: VISUAL_ORIGIN,
  zoom: 19,
});

leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
}).addTo(map);

const playerMarker = leaflet.marker(playerLatLng).addTo(map);

// =====================================================
// COORDINATE CONVERSION
// =====================================================

function latLngToRealCell(latlng: leaflet.LatLng) {
  return {
    i: Math.floor((latlng.lat - GRID_ORIGIN.lat) / TILE_DEGREES),
    j: Math.floor((latlng.lng - GRID_ORIGIN.lng) / TILE_DEGREES),
  };
}

function latLngToVisualCell(latlng: leaflet.LatLng) {
  const i = Math.floor((VISUAL_ORIGIN.lat - latlng.lat) / TILE_DEGREES);
  const j = Math.floor((latlng.lng - VISUAL_ORIGIN.lng) / TILE_DEGREES);
  return { i, j };
}

function visualCellToBounds(i: number, j: number) {
  const lat1 = VISUAL_ORIGIN.lat - i * TILE_DEGREES;
  const lng1 = VISUAL_ORIGIN.lng + j * TILE_DEGREES;
  const lat2 = lat1 - TILE_DEGREES;
  const lng2 = lng1 + TILE_DEGREES;
  return leaflet.latLngBounds([[lat1, lng1], [lat2, lng2]]);
}

function key(i: number, j: number) {
  return `${i},${j}`;
}

// =====================================================
// TOKEN SYSTEM — MEMORYLESS FOR D3.B
// =====================================================

const visibleCellState = new Map<string, number | null>();

function getTokenForCell(i_real: number, j_real: number): number | null {
  const k = key(i_real, j_real);

  if (visibleCellState.has(k)) return visibleCellState.get(k)!;

  const roll = luck(k);

  if (roll < 0.15) {
    const val = roll < 0.075 ? 1 : 2;
    visibleCellState.set(k, val);
    DBG_CELL("spawn token", val, "at", k);
    return val;
  }

  visibleCellState.set(k, null);
  return null;
}

// =====================================================
// INTERACTION RANGE
// =====================================================

function isCellNearby(i_real: number, j_real: number) {
  const p = latLngToRealCell(playerLatLng);
  return (
    Math.abs(p.i - i_real) <= INTERACT_RANGE &&
    Math.abs(p.j - j_real) <= INTERACT_RANGE
  );
}

// =====================================================
// WIN CONDITION
// =====================================================

function checkWin() {
  if (heldToken !== null && heldToken >= 50) {
    DBG_INV("WIN CONDITION MET — held:", heldToken);
    alert(`🎉 You win! You created a token of value ${heldToken}.`);
  }
}

// =====================================================
// GRID DRAWING
// =====================================================

let gridLayers: leaflet.Layer[] = [];

function redrawGrid() {
  DBG_GRID("=== START ===");

  const oldKeys = new Set(visibleCellState.keys());

  gridLayers.forEach((l) => map.removeLayer(l));
  gridLayers = [];

  const bounds = map.getBounds();
  const nw = bounds.getNorthWest();
  const se = bounds.getSouthEast();

  const tl = latLngToVisualCell(nw);
  const br = latLngToVisualCell(se);

  DBG_GRID("Visible VISUAL range", tl, br);

  let drawCount = 0;
  let tokenCount = 0;

  const newVisible = new Set<string>();

  for (let i_vis = tl.i - 1; i_vis <= br.i + 1; i_vis++) {
    for (let j_vis = tl.j - 1; j_vis <= br.j + 1; j_vis++) {
      const b = visualCellToBounds(i_vis, j_vis);
      const rect = leaflet.rectangle(b, { color: "red", weight: 1 });
      rect.addTo(map);
      gridLayers.push(rect);

      drawCount++;

      const center = b.getCenter();
      const { i: i_real, j: j_real } = latLngToRealCell(center);
      const k = key(i_real, j_real);

      newVisible.add(k);

      const tokenVal = getTokenForCell(i_real, j_real);

      const click = () => handleCellClick(i_real, j_real, tokenVal);
      rect.on("click", click);

      if (tokenVal !== null) {
        tokenCount++;
        const label = leaflet.marker(center, {
          icon: leaflet.divIcon({
            className: "cell-label",
            html: `<b>${tokenVal}</b>`,
          }),
        });
        label.addTo(map);
        gridLayers.push(label);
        label.on("click", click);
      }
    }
  }

  oldKeys.forEach((k) => {
    if (!newVisible.has(k)) visibleCellState.delete(k);
  });

  DBG_GRID("Draw count:", drawCount);
  DBG_GRID("Tokens spawned:", tokenCount);
  DBG_GRID("=== END ===");
}

map.on("moveend", redrawGrid);
redrawGrid();

// =====================================================
// CLICK HANDLING — PICKUP, PLACE, MERGE
// =====================================================

function handleCellClick(
  i_real: number,
  j_real: number,
  tokenValue: number | null,
) {
  const k = key(i_real, j_real);
  DBG_CELL("clicked", k, "token:", tokenValue);

  if (!isCellNearby(i_real, j_real)) {
    DBG_CELL("too far");
    return;
  }

  // PLACE TOKEN
  if (tokenValue === null && heldToken !== null) {
    DBG_INV("placing", heldToken, "at", k);
    visibleCellState.set(k, heldToken);
    heldToken = null;
    updateInventoryUI();
    redrawGrid();
    checkWin();
    return;
  }

  // PICKUP TOKEN
  if (tokenValue !== null && heldToken === null) {
    DBG_INV("pickup", tokenValue, "from", k);
    heldToken = tokenValue;
    visibleCellState.set(k, null);
    updateInventoryUI();
    redrawGrid();
    checkWin();
    return;
  }

  // MERGE TOKEN
  if (tokenValue !== null && heldToken === tokenValue) {
    const newVal = heldToken * 2;
    DBG_INV(`merge ${heldToken} + ${tokenValue} = ${newVal}`);
    heldToken = newVal;
    visibleCellState.set(k, null);
    updateInventoryUI();
    redrawGrid();
    checkWin();
    return;
  }

  DBG_CELL("no valid interaction");
}

// =====================================================
// INVENTORY UI
// =====================================================

function updateInventoryUI() {
  inventoryDiv.innerHTML = heldToken === null
    ? "Inventory: (empty)"
    : `Inventory: ${heldToken}`;
  DBG_INV("Inventory:", heldToken);
  checkWin();
}

// =====================================================
// MOVEMENT (WASD)
// =====================================================

document.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (!["w", "a", "s", "d"].includes(k)) return;

  let { lat, lng } = playerLatLng;

  if (k === "w") lat += TILE_DEGREES;
  if (k === "s") lat -= TILE_DEGREES;
  if (k === "a") lng -= TILE_DEGREES;
  if (k === "d") lng += TILE_DEGREES;

  playerLatLng = leaflet.latLng(lat, lng);
  playerMarker.setLatLng(playerLatLng);
  map.setView(playerLatLng);

  DBG_MOVE("Moved", k, "to", playerLatLng);

  checkWin();
  redrawGrid();
});
