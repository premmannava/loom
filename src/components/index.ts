import type { ComponentDef } from "../component";
import { avatar, badge, code, progress, stat, text } from "./content";
import { empty, skeleton } from "./feedback";
import { button, check, link, radio, rating, slider, stepper, switchToggle } from "./input";
import { accordion, card, column, divider, each, grid, list, listItem, row, spacer } from "./layout";
import { image } from "./media";
import { breadcrumb, pagination, screen, tab, tabs } from "./navigation";

export {
  column, row, grid, card, list, listItem, accordion, divider, spacer, each,
  text, image, code, badge, avatar,
  stat, rating,
  button, link, check, switchToggle, radio, stepper, slider,
  screen, tabs, tab, breadcrumb, pagination,
  progress, skeleton, empty,
};

/** The built-in components (everything except the map, which is a separate entry). */
export const coreComponents: ComponentDef[] = [
  column, row, grid, card, list, listItem, accordion, divider, spacer, each,
  text, image, code, badge, avatar,
  stat, rating,
  button, link, check, switchToggle, radio, stepper, slider,
  screen, tabs, tab, breadcrumb, pagination,
  progress, skeleton, empty,
];
