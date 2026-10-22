export const orderSpec = `
state equipment=[] orders=[] events=[]
state department="All" departments=["All","Engineering","Design","Sales"]
state selected="" quantity=1 delivery="" earliest="" latest=""
state sortField="name" sortDirection="asc" activityOpen=false
state loading=true submitting=false simulateFailure=false message="Loading equipment from the demo service…"
derive visible={department == 'All' ? equipment : filter(equipment, 'team', department)}
derive item={find(equipment, 'id', selected)}
derive subtotal={item ? item.price * quantity : 0}
derive total={round(subtotal * 1.08, 2)}

column
  text "Equipment desk" style=title
  text "A connected SayShape demo. Orders are simulated and reset when this page reloads."
  link "Back to the playground" on=emit:playground
  select "Department" items=departments bind=department disabled={loading || submitting}
  text "Fetching the catalog…" if={loading}
  table "Choose your equipment" items=visible key=id bind=selected sort=sortField direction=sortDirection if={!loading}
    table-column "Equipment" field=name
    table-column "Price" field=price format=money
    table-column "Stock" field=stock format=number
  card
    text "Review your request" style=lead
    text "{item ? item.name : 'Select a row above to get started'}"
    text "Quantity"
    stepper bind=quantity min=1 max=10 if={!submitting}
    text "{quantity}" if={submitting}
    date-picker "Delivery date" bind=delivery min={earliest} max={latest} required=true disabled={submitting}
    stat label="Total including 8% tax" value={money(total)}
    check "Simulate a service failure" bind=simulateFailure if={!submitting}
    button "{submitting ? 'Submitting…' : 'Place demo order'}" disabled={loading || submitting || !item || delivery == ''} on=emit:submit_order
    text "{message}"
    button "Refresh catalog" variant=secondary disabled={loading || submitting} on=emit:refresh_catalog
  table "Orders accepted by the service" items=orders
    table-column "Order" field=id
    table-column "Equipment" field=name
    table-column "Total" field=total format=money
  accordion "Host activity — see the connection" bind=activityOpen
    each items=events as=event
      text "{event}"
`;

// The host owns data and calculations; the model only replaces the UI below.
export const orderPrelude = orderSpec.slice(0, orderSpec.indexOf("\ncolumn\n"));
export const orderBody = orderSpec.slice(orderSpec.indexOf("\ncolumn\n") + 1);
