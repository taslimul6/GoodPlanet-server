import { Router } from "express";

import { bookings, events, waitlist } from "../config/db.js";
import { verifyJWT } from "../middleware/auth.js";
import { capacityOf, eventsByIds, fillFromWaitlist, toObjectId, withEventLock } from "../utils/events.js";
import { withEmail } from "../utils/http.js";

const router = Router();

// ---------- Join / cancel ----------

router.post("/event/join", verifyJWT, withEmail("Failed to join event.", async (req, res, email) => {
  const eventId = String(req.body.eventId ?? "");
  const _id = toObjectId(eventId);
  if (!_id) return res.status(400).send({ message: "eventId is required" });

  const event = await events.findOne({ _id });
  if (!event) return res.status(404).send({ message: "Event not found" });

  const cap = capacityOf(event);

  // One join at a time per event, so the last seat goes to exactly one person.
  const outcome = await withEventLock(eventId, async () => {
    if (await bookings.findOne({ eventId, email })) return { conflict: "You have already joined this event." };
    if (cap > 0 && (await bookings.countDocuments({ eventId })) >= cap) return { full: true };

    return { result: await bookings.insertOne({ eventId, email, joinedAt: new Date() }) };
  });

  if (outcome.conflict) return res.status(409).send({ message: outcome.conflict });
  if (outcome.full) return res.status(409).send({ message: "This event is full.", full: true });

  // joined directly, so no longer waiting
  await waitlist.deleteOne({ eventId, email });

  res.status(201).send({ message: "Successfully joined the event.", result: outcome.result });
}));

// Two path segments on purpose: it must not clash with DELETE /event/:id.
router.delete("/event/join/:eventId", verifyJWT, withEmail("Failed to cancel participation.", async (req, res, email) => {
  const { eventId } = req.params;

  const { deletedCount } = await bookings.deleteOne({ eventId, email });
  if (!deletedCount) return res.status(404).send({ message: "You have not joined this event." });

  // a spot just opened up: the first person on the waitlist gets it
  const promoted = await fillFromWaitlist(eventId);

  res.send({ message: "Successfully cancelled your participation.", promoted });
}));

// ---------- Capacity + waitlist ----------

// Everything the event page needs in one call.
router.get("/event/capacity/:id", verifyJWT, withEmail("Failed to load capacity", async (req, res, email) => {
  const { id } = req.params;
  const _id = toObjectId(id);
  const event = _id && (await events.findOne({ _id }));
  if (!event) return res.status(404).send({ message: "Event not found" });

  const capacity = capacityOf(event);

  const [joined, waitlistCount, mine, myWait] = await Promise.all([
    bookings.countDocuments({ eventId: id }),
    waitlist.countDocuments({ eventId: id }),
    bookings.findOne({ eventId: id, email }),
    waitlist.findOne({ eventId: id, email }),
  ]);

  const position = myWait
    ? await waitlist.countDocuments({ eventId: id, createdAt: { $lte: myWait.createdAt } })
    : null;

  res.send({
    capacity, // 0 = unlimited
    joined,
    spotsLeft: capacity > 0 ? Math.max(0, capacity - joined) : null,
    full: capacity > 0 && joined >= capacity,
    joinedByMe: Boolean(mine),
    onWaitlist: Boolean(myWait),
    position,
    waitlistCount,
  });
}));

router.post("/event/waitlist", verifyJWT, withEmail("Failed to join waitlist", async (req, res, email) => {
  const eventId = String(req.body.eventId ?? "");
  const _id = toObjectId(eventId);
  if (!_id) return res.status(400).send({ message: "eventId is required" });

  const event = await events.findOne({ _id });
  if (!event) return res.status(404).send({ message: "Event not found" });

  if (await bookings.findOne({ eventId, email })) {
    return res.status(409).send({ message: "You have already joined this event." });
  }

  const cap = capacityOf(event);
  if (cap === 0 || (await bookings.countDocuments({ eventId })) < cap) {
    return res.status(409).send({ message: "There is space, you can join directly." });
  }

  const entry = await waitlist.findOneAndUpdate(
    { eventId, email },
    { $setOnInsert: { eventId, email, createdAt: new Date() } },
    { upsert: true, returnDocument: "after" }
  );
  const position = await waitlist.countDocuments({ eventId, createdAt: { $lte: entry.createdAt } });

  res.status(201).send({ onWaitlist: true, position });
}));

router.delete("/event/waitlist/:eventId", verifyJWT, withEmail("Failed to leave waitlist", async (req, res, email) => {
  await waitlist.deleteOne({ eventId: req.params.eventId, email });
  res.send({ onWaitlist: false });
}));

// ---------- Events the caller has joined ----------

// Returns the live event documents (not a copy taken when the user joined),
// so edits made by the organizer show up right away.
router.get("/bookedEvents", verifyJWT, withEmail("Server error", async (req, res, email) => {
  const rows = await bookings.find({ email }).sort({ _id: -1 }).toArray();
  const byId = await eventsByIds(rows.map((b) => b.eventId));

  res.send(
    rows
      .map((b) => byId.get(String(b.eventId)))
      .filter(Boolean)
      .map((e) => ({ ...e, eventId: String(e._id) }))
  );
}));

export default router;
