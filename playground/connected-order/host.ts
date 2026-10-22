import type { SayShape } from "../../src/index";
import { createDemoService } from "./service";

/** Host adapter: SayShape emits intent; this code calls the service and returns state. */
export function connectOrderDemo(loom: SayShape, service = createDemoService()) {
  let busy = false;
  let disposed = false;
  const events: string[] = [];
  const log = (message: string) => {
    events.unshift(message);
    loom.state.set("events", events.slice(0, 12));
  };
  const refresh = async () => {
    const equipment = await service.catalog();
    if (!disposed) loom.state.set("equipment", equipment);
  };
  async function load() {
    if (busy || disposed) return;
    busy = true;
    loom.state.set("loading", true);
    loom.state.set("message", "Loading equipment from the demo service…");
    log("HOST → SERVICE: load catalog");
    try {
      await refresh();
      if (disposed) return;
      log("SERVICE → LOOM: catalog loaded into equipment state");
      loom.state.set("message", "Catalog ready. Select equipment and a delivery date.");
    } catch {
      if (!disposed) loom.state.set("message", "Catalog could not be loaded. Try Refresh catalog.");
    } finally {
      busy = false;
      if (!disposed) loom.state.set("loading", false);
    }
  }
  async function submit() {
    if (busy || disposed) return;
    busy = true;
    // Snapshot the request so later edits cannot change an in-flight order.
    const request = { equipmentId: loom.state.get("selected"), quantity: loom.state.get("quantity"), deliveryDate: loom.state.get("delivery") };
    const fail = loom.state.get("simulateFailure") === true;
    loom.state.set("submitting", true);
    loom.state.set("message", "Submitting your request…");
    log(`LOOM → HOST: submit_order (${String(request.equipmentId)}, quantity ${String(request.quantity)})`);
    try {
      const order = await service.submit(request, fail);
      if (disposed) return;
      loom.state.set("orders", await service.orders());
      await refresh();
      if (disposed) return;
      loom.state.set("message", `${order.id} accepted — ${order.quantity} × ${order.name}, delivery ${order.deliveryDate}.`);
      log(`SERVICE → LOOM: ${order.id} accepted; orders and stock updated`);
    } catch (error) {
      if (disposed) return;
      const message = error instanceof Error ? error.message : "Submission failed. Please retry.";
      loom.state.set("message", message);
      log(`SERVICE → LOOM: ${message}`);
    } finally {
      busy = false;
      if (!disposed) loom.state.set("submitting", false);
    }
  }
  loom.state.set("earliest", service.earliest);
  loom.state.set("latest", service.latest);
  const unsubscribe = loom.on("action", ({ name }) => {
    if (name === "submit_order") void submit();
    if (name === "refresh_catalog") void load();
  });
  return { load, submit, get busy() { return busy; }, dispose() { disposed = true; unsubscribe(); } };
}
