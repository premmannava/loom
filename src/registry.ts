import type { ComponentDef } from "./component";

/** The set of components a Loom instance understands. */
export class Registry {
  private defs = new Map<string, ComponentDef>();

  constructor(defs: ComponentDef[] = []) {
    this.register(...defs);
  }

  register(...defs: ComponentDef[]): this {
    for (const d of defs) this.defs.set(d.type, d);
    return this;
  }

  get(type: string): ComponentDef | undefined {
    return this.defs.get(type);
  }

  has(type: string): boolean {
    return this.defs.has(type);
  }

  all(): ComponentDef[] {
    return [...this.defs.values()];
  }
}
