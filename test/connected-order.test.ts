import { describe, expect, it } from "vitest";
import { render } from "../src/testing";
import { orderSpec } from "../playground/connected-order/spec";
import { createDemoService } from "../playground/connected-order/service";
import { connectOrderDemo } from "../playground/connected-order/host";

describe("connected equipment example", () => {
  it("parses the example and loads service data", async () => {
    const ui = render(orderSpec);
    const host = connectOrderDemo(ui.loom, createDemoService(0, "2026-10-21"));
    await host.load();
    expect(ui.loom.diagnostics).toEqual([]);
    expect(ui.loom.state.get("equipment")).toHaveLength(6);
    expect(ui.loom.state.get("loading")).toBe(false);
    host.dispose();
    ui.loom.destroy();
  });
  it("returns an order and updates stock; ignores a duplicate in-flight submission", async () => {
    const ui = render(orderSpec);
    const service = createDemoService(0, "2026-10-21");
    const host = connectOrderDemo(ui.loom, service);
    await host.load();
    ui.loom.state.set("selected", "laptop");
    ui.loom.state.set("quantity", 2);
    ui.loom.state.set("delivery", "2026-11-10");
    await Promise.all([host.submit(), host.submit()]);
    expect(await service.orders()).toMatchObject([{ id: "DEMO-001", total: 2592 }]);
    expect((await service.catalog())[0]?.stock).toBe(6);
    expect(ui.loom.state.get("orders")).toHaveLength(1);
    expect(ui.loom.state.get("submitting")).toBe(false);
    host.dispose();
    ui.loom.destroy();
  });
  it("does not create orders on failure and permits a successful retry", async () => {
    const service = createDemoService(0, "2026-10-21");
    const order = { equipmentId: "tablet", quantity: 1, deliveryDate: "2026-11-10" };
    await expect(service.submit(order, true)).rejects.toThrow("Simulated");
    expect(await service.orders()).toHaveLength(0);
    await expect(service.submit({ ...order, quantity: 5 })).rejects.toThrow("Only 4");
    await expect(service.submit({ ...order, deliveryDate: "2026-02-30" })).rejects.toThrow("delivery date");
    expect((await service.catalog())[2]?.stock).toBe(4);
    await expect(service.submit(order)).resolves.toMatchObject({ id: "DEMO-001", total: 648 });
  });
});
