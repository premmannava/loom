import type { ComponentDef } from "../component";
import { stat, text, progress } from "./content";
import { button, check } from "./input";
import { card, column, divider, row, spacer } from "./layout";

export { card, column, divider, row, spacer, text, stat, progress, button, check };

/** The built-in components (everything except the map, which is a separate entry). */
export const coreComponents: ComponentDef[] = [column, row, card, divider, spacer, text, stat, progress, button, check];
