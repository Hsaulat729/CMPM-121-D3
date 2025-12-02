// @deno-types="npm:@types/leaflet"
import leaflet from "leaflet";

import "leaflet/dist/leaflet.css";
import "./_leafletWorkaround.ts";
import luck from "./_luck.ts";
import "./style.css";

// =====================================================
// DEBUG HELPERS (lint-safe)
// =====================================================
function DBG(tag: string, ...args: unknown[]) {
  console.log(`[${tag}]`, ...args);
}
const _DBG_CELL = (...a: unknown[]) => DBG("CELL", ...a);
const _DBG_GRID = (...a: unknown[]) => DBG("GRID", ...a);
const _DBG_MOVE = (...a: unknown[]) => DBG("MOVE", ...a);
const _DBG_INV = (...a: unknown[]) => DBG("INV", ...a);
const DBG_SYS = (...a: unknown[]) => DBG("SYS", ...a);

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

// =====================================================
// LOCAL STORAGE KEYS
// =====================================================
const LS_WORLD = "d3_world_state";
const LS_PLAYER = "d3_player_position";
const LS_HELD = "d3_held_token";
const LS_MODE = "d3_movement_mode";

// =====================================================
// STATE VARIABLES
// =====================================================

let playerLatLng = VISUAL_ORIGIN.clone();

// Saved across loads
let worldState = new Map<string, number | null>();
let heldToken: number | null = null;
let movementMode: "wasd" | "geo" = "wasd";

// =====================================================
// LOAD FROM LOCAL STORAGE
// =====================================================

function loadGame() {
  DBG_SYS("Loading game from localStorage...");

  // WORLD STATE
  const ws = localStorage.getItem(LS_WORLD);
  if (ws) {
    const parsed: Record<string, number | null> = JSON.parse(ws);
    worldState = new Map(Object.entries(parsed));
    DBG_SYS("Loaded worldState entries:", worldState.size);
  }

  // PLAYER POSITION
  const pp = localStorage.getItem(LS_PLAYER);
  if (pp) {
    const obj = JSON.parse(pp) as { lat: number; lng: number };
    playerLatLng = leaflet.latLng(obj.lat, obj.lng);
    DBG_SYS("Loaded player position:", playerLatLng);
  }

  // HELD TOKEN
  const ht = localStorage.getItem(LS_HELD);
  if (ht) {
    heldToken = JSON.parse(ht) as number | null;
  }

  // MOVEMENT MODE
  const mm = localStorage.getItem(LS_MODE);
  if (mm === "geo" || mm === "wasd") {
    movementMode = mm;
  }

  DBG_SYS("Loaded movement mode:", movementMode);
}

// =====================================================
// SAVE TO LOCAL STORAGE
// =====================================================

function saveGame() {
  const obj: Record<string, number | null> = {};
  for (const [k, v] of worldState) obj[k] = v;

  localStorage.setItem(LS_WORLD, JSON.stringify(obj));
  localStorage.setItem(
    LS_PLAYER,
    JSON.stringify({ lat: playerLatLng.lat, lng: playerLatLng.lng }),
  );
  localStorage.setItem(LS_HELD, JSON.stringify(heldToken));
  localStorage.setItem(LS_MODE, movementMode);
}

// =====================================================
// NEW GAME
// =====================================================

function newGame() {
  localStorage.removeItem(LS_WORLD);
  localStorage.removeItem(LS_PLAYER);
  localStorage.removeItem(LS_HELD);
  localStorage.removeItem(LS_MODE);

  location.reload();
}

// =====================================================
// DOM SETUP
// =====================================================

const topBar = document.createElement("div");
topBar.id = "top-controls";

const modeBtn = document.createElement("button");
modeBtn.textContent = "Switch to Geolocation";
modeBtn.onclick = () => toggleMovementMode();

const resetBtn = document.createElement("button");
resetBtn.textContent = "New Game";
resetBtn.onclick = () => newGame();

topBar.append(modeBtn, resetBtn);
document.body.appendChild(topBar);

const inventoryDiv = document.createElement("div");
inventoryDiv.id = "inventory";
document.body.appendChild(inventoryDiv);

const mapDiv = document.createElement("div");
mapDiv.id = "map";
document.body.appendChild(mapDiv);

// =====================================================
// INITIAL LOAD
// =====================================================
loadGame();
updateInventoryUI();

// =====================================================
// MAP SETUP
// =====================================================

const map = leaflet.map(mapDiv, {
  center: playerLatLng,
  zoom: 19,
});

leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
}).addTo(map);

const playerMarker = leaflet.marker(playerLatLng).addTo(map);

// =====================================================
// COORDINATE HELPERS
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
// TOKEN SYSTEM — FLYWEIGHT + MEMENTO
// =====================================================

function getCellToken(i_real: number, j_real: number): number | null {
  const k = key(i_real, j_real);

  if (worldState.has(k)) return worldState.get(k)!;

  const roll = luck(k);
  if (roll < 0.15) return roll < 0.075 ? 1 : 2;

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
    alert(`🎉 You win! You created a token of value ${heldToken}.`);
  }
}

// =====================================================
// GRID DRAWING
// =====================================================

let gridLayers: leaflet.Layer[] = [];

function redrawGrid() {
  gridLayers.forEach((l) => map.removeLayer(l));
  gridLayers = [];

  const bounds = map.getBounds();
  const nw = bounds.getNorthWest();
  const se = bounds.getSouthEast();

  const tl = latLngToVisualCell(nw);
  const br = latLngToVisualCell(se);

  for (let i_vis = tl.i - 1; i_vis <= br.i + 1; i_vis++) {
    for (let j_vis = tl.j - 1; j_vis <= br.j + 1; j_vis++) {
      const b = visualCellToBounds(i_vis, j_vis);
      const rect = leaflet.rectangle(b, { color: "red", weight: 1 });
      rect.addTo(map);
      gridLayers.push(rect);

      const center = b.getCenter();
      const { i: i_real, j: j_real } = latLngToRealCell(center);

      const tokenVal = getCellToken(i_real, j_real);
      const click = () => handleCellClick(i_real, j_real);

      rect.on("click", click);

      if (tokenVal !== null) {
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
}

map.on("moveend", redrawGrid);
redrawGrid();

// =====================================================
// CLICK HANDLING
// =====================================================

function handleCellClick(i_real: number, j_real: number) {
  const k = key(i_real, j_real);

  if (!isCellNearby(i_real, j_real)) return;

  const tokenValue = getCellToken(i_real, j_real);

  // PLACE
  if (tokenValue === null && heldToken !== null) {
    worldState.set(k, heldToken);
    heldToken = null;
    updateInventoryUI();
    saveGame();
    redrawGrid();
    return;
  }

  // PICKUP
  if (tokenValue !== null && heldToken === null) {
    heldToken = tokenValue;
    worldState.set(k, null);
    updateInventoryUI();
    saveGame();
    redrawGrid();
    return;
  }

  // MERGE
  if (tokenValue !== null && heldToken === tokenValue) {
    const newVal = heldToken * 2;
    heldToken = newVal;
    worldState.set(k, null);
    updateInventoryUI();
    saveGame();
    redrawGrid();
    return;
  }
}

// =====================================================
// INVENTORY UI
// =====================================================

function updateInventoryUI() {
  inventoryDiv.textContent = heldToken === null
    ? "Inventory: (empty)"
    : `Inventory: ${heldToken}`;
  checkWin();
}

// =====================================================
// MOVEMENT FACADE
// =====================================================

interface MovementController {
  enable(): void;
  disable(): void;
}

class WasdMovement implements MovementController {
  handler = (e: KeyboardEvent) => {
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

    saveGame();
    redrawGrid();
  };

  enable() {
    document.addEventListener("keydown", this.handler);
  }
  disable() {
    document.removeEventListener("keydown", this.handler);
  }
}

class GeoMovement implements MovementController {
  watchId: number | null = null;

  enable() {
    if (!navigator.geolocation) {
      alert("Geolocation not supported");
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        playerLatLng = leaflet.latLng(latitude, longitude);
        playerMarker.setLatLng(playerLatLng);
        map.setView(playerLatLng);

        saveGame();
        redrawGrid();
      },
      () => alert("Unable to retrieve location"),
      { enableHighAccuracy: true },
    );
  }

  disable() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }
}

// =====================================================
// MOVEMENT MODE TOGGLE
// =====================================================

const wasd = new WasdMovement();
const geo = new GeoMovement();

function applyMovementMode() {
  if (movementMode === "wasd") {
    geo.disable();
    wasd.enable();
    modeBtn.textContent = "Switch to Geolocation";
  } else {
    wasd.disable();
    geo.enable();
    modeBtn.textContent = "Switch to WASD";
  }
  saveGame();
}

function toggleMovementMode() {
  movementMode = movementMode === "wasd" ? "geo" : "wasd";
  applyMovementMode();
}

applyMovementMode();
