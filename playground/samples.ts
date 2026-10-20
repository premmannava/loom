export interface Sample {
  label: string;
  prompt: string;
  spec: string;
}

export const samples: Record<string, Sample> = {
  map: {
    label: "World map",
    prompt: "Show me a world map with a few cities pinned, and let me pick a country.",
    spec: `state picked="none"
card
  text "World map" style=title
  text "Hover a country to see its name. Click to select it." tone=muted
  map highlight="Japan,Brazil,Kenya,Australia,Iceland" bind=picked
    pin "Tokyo" lat=35.68 lon=139.69
    pin "São Paulo" lat=-23.55 lon=-46.63
    pin "Nairobi" lat=-1.29 lon=36.82
    pin "Sydney" lat=-33.87 lon=151.21
    pin "Reykjavík" lat=64.15 lon=-21.94
  row
    text "Selected: {picked}" style=lead weight=semibold
    button "Clear selection" variant=secondary on=set:picked:none
`,
  },
  hike: {
    label: "Hike planner",
    prompt: "Plan a weekend hike for a small group and help me pack water.",
    spec: `state days=2 hikers=3 water=false
card
  text "Yosemite weekend" style=title
  text "Valley floor trails, two nights at the campground" tone=muted
  row
    stat label="Days" value={days}
    stat label="Hikers" value={hikers}
    stat label="Water (L)" value={days * hikers * 3}
  row
    button "Remove day" variant=secondary on=dec:days
    button "Add day" on=inc:days
  row
    button "Fewer hikers" variant=secondary on=dec:hikers
    button "More hikers" variant=secondary on=inc:hikers
  divider
  text "Packing" weight=semibold
  check "3 L of water per person per day" bind=water
  text "Packed. That covers {days * hikers * 3} liters for the group." tone=good if=water
  progress value={days} max=7 label="Trip length: {days} of 7 days"
`,
  },
  checkout: {
    label: "Checkout",
    prompt: "Show a checkout summary for a pair of socks with gift wrap as an option.",
    spec: `state qty=2 price=24 gift=false placed=false
card
  text "Your order" style=title
  row
    column gap=2
      text "Trail runner socks" weight=semibold
      text "Merino blend, size M" tone=muted
    stat label="Each" value="\${price}"
  row
    button "Remove one" variant=secondary on=dec:qty disabled={qty <= 1}
    stat label="Quantity" value={qty} align=center
    button "Add one" variant=secondary on=inc:qty
  check "Gift wrap (+$4)" bind=gift
  divider
  row
    text "Total" style=lead weight=semibold
    text "\${qty * price + (gift ? 4 : 0)}" style=title align=right
  button "Place order" on="set:placed:true;emit:order:{qty}" disabled=placed
  text "Order placed. A confirmation is on its way." tone=good if=placed
`,
  },
  habits: {
    label: "Habit tracker",
    prompt: "Make me a tracker for three daily habits with a streak.",
    spec: `state streak=4 goal=10 read=false walk=false drink=false
card
  text "Today's habits" style=title
  text "Streak: {streak} of {goal} days" tone=muted
  progress value={streak} max={goal}
  check "Read 20 pages" bind=read
  check "Walk 30 minutes" bind=walk
  check "Drink 2 L of water" bind=drink
  text "All three done. Log today to extend the streak." tone=good if={read && walk && drink}
  sparkle "Unknown elements are reported and skipped"
  button "Log today" on="inc:streak;set:read:false;set:walk:false;set:drink:false" disabled={!(read && walk && drink)}
`,
  },
};
