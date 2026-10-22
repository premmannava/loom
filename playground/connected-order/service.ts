import { addDays, compareDates, formatDate, localToday, parseDate } from "../../src/dates";

const initialCatalog = [
  { id: "laptop", name: "Laptop", team: "Engineering", price: 1200, stock: 8 },
  { id: "monitor", name: "Monitor", team: "Engineering", price: 350, stock: 12 },
  { id: "tablet", name: "Drawing tablet", team: "Design", price: 600, stock: 4 },
  { id: "display", name: "Color display", team: "Design", price: 900, stock: 6 },
  { id: "headset", name: "Headset", team: "Sales", price: 120, stock: 20 },
  { id: "webcam", name: "Webcam", team: "Sales", price: 80, stock: 15 },
];

export interface OrderRequest { equipmentId: unknown; quantity: unknown; deliveryDate: unknown }
export type Order = { id: string; name: string; quantity: number; deliveryDate: string; total: number };

/** In-memory service boundary. Replace these methods with backend requests in a real app. */
export function createDemoService(delayMs = 800, today = localToday()) {
  const catalog = structuredClone(initialCatalog);
  const orders: Order[] = [];
  const base = parseDate(today);
  if (!base) throw new Error("Invalid service date");
  const earliest = formatDate(addDays(base, 1));
  const latest = formatDate(addDays(base, 90));
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

  return {
    earliest, latest,
    async catalog() { await pause(); return structuredClone(catalog); },
    async orders() { return structuredClone(orders); },
    async submit(request: OrderRequest, fail = false): Promise<Order> {
      await pause();
      const item = catalog.find((entry) => entry.id === request.equipmentId);
      const qty = request.quantity;
      const date = parseDate(request.deliveryDate);
      if (!item) throw new Error("Select equipment from the catalog.");
      if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 10) throw new Error("Choose a quantity between 1 and 10.");
      if (!date || compareDates(date, parseDate(earliest)!) < 0 || compareDates(date, parseDate(latest)!) > 0) throw new Error("Choose a delivery date within the next 90 days, starting tomorrow.");
      if (qty > item.stock) throw new Error(`Only ${item.stock} ${item.name} units remain. Reduce the quantity and retry.`);
      if (fail) throw new Error("Simulated service failure. Turn off the failure checkbox and retry; no order was created.");
      // The service calculates its own price, rather than trusting a UI total.
      const order = { id: `DEMO-${String(orders.length + 1).padStart(3, "0")}`, name: item.name, quantity: qty, deliveryDate: formatDate(date), total: Math.round(item.price * qty * 108) / 100 };
      item.stock -= qty;
      orders.unshift(order);
      return structuredClone(order);
    },
  };
}
