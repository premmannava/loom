import type { ComponentDef } from "../component";
import { chart } from "./chart";
import { table, tableColumn } from "./table";
import { select } from "./select";
import { datePicker } from "./date-picker";
import { avatar, badge, code, icon, progress, stat, text } from "./content";
import { empty, skeleton } from "./feedback";
import { button, check, input, link, radio, rating, slider, stepper, switchToggle } from "./input";
import { accordion, card, column, divider, each, grid, list, listItem, row, spacer } from "./layout";
import { image } from "./media";
import { breadcrumb, pagination, screen, tab, tabs } from "./navigation";
import { callout } from "./callout";
import { step, timeline } from "./timeline";
import { segmented } from "./segmented";
import { carousel } from "./carousel";
import { compare, compareRow } from "./compare";

export {
  column, row, grid, card, list, listItem, accordion, divider, spacer, each, timeline, step, carousel,
  text, image, code, badge, avatar, callout, icon,
  stat, rating, chart, table, tableColumn, compare, compareRow,
  button, link, check, switchToggle, radio, select, datePicker, stepper, slider, input, segmented,
  screen, tabs, tab, breadcrumb, pagination,
  progress, skeleton, empty,
};

/** The built-in components (everything except the map, which is a separate entry). */
export const coreComponents: ComponentDef[] = [
  column, row, grid, card, list, listItem, accordion, divider, spacer, each, timeline, step, carousel,
  text, image, code, badge, avatar, callout, icon,
  stat, rating, chart, table, tableColumn, compare, compareRow,
  button, link, check, switchToggle, radio, select, datePicker, stepper, slider, input, segmented,
  screen, tabs, tab, breadcrumb, pagination,
  progress, skeleton, empty,
];
