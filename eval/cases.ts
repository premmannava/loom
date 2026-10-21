/**
 * The evaluation set: requests a model should be able to turn into Loom.
 * `expect` lists elements a good answer uses; a list inside it means any one
 * of them will do. Traps check that models stay within the language.
 */
export interface EvalCase {
  id: string;
  category: "form" | "compare" | "dashboard" | "shop" | "navigation" | "content" | "interactive" | "trap";
  request: string;
  expect?: Array<string | string[]>;
  /** What a trap is testing, for the report. */
  note?: string;
}

export const cases: EvalCase[] = [
  // Forms
  { id: "form-booking", category: "form", request: "A booking form for a mountain cabin: 2 to 6 guests, 1 to 14 nights, and a Book button.", expect: ["stepper", "button"] },
  { id: "form-settings", category: "form", request: "Notification settings with switches for email, SMS and push notifications, and a Save button.", expect: ["switch", "button"] },
  { id: "form-survey", category: "form", request: "A one-question survey: how did you hear about us? Pick one of four answers, then Submit.", expect: ["radio", "button"] },
  { id: "form-checklist", category: "form", request: "A packing checklist for a day hike with six items and a bar showing how many are packed.", expect: ["check", "progress"] },

  // Comparisons
  { id: "compare-laptops", category: "compare", request: "Compare two laptops side by side: price, weight and battery life, with a button to choose each.", expect: [["row", "grid"], "button"] },
  { id: "compare-plans", category: "compare", request: "Three pricing plans (Free, Pro, Team) with their main features and a Choose button for each.", expect: ["card", "button"] },

  // Dashboards
  { id: "dash-sales", category: "dashboard", request: "A sales dashboard for today: revenue, orders, average order value and conversion rate.", expect: ["stat"] },
  { id: "dash-running", category: "dashboard", request: "My running this week: total distance, longest run, and progress toward a 40 km goal.", expect: ["stat", "progress"] },
  { id: "dash-habits", category: "dashboard", request: "A water tracker: a button to add a glass, and progress toward 8 glasses a day.", expect: ["button", "progress"] },

  // Shopping
  { id: "shop-product", category: "shop", request: "A product page for waterproof hiking boots: sizes 8 to 12, a star rating, the price, and Add to cart.", expect: [["radio", "stepper"], "rating", "button"] },
  { id: "shop-cart", category: "shop", request: "A shopping cart with three items whose quantities I can change, and the total price.", expect: ["stepper"] },
  { id: "shop-filter", category: "shop", request: "Let me filter tents by maximum price with a slider, and list the three tents with their prices.", expect: ["slider", ["list", "card"]] },
  { id: "shop-sale", category: "shop", request: "A sale banner card for a rain jacket, was $160 now $128, with a Shop now button.", expect: ["card", "button"] },

  // Navigation
  { id: "nav-onboarding", category: "navigation", request: "A three-step onboarding: welcome, choose your interests, all set. With Next and Back buttons.", expect: ["screen"] },
  { id: "nav-checkout", category: "navigation", request: "A checkout with three screens: cart, shipping method, and order confirmation.", expect: ["screen"] },
  { id: "nav-recipe", category: "navigation", request: "A recipe for pancakes with tabs for ingredients, steps and notes.", expect: ["tabs"] },
  { id: "nav-faq", category: "navigation", request: "An FAQ about shipping with four questions that open to show their answers.", expect: ["accordion"] },
  { id: "nav-results", category: "navigation", request: "Page 2 of 9 of search results for trail shoes, with a way to change page.", expect: ["pagination"] },

  // Content
  { id: "content-profile", category: "content", request: "A profile card for a trail guide: name, role, rating out of 5, and a Contact button.", expect: ["avatar", "button"] },
  { id: "content-empty", category: "content", request: "What to show when a search for hotels finds nothing.", expect: ["empty"] },
  { id: "content-loading", category: "content", request: "A loading placeholder for a list of news articles.", expect: ["skeleton"] },
  { id: "content-install", category: "content", request: "Show how to install our command line tool with npm.", expect: ["code"] },
  { id: "content-status", category: "content", request: "Order status for a package: ordered, shipped, out for delivery (current), delivered.", expect: [["list", "text", "badge"]] },

  // Interactive
  { id: "int-quiz", category: "interactive", request: "A quiz question about which planet is largest, with four answers, that tells me if I'm right.", expect: [["radio", "button"]] },
  { id: "int-tip", category: "interactive", request: "A tip calculator for a $64 bill: tip from 10 to 25 percent with a slider, split between 1 to 6 people.", expect: ["slider", "stepper"] },
  { id: "int-map", category: "interactive", request: "Show the countries I've visited, Japan, Peru and Kenya, with a pin on each capital.", expect: ["map", "pin"] },

  // Traps: staying inside the language
  { id: "trap-red", category: "trap", request: "A big red Buy now button.", expect: ["button"], note: "No colors in Loom: the closest role is variant=danger." },
  { id: "trap-css", category: "trap", request: "A card with a blue background and 18px Helvetica text saying Welcome back.", expect: ["card"], note: "No backgrounds, sizes or fonts: should ignore them, not invent props." },
  { id: "trap-login", category: "trap", request: "A login form with email and password fields.", note: "Loom has no text input yet: inventing an input element is an error." },
  { id: "trap-prose", category: "trap", request: "Explain what you are.", note: "Should still answer in Loom, not prose." },
];
