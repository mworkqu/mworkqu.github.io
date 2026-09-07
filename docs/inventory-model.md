# Inventory model

Two separate inventories. They only ever touch through a paid order.

| | Owner | Read by |
|---|---|---|
| **Store stock** | GESTALTUNG | the public shop |
| **Client inventory** | each client, private | that client's dashboard |

## Store stock

Three numbers per SKU, in `data/products.json`:

```
onHand       physically on the shelf
committed    sold or reserved, not yet shipped
available    onHand − committed          ← the only number the shop offers
```

Plus `reorderPoint`. When `available` drops to or below it the card reads
"Only N left"; at zero it becomes "Made to order · N days" and an order
becomes a production job rather than a stock pick.

Offering `available` rather than `onHand` is what stops the same unit being
promised to two buyers.

## Client inventory

A part the client owns is always in exactly one of two places:

- **in his inventory** — free, not committed to anything
- **on a project** — held until the job is built

Nothing sits in between, so the two always add up to everything he owns.

### How parts get in

| Path | Lands in |
|---|---|
| He adds his own part by hand | inventory |
| He buys from the shop while browsing | inventory |
| He buys from inside a project's parts list | that project |

A cart line added from a project keeps a hidden reference to it, which is why
one Amazon-style cart can still route parts to the right place on delivery.

### How parts move

- **Adding a part from inventory to a project deducts it immediately.** If he
  asks for more than he has, the line splits: what he owns comes off the shelf
  now, the remainder goes to the cart.
- **Removing a line returns that part to inventory.** Cancelling a project does
  the same for every line at once — same rule, different scale.
- **Building the job consumes the parts.** That is the only way out.

Parts bought for a project but never used come back to inventory if the
project is cancelled, so nothing is ever stranded.

## The stock ledger

`onHand` for a store product is never a number anybody types. It is:

```
products.json onHand
  + every movement the ledger recorded coming in
  - everything delivered to clients
```

Receiving a delivery and finishing a batch each write a ledger line with a
date, the SKU, the change, a reason and a reference. So a figure that looks
wrong can always be traced to the movement that caused it. An editable
quantity field cannot be audited; a ledger can.

## Reordering

When a product's `available` falls to or below its `reorderPoint`, the admin
stock page flags it — unless a batch job for it is already open, in which case
it stays quiet rather than nagging about work already in hand.

Making a batch is: create the job, assign a workshop, release it. The workshop
marks it ready with **how many it actually made**, which may be fewer than
ordered. Only what was made becomes stock; the shortfall stays on the job
record rather than quietly disappearing.

## What each role sees

| | Sees | Can change |
|---|---|---|
| **Client** | His projects, his shelf, his cart, quotes sent to him | Parts on a project, cart, approve a quote |
| **Vendor** | Only jobs assigned to him. No prices, no client names. | Start a job, mark it ready |
| **Admin** | Store stock, every job, every client project | Everything |

## How a quote is built

The client buys his own parts through the shop, so those are already paid for.
The quote covers **the work** — design hours, production, contingency — and
then shows the whole project cost so nothing is a surprise:

```
Design            hours x rate
Production        assembly and finishing
Contingency       % of the above
                  ----------
Quoted to the client

Already paid      parts bought from the shop for this project
From his shelf    his own stock, no charge
Supplied by him   no charge
                  ----------
Whole project cost
```

**Sending freezes the figures.** A quote is a snapshot; a later price change
must not move a number the client has already been shown.

## Job states

Seven, shared by every job type:

```
NEW → REVIEW → QUOTED → APPROVED → PRODUCTION → READY → CLOSED
                                  ↘ ON HOLD   ↘ CANCELLED
```

Roles see the same states through different filters. Vendors see only jobs
assigned to them, without prices or client names.

## Demo mode

There is no backend. Client state (inventory, cart, projects, orders) lives in
`localStorage` under `gestaltung.client.v1`, seeded once from
`data/client-inventory.json`. Store stock is read-only from
`data/products.json`; demo purchases add a reservation on top of `committed`
so the shop's availability reacts, without writing to the file.
