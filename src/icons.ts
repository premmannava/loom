/**
 * SayShape's own icons: outline symbols drawn on a 24×24 grid with round
 * strokes, designed from scratch for SayShape (no icon set was copied or
 * traced). Each icon is a few drawing commands; drawIcon paints one in a
 * theme color at any size, so icons follow light and dark like everything else.
 *
 * Commands, one shape per string (coordinates on the 24×24 grid):
 *   M x y, L x y, H x, V y, C x1 y1 x2 y2 x y, Q x1 y1 x y, Z   a path (absolute)
 *   O cx cy r            a circle
 *   A cx cy r from to    an arc, angles in degrees, clockwise from three o'clock
 *   R x y w h r          a rounded rectangle
 *   D cx cy              a small filled dot
 */

/** A small cloud, raised to leave room for rain, snow or a bolt under it. */
const HIGH_CLOUD = "M7 14.5 H17.5 C19.7 14.5 21 12.9 21 11 C21 9 19.5 7.5 17.5 7.4 C16.8 5 14.6 3.2 12 3.2 C9 3.2 6.6 5.4 6.4 8.3 C4.5 8.9 3.5 10.3 3.5 11.6 C3.5 13.3 5 14.5 7 14.5 Z";

/** Five points, worked out once: outer and inner radii alternate. */
function starPath(): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (-90 + i * 36) * (Math.PI / 180);
    const r = i % 2 ? 4.3 : 9.3;
    pts.push(`${i ? "L" : "M"}${(12 + r * Math.cos(a)).toFixed(2)} ${(12.6 + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ") + " Z";
}

export const ICONS = {
  // Status
  check: ["M5 12.5 L10 17.5 L19 7"],
  "check-circle": ["O 12 12 9", "M8 12.5 L11 15.5 L16.5 9"],
  x: ["M6.5 6.5 L17.5 17.5", "M17.5 6.5 L6.5 17.5"],
  "x-circle": ["O 12 12 9", "M9 9 L15 15", "M15 9 L9 15"],
  warning: ["M12 3.5 L21.5 20 H2.5 Z", "M12 10 V14", "D 12 17"],
  info: ["O 12 12 9", "M12 11 V16.5", "D 12 7.8"],
  help: ["O 12 12 9", "A 12 9.6 2.8 180 405", "M13.98 11.58 L12 13 V14", "D 12 17"],
  clock: ["O 12 12 9", "M12 7 V12 L15.5 14"],
  // Direction and change
  "arrow-up": ["M12 19 V5", "M6 11 L12 5 L18 11"],
  "arrow-down": ["M12 5 V19", "M6 13 L12 19 L18 13"],
  "arrow-left": ["M19 12 H5", "M11 6 L5 12 L11 18"],
  "arrow-right": ["M5 12 H19", "M13 6 L19 12 L13 18"],
  "trend-up": ["M3 17 L9 11 L13 14.5 L20.5 7", "M15 7 H20.5 V12.5"],
  "trend-down": ["M3 7 L9 13 L13 9.5 L20.5 17", "M15 17 H20.5 V11.5"],
  plus: ["M12 5 V19", "M5 12 H19"],
  minus: ["M5 12 H19"],
  refresh: ["A 12 12 8 -60 210", "M1.8 9.2 L5.07 8 L5.7 11.4"],
  // Weather
  sun: ["O 12 12 4", ...Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4, c = Math.cos(a), s = Math.sin(a);
    return `M${(12 + c * 7).toFixed(2)} ${(12 + s * 7).toFixed(2)} L${(12 + c * 9.5).toFixed(2)} ${(12 + s * 9.5).toFixed(2)}`;
  })],
  moon: ["M20 14.5 C18.9 14.9 17.7 15.1 16.5 15.1 C11.3 15.1 7.1 10.9 7.1 5.7 C7.1 5 7.2 4.3 7.3 3.6 C4.8 5.1 3.2 7.8 3.2 10.9 C3.2 15.9 7.3 20 12.3 20 C15.8 20 18.8 17.9 20 14.5 Z"],
  cloud: ["M7 18.5 H17.5 C20 18.5 21.5 16.5 21.5 14.5 C21.5 12.3 19.8 10.6 17.6 10.5 C16.8 7.6 14.4 5.5 11.5 5.5 C8.2 5.5 5.6 8 5.4 11.2 C3.4 11.9 2.5 13.5 2.5 15 C2.5 17 4.5 18.5 7 18.5 Z"],
  rain: [HIGH_CLOUD, "M8 17.5 L7 20.5", "M12 17.5 L11 20.5", "M16 17.5 L15 20.5"],
  snow: [HIGH_CLOUD, "D 8 18.5", "D 12 20.5", "D 16 18.5"],
  storm: [HIGH_CLOUD, "M12.5 15.5 L10 19 H13.5 L11 22"],
  wind: [
    "M3 9.5 H14 C15.9 9.5 17 8.3 17 6.8 C17 5.4 15.9 4.5 14.7 4.5 C13.6 4.5 12.8 5.2 12.6 6",
    "M3 13.5 H18.5 C20.2 13.5 21.3 14.6 21.3 16 C21.3 17.4 20.2 18.4 18.8 18.4 C17.7 18.4 16.9 17.8 16.6 16.9",
    "M3 17.5 H10",
  ],
  thermometer: ["M10 14.6 V5.5 C10 4.4 10.9 3.5 12 3.5 C13.1 3.5 14 4.4 14 5.5 V14.6", "A 12 17.6 3.6 -56 236", "M12 15.5 V9"],
  droplet: ["M12 3.5 C12 3.5 6 10 6 14.5 C6 17.8 8.7 20.5 12 20.5 C15.3 20.5 18 17.8 18 14.5 C18 10 12 3.5 12 3.5 Z"],
  // Places and travel
  pin: ["M12 21.5 C8.5 17.8 5 14 5 9.8 C5 5.9 8.1 2.8 12 2.8 C15.9 2.8 19 5.9 19 9.8 C19 14 15.5 17.8 12 21.5 Z", "O 12 9.8 2.6"],
  globe: ["O 12 12 9", "M3 12 H21", "M12 3 C9 5.5 7.8 8.6 7.8 12 C7.8 15.4 9 18.5 12 21 C15 18.5 16.2 15.4 16.2 12 C16.2 8.6 15 5.5 12 3 Z"],
  plane: ["M12 2.8 C13 2.8 13.6 3.8 13.6 5 V9.6 L21 14 V16 L13.6 13.8 V18.2 L16 20 V21.5 L12 20.4 L8 21.5 V20 L10.4 18.2 V13.8 L3 16 V14 L10.4 9.6 V5 C10.4 3.8 11 2.8 12 2.8 Z"],
  car: [
    "M5.5 16.5 H3.5 V12.8 C3.5 12 4 11.4 4.7 11.2 L6.6 6.9 C6.9 6.3 7.5 6 8.2 6 H15.8 C16.5 6 17.1 6.3 17.4 6.9 L19.3 11.2 C20 11.4 20.5 12 20.5 12.8 V16.5 H18.5",
    "M9.5 16.5 H14.5", "M4.8 11.2 H19.2", "O 7.5 16.5 2", "O 16.5 16.5 2",
  ],
  truck: ["M14 15.5 V7.5 C14 6.9 13.6 6.5 13 6.5 H3.5 C2.9 6.5 2.5 6.9 2.5 7.5 V15.5 H4.7", "M14 9.5 H17.8 L21 12.8 V15.5 H19.3", "M8.3 15.5 H15.7", "O 6.5 16.8 1.8", "O 17.5 16.8 1.8"],
  home: ["M3.5 11 L12 4 L20.5 11", "M5.5 9.5 V20 H18.5 V9.5", "M10 20 V14.5 H14 V20"],
  building: ["M5 21 V4.5 C5 3.9 5.4 3.5 6 3.5 H14 C14.6 3.5 15 3.9 15 4.5 V21", "M15 9.5 H18 C18.6 9.5 19 9.9 19 10.5 V21", "M3 21 H21", "D 8.5 7.5", "D 11.5 7.5", "D 8.5 11", "D 11.5 11", "D 8.5 14.5", "D 11.5 14.5"],
  // Business and data
  dollar: ["M16.5 7.5 C15.8 6.2 14.2 5.5 12 5.5 C9.4 5.5 7.8 6.8 7.8 8.6 C7.8 13 16.2 10.6 16.2 15.3 C16.2 17.2 14.4 18.5 12 18.5 C9.6 18.5 8 17.6 7.3 16.2", "M12 3 V5.5", "M12 18.5 V21"],
  card: ["R 3 5.5 18 13 2", "M3 10 H21", "M6.5 14.5 H10"],
  cart: ["M2.5 4 H5 L7.4 15 C7.5 15.6 8 16 8.6 16 H17.6 C18.2 16 18.7 15.6 18.8 15 L20.5 7.5 H6", "O 9 19.8 1.2", "O 17 19.8 1.2"],
  package: ["M12 3 L20 7.2 V16.8 L12 21 L4 16.8 V7.2 Z", "M4 7.2 L12 11.4 L20 7.2", "M12 11.4 V21", "M8 5.1 L16 9.3"],
  "bar-chart": ["M4 20 H20", "M7 20 V12", "M12 20 V5.5", "M17 20 V9.5"],
  "pie-chart": ["O 12 12 9", "M12 3 V12 H21"],
  percent: ["M18.5 5.5 L5.5 18.5", "O 7.5 7.5 2.3", "O 16.5 16.5 2.3"],
  tag: ["M3.5 4.5 V11.6 C3.5 12.1 3.7 12.6 4.1 13 L11.5 20.4 C12.3 21.2 13.5 21.2 14.3 20.4 L20.4 14.3 C21.2 13.5 21.2 12.3 20.4 11.5 L13 4.1 C12.6 3.7 12.1 3.5 11.6 3.5 H4.5 C3.9 3.5 3.5 3.9 3.5 4.5 Z", "O 8 8 1.3"],
  briefcase: ["R 3 7.5 18 12.5 2", "M8.5 7.5 V5.5 C8.5 4.9 8.9 4.5 9.5 4.5 H14.5 C15.1 4.5 15.5 4.9 15.5 5.5 V7.5", "M3 13 H21"],
  file: ["M14 3 H7 C6.4 3 6 3.4 6 4 V20 C6 20.6 6.4 21 7 21 H17 C17.6 21 18 20.6 18 20 V7 Z", "M14 3 V7 H18", "M9 12 H15", "M9 15.5 H15"],
  target: ["O 12 12 9", "O 12 12 5", "D 12 12"],
  bolt: ["M13 2.8 L5 13.5 H11.5 L10.5 21.2 L19 10.5 H12.5 Z"],
  idea: ["M9 17.5 V15.6 C7.2 14.4 6 12.4 6 10.2 C6 6.8 8.7 4 12 4 C15.3 4 18 6.8 18 10.2 C18 12.4 16.8 14.4 15 15.6 V17.5 Z", "M9.5 20.5 H14.5"],
  lock: ["R 5 10.5 14 10 2", "M8 10.5 V7.5 C8 5.3 9.8 3.5 12 3.5 C14.2 3.5 16 5.3 16 7.5 V10.5"],
  // People and time
  user: ["O 12 8 4", "M4.5 20.5 C4.5 16.6 7.9 13.8 12 13.8 C16.1 13.8 19.5 16.6 19.5 20.5"],
  users: ["O 9 8.5 3.5", "M2.5 20 C2.5 16.6 5.4 14 9 14 C12.6 14 15.5 16.6 15.5 20", "M15.5 5.2 C17.2 5.6 18.3 7 18.3 8.6 C18.3 10.2 17.2 11.6 15.5 12", "M17.5 14.3 C19.8 15 21.5 17.2 21.5 20"],
  calendar: ["R 3.5 5 17 15.5 2", "M3.5 10 H20.5", "M8 3 V7", "M16 3 V7"],
  mail: ["R 3 5.5 18 13 2", "M3.5 7 L12 13 L20.5 7"],
  phone: ["R 7 2.5 10 19 2", "M10.5 18.5 H13.5"],
  chat: ["M4 5.5 C4 4.9 4.4 4.5 5 4.5 H19 C19.6 4.5 20 4.9 20 5.5 V15.5 C20 16.1 19.6 16.5 19 16.5 H9.5 L5.5 20 V16.5 H5 C4.4 16.5 4 16.1 4 15.5 Z"],
  star: [starPath()],
  heart: ["M12 20 C12 20 3.5 15 3.5 9.2 C3.5 6.4 5.6 4.5 8 4.5 C9.7 4.5 11.1 5.4 12 6.8 C12.9 5.4 14.3 4.5 16 4.5 C18.4 4.5 20.5 6.4 20.5 9.2 C20.5 15 12 20 12 20 Z"],
  bell: ["M6 16.5 V11 C6 7.7 8.7 5 12 5 C15.3 5 18 7.7 18 11 V16.5 L19.5 18 H4.5 Z", "M10 20.5 C10.4 21.3 11.1 21.7 12 21.7 C12.9 21.7 13.6 21.3 14 20.5", "M12 3 V5"],
  // Actions
  search: ["O 10.5 10.5 6.5", "M15.2 15.2 L20.5 20.5"],
  filter: ["M3.5 5 H20.5 L14 12.5 V19 L10 21 V12.5 Z"],
  download: ["M12 3.5 V15", "M7 10.5 L12 15.5 L17 10.5", "M4 20 H20"],
  share: ["O 6 12 2.5", "O 17.5 6 2.5", "O 17.5 18 2.5", "M8.3 10.8 L15.2 7.2", "M8.3 13.2 L15.2 16.8"],
  link: [
    "M10 14 C11.2 15.3 13 15.4 14.3 14.2 L17.6 10.9 C18.9 9.6 18.9 7.5 17.6 6.2 C16.3 4.9 14.2 4.9 12.9 6.2 L11.9 7.2",
    "M14 10 C12.8 8.7 11 8.6 9.7 9.8 L6.4 13.1 C5.1 14.4 5.1 16.5 6.4 17.8 C7.7 19.1 9.8 19.1 11.1 17.8 L12.1 16.8",
  ],
  sliders: ["M4 7 H7", "M11 7 H20", "O 9 7 2", "M4 12 H13", "M17 12 H20", "O 15 12 2", "M4 17 H5", "M9 17 H20", "O 7 17 2"],
} satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export function isIconName(name: string): name is IconName {
  return Object.hasOwn(ICONS, name);
}

/** The icon whose name is closest to a wrong one, for a helpful warning: "tick" → check. */
export function nearestIcon(name: string): IconName | null {
  const n = name.toLowerCase().replace(/[^a-z]/g, "");
  const ALIASES: Record<string, IconName> = {
    tick: "check", ok: "check", done: "check", success: "check-circle", close: "x", error: "x-circle", cancel: "x",
    alert: "warning", caution: "warning", question: "help", time: "clock", up: "arrow-up", down: "arrow-down",
    increase: "trend-up", growth: "trend-up", decrease: "trend-down", decline: "trend-down", add: "plus", remove: "minus",
    sunny: "sun", night: "moon", cloudy: "cloud", rainy: "rain", snowy: "snow", lightning: "storm", thunder: "storm",
    temperature: "thermometer", water: "droplet", location: "pin", place: "pin", map: "pin", world: "globe", earth: "globe",
    flight: "plane", airplane: "plane", travel: "plane", house: "home", office: "building", company: "building",
    money: "dollar", price: "dollar", payment: "card", creditcard: "card", shopping: "cart", order: "package", box: "package",
    delivery: "truck", shipping: "truck", chart: "bar-chart", graph: "bar-chart", pie: "pie-chart", label: "tag",
    work: "briefcase", job: "briefcase", document: "file", goal: "target", energy: "bolt", power: "bolt", insight: "idea",
    tip: "idea", security: "lock", person: "user", people: "users", team: "users", date: "calendar", email: "mail",
    message: "chat", favorite: "star", rating: "star", like: "heart", notification: "bell", find: "search",
    export: "download", settings: "sliders", options: "sliders", reload: "refresh", sync: "refresh",
  };
  if (Object.hasOwn(ALIASES, n)) return ALIASES[n]!;
  return ICON_NAMES.find((i) => i.replace(/-/g, "") === n || i.startsWith(n) || n.startsWith(i.replace(/-.*/, ""))) ?? null;
}

type Shape =
  | { k: "path"; ops: Array<[string, number[]]> }
  | { k: "circle"; cx: number; cy: number; r: number }
  | { k: "arc"; cx: number; cy: number; r: number; from: number; to: number }
  | { k: "rect"; x: number; y: number; w: number; h: number; r: number }
  | { k: "dot"; cx: number; cy: number };

const parsed = new Map<string, Shape[]>();

function parseShape(src: string): Shape {
  const tokens = src.match(/[A-Za-z]|-?\d*\.?\d+/g) ?? [];
  const first = tokens[0] ?? "";
  const nums = (from: number) => tokens.slice(from).map(Number);
  if (first === "O") { const [cx = 0, cy = 0, r = 0] = nums(1); return { k: "circle", cx, cy, r }; }
  if (first === "A") { const [cx = 0, cy = 0, r = 0, from = 0, to = 0] = nums(1); return { k: "arc", cx, cy, r, from, to }; }
  if (first === "R") { const [x = 0, y = 0, w = 0, h = 0, r = 0] = nums(1); return { k: "rect", x, y, w, h, r }; }
  if (first === "D") { const [cx = 0, cy = 0] = nums(1); return { k: "dot", cx, cy }; }
  const ops: Array<[string, number[]]> = [];
  for (const t of tokens) {
    if (/[A-Za-z]/.test(t)) ops.push([t, []]);
    else ops[ops.length - 1]?.[1].push(Number(t));
  }
  return { k: "path", ops };
}

function shapesOf(name: IconName): Shape[] {
  let s = parsed.get(name);
  if (!s) parsed.set(name, (s = ICONS[name].map(parseShape)));
  return s;
}

function tracePath(g: CanvasRenderingContext2D, ops: Array<[string, number[]]>): void {
  let x = 0, y = 0;
  g.beginPath();
  for (const [c, a] of ops) {
    if (c === "M") { [x = x, y = y] = a; g.moveTo(x, y); }
    else if (c === "L") { [x = x, y = y] = a; g.lineTo(x, y); }
    else if (c === "H") { x = a[0] ?? x; g.lineTo(x, y); }
    else if (c === "V") { y = a[0] ?? y; g.lineTo(x, y); }
    else if (c === "C") { const [a1 = 0, b1 = 0, a2 = 0, b2 = 0, x3 = 0, y3 = 0] = a; g.bezierCurveTo(a1, b1, a2, b2, x3, y3); x = x3; y = y3; }
    else if (c === "Q") { const [a1 = 0, b1 = 0, x3 = 0, y3 = 0] = a; g.quadraticCurveTo(a1, b1, x3, y3); x = x3; y = y3; }
    else if (c === "Z") g.closePath();
  }
}

/**
 * Draw an icon with its top-left at (x, y), `size` pixels square, in `color`
 * (a theme color). The stroke stays about 2px at any size, so large icons
 * stay light and small ones stay crisp.
 */
export function drawIcon(g: CanvasRenderingContext2D, name: IconName, x: number, y: number, size: number, color: string): void {
  const s = size / 24;
  const stroke = Math.min(2, Math.max(1.5, size / 12));
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.lineWidth = stroke / s;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = color;
  g.fillStyle = color;
  for (const sh of shapesOf(name)) {
    if (sh.k === "path") { tracePath(g, sh.ops); g.stroke(); }
    else if (sh.k === "circle") { g.beginPath(); g.arc(sh.cx, sh.cy, sh.r, 0, Math.PI * 2); g.stroke(); }
    else if (sh.k === "arc") { g.beginPath(); g.arc(sh.cx, sh.cy, sh.r, (sh.from * Math.PI) / 180, (sh.to * Math.PI) / 180); g.stroke(); }
    else if (sh.k === "rect") {
      const { x: rx, y: ry, w, h, r } = sh;
      g.beginPath();
      g.moveTo(rx + r, ry);
      g.arcTo(rx + w, ry, rx + w, ry + h, r);
      g.arcTo(rx + w, ry + h, rx, ry + h, r);
      g.arcTo(rx, ry + h, rx, ry, r);
      g.arcTo(rx, ry, rx + w, ry, r);
      g.closePath();
      g.stroke();
    } else { g.beginPath(); g.arc(sh.cx, sh.cy, Math.max(1.1, (stroke / s) * 0.6), 0, Math.PI * 2); g.fill(); }
  }
  g.restore();
}
