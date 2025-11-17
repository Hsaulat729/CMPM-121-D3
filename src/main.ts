// @deno-types="npm:@types/leaflet"
import leaflet from "leaflet";

// Styles
import "leaflet/dist/leaflet.css";
import "./style.css";

// Fix missing marker images
import "./_leafletWorkaround.ts";

// Deterministic hashing function
import luck from "./_luck.ts";

// ---------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------

// Fixed classroom location
const CLASSROOM_LATLNG = leaflet.latLng(
  36.997936938057016,
  -122.05703507501151,
);

// Grid cell size
const TILE_DEGREES = 0.0001;

// Manual overrides for cell contents after interactions
const cellOverrides = new Map<string, number>();
function overrideCellValue(i: number, j: number, newValue: number) {
  cellOverrides.set(`${i},${j}`, newValue);
}
function getOverriddenValue(i: number, j: number): number | null {
  if (cellOverrides.has(`${i},${j}`)) {
    return cellOverrides.get(`${i},${j}`)!;
  }
  return null;
}

// ---------------------------------------------------------
// PAGE SETUP
// ---------------------------------------------------------

// Map container
const mapDiv = document.createElement("div");
mapDiv.id = "map";
document.body.append(mapDiv);

// Inventory display
const inventoryDiv = document.createElement("div");
inventoryDiv.id = "inventory";
inventoryDiv.innerText = "Inventory: (empty)";
document.body.append(inventoryDiv);

// ---------------------------------------------------------
// MAP INITIALIZATION
// ---------------------------------------------------------

const map = leaflet.map(mapDiv, {
  center: CLASSROOM_LATLNG,
  zoom: 19,
  zoomControl: false,
  scrollWheelZoom: false,
});

leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

leaflet.marker(CLASSROOM_LATLNG)
  .addTo(map)
  .bindTooltip("You are here!");

// ---------------------------------------------------------
// GRID MATH UTILITIES
// ---------------------------------------------------------

function latLngToCell(lat: number, lng: number) {
  const origin = CLASSROOM_LATLNG;
  const i = Math.floor((lat - origin.lat) / TILE_DEGREES);
  const j = Math.floor((lng - origin.lng) / TILE_DEGREES);
  return { i, j };
}

function cellToBounds(i: number, j: number): leaflet.LatLngBounds {
  const origin = CLASSROOM_LATLNG;

  const lat1 = origin.lat + i * TILE_DEGREES;
  const lng1 = origin.lng + j * TILE_DEGREES;
  const lat2 = origin.lat + (i + 1) * TILE_DEGREES;
  const lng2 = origin.lng + (j + 1) * TILE_DEGREES;

  return leaflet.latLngBounds([
    [lat1, lng1],
    [lat2, lng2],
  ]);
}

// ---------------------------------------------------------
// TOKEN GENERATION (DETERMINISTIC)
// ---------------------------------------------------------

function getTokenValue(i: number, j: number): number {
  const override = getOverriddenValue(i, j);
  if (override !== null) return override;

  const r = luck(`${i},${j}`);
  if (r < 0.15) return 1;
  return 0;
}

// ---------------------------------------------------------
// INTERACTION & GAMEPLAY LOGIC
// ---------------------------------------------------------

let inventoryValue = 0;

function updateInventoryUI() {
  if (inventoryValue === 0) {
    inventoryDiv.innerText = "Inventory: (empty)";
  } else {
    inventoryDiv.innerText = `Inventory: ${inventoryValue}`;
  }
}

// Can only interact with cells within 3 cells of the classroom marker
function isCellNearby(i: number, j: number): boolean {
  const playerCell = latLngToCell(CLASSROOM_LATLNG.lat, CLASSROOM_LATLNG.lng);

  const di = Math.abs(i - playerCell.i);
  const dj = Math.abs(j - playerCell.j);

  return di <= 3 && dj <= 3;
}

function checkWinCondition() {
  if (inventoryValue >= 16) {
    alert("You crafted a high-value token! You win!");
  }
}

function handleCellClick(i: number, j: number) {
  if (!isCellNearby(i, j)) {
    console.log("Too far away — cannot interact.");
    return;
  }

  const cellValue = getTokenValue(i, j);

  // PICKUP CASE
  if (inventoryValue === 0) {
    if (cellValue > 0) {
      inventoryValue = cellValue;
      overrideCellValue(i, j, 0);
      updateInventoryUI();
      drawVisibleCells();
    }
    return;
  }

  // MERGE CASE
  if (inventoryValue > 0) {
    if (cellValue === inventoryValue && cellValue > 0) {
      const newValue = inventoryValue * 2;
      overrideCellValue(i, j, newValue);
      inventoryValue = 0;
      updateInventoryUI();
      drawVisibleCells();
      checkWinCondition();
      return;
    }
  }

  console.log("Cannot merge: values do not match.");
}

// ---------------------------------------------------------
// GRID RENDERING
// ---------------------------------------------------------

const cellLayer = leaflet.layerGroup().addTo(map);

map.on("moveend", () => drawVisibleCells());
drawVisibleCells();

function drawVisibleCells() {
  cellLayer.clearLayers();

  const bounds = map.getBounds();
  const nw = bounds.getNorthWest();
  const se = bounds.getSouthEast();

  const c1 = latLngToCell(nw.lat, nw.lng);
  const c2 = latLngToCell(se.lat, se.lng);

  const minI = Math.min(c1.i, c2.i);
  const maxI = Math.max(c1.i, c2.i);
  const minJ = Math.min(c1.j, c2.j);
  const maxJ = Math.max(c1.j, c2.j);

  for (let i = minI - 1; i <= maxI + 1; i++) {
    for (let j = minJ - 1; j <= maxJ + 1; j++) {
      drawCell(i, j);
    }
  }
}

function drawCell(i: number, j: number) {
  const bounds = cellToBounds(i, j);

  // Cell rectangle
  const rect = leaflet.rectangle(bounds, {
    color: "red",
    weight: 2,
    fillOpacity: 0.02,
  });
  rect.addTo(cellLayer);

  rect.on("click", () => handleCellClick(i, j));

  const value = getTokenValue(i, j);

  if (value > 0) {
    const center = bounds.getCenter();

    leaflet
      .marker(center, {
        icon: leaflet.divIcon({
          className: "token-label",
          html: `<div class="token-text">${value}</div>`,
        }),
      })
      .addTo(cellLayer);
  }
}
