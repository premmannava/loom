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
  product: {
    label: "Product page",
    prompt: "Show me the trail runners with sizes, reviews and shipping info.",
    spec: `state at="Trail runners" size=10 qty=1 view=details stars=0 shipping=false added=false
breadcrumb "Shop / Shoes / Trail runners" bind=at
card
  row align=top
    column gap=6
      badge "Waterproof" tone=good
      text "Ridgeline trail runners" style=title
      rating value=4.6
    column gap=2
      text "$128" style=title align=right
      text "$160" tone=muted align=right strike=true
  text "Size" weight=semibold
  row
    radio "9" bind=size value=9
    radio "10" bind=size value=10
    radio "11" bind=size value=11
  stepper "Quantity" bind=qty min=1 max=5
  button "Add {qty} to cart" on="set:added:true;emit:add_to_cart:{size}" disabled=added
  text "Added size {size} to your cart." tone=good if=added
  tabs bind=view
    tab "Details" value=details
      text "A grippy, waterproof trail shoe with a 6 mm drop."
      list
        list-item "Weight" trailing="280 g"
        list-item "Upper" trailing="Recycled mesh"
    tab "Reviews" value=reviews
      avatar "Maya Ortiz" detail="Hiked the John Muir Trail"
      text "Dry feet through three river crossings."
      text "Rate them" weight=semibold
      rating bind=stars on=emit:rated:{stars}
  accordion "Shipping and returns" bind=shipping
    text "Free shipping over $100. Free returns within 30 days."
`,
  },
  finder: {
    label: "Gear finder",
    prompt: "Help me find trail shoes under a budget, then show me the one I pick.",
    spec: `state maxPrice=150 picked="Ridgeline" price=128 photo="photo-1606036525923-525fa3b35465" cart=0
screen name=browse title="Trail shoes"
  slider "Up to \${maxPrice}" bind=maxPrice min=50 max=200 step=5
  list if={maxPrice >= 95}
    list-item "Switchback" detail="Light and fast, 240 g" trailing="$95" on="set:picked:Switchback;set:price:95;set:photo:photo-1600185365926-3a2ce3cdb9eb;go:shoe" if={maxPrice >= 95}
    list-item "Ridgeline" detail="Waterproof leather, 480 g" trailing="$128" on="set:picked:Ridgeline;set:price:128;set:photo:photo-1606036525923-525fa3b35465;go:shoe" if={maxPrice >= 128}
    list-item "Summit Pro" detail="Rock plate, 310 g" trailing="$175" on="set:picked:Summit Pro;set:price:175;set:photo:photo-1655976795374-6b519928f1e1;go:shoe" if={maxPrice >= 175}
  empty "Nothing under \${maxPrice}" detail="Our lightest pair starts at $95." action="Show all" on=set:maxPrice:200 if={maxPrice < 95}
screen name=shoe title="{picked}"
  image "{picked} trail shoes" src="https://images.unsplash.com/{photo}?w=1000&q=70&auto=format&fit=crop" ratio=4:3
  row
    rating value=4.6
    text "\${price}" style=title align=right
  button "Add to cart" on="inc:cart;notify:'Added {picked}. {cart} in your cart'"
  button "Back to results" variant=secondary on=back
  text "Photos from Unsplash" style=caption tone=muted
`,
  },
  gallery: {
    label: "Trail gear",
    prompt: "Show me some trail gear with photos.",
    spec: `state saved=0
image "Two hikers walking a trail toward snow-capped mountains" src="https://images.unsplash.com/photo-1551632811-561732d1e306?w=1600&q=70&auto=format&fit=crop" ratio=16:9
text "Gear for the trail" style=title
text "Tap an item to save it." tone=muted
grid min=150 gap=12
  card pad=12 gap=8 on="inc:saved;notify:'Saved the Ridge pack'"
    image "Green and brown backpack on a rock" src="https://images.unsplash.com/photo-1622260614153-03223fb72052?w=700&q=70&auto=format&fit=crop" ratio=1:1
    text "Ridge 40L pack" weight=semibold
    text "$149" tone=muted
  card pad=12 gap=8 on="inc:saved;notify:'Saved the Basecamp tent'"
    image "Orange camping tent near green trees" src="https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=700&q=70&auto=format&fit=crop" ratio=1:1
    text "Basecamp 2P tent" weight=semibold
    text "$289" tone=muted
  card pad=12 gap=8 on="inc:saved;notify:'Saved the Ridgeline boots'"
    image "Brown leather lace-up boots" src="https://images.unsplash.com/photo-1606036525923-525fa3b35465?w=700&q=70&auto=format&fit=crop" ratio=1:1
    text "Ridgeline boots" weight=semibold
    text "$128" tone=muted
  card pad=12 gap=8 on="inc:saved;notify:'Saved the Switchback runners'"
    image "White and orange running shoe on a plain background" src="https://images.unsplash.com/photo-1600185365926-3a2ce3cdb9eb?w=700&q=70&auto=format&fit=crop" ratio=1:1 fit=contain
    text "Switchback runners" weight=semibold
    text "$95" tone=muted
text "{saved} saved" tone=good if={saved > 0}
divider
row align=top
  image "A hiker with a large backpack on a rocky peak at golden hour" src="https://images.unsplash.com/photo-1586022045497-31fcf76fa6cc?w=800&q=70&auto=format&fit=crop" ratio=3:4
  column gap=6
    text "Golden hour on the ridge" style=lead weight=semibold
    text "A tall 3:4 photo beside text. The image keeps its shape at any width." tone=muted
divider
text "Blocked on purpose" weight=semibold
text "This image's host isn't in imageHosts, so it shows its description instead." tone=muted
image "A photo from a site the app hasn't allowed" src="https://example.org/photo.jpg" ratio=3:2
text "Photos from Unsplash" style=caption tone=muted
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
