import { Router } from "express";

import { bookings, events, saved, waitlist } from "../config/db.js";
import { getEmail, verifyJWT } from "../middleware/auth.js";
import { fillFromWaitlist, pickEventFields, toObjectId, withCounts } from "../utils/events.js";
import { route, withEmail } from "../utils/http.js";

const router = Router();

/**
 * Loads the event from `:id` and makes sure the caller owns it.
 * Sends the error response itself and returns null when the request must stop.
 */
async function loadOwnedEvent(req, res) {
  const _id = toObjectId(req.params.id);
  const event = _id && (await events.findOne({ _id }));

  if (!event) {
    res.status(404).send({ message: "Event not found" });
    return null;
  }
  if (!getEmail(req) || event.email !== getEmail(req)) {
    res.status(403).send({ message: "You can only change your own events" });
    return null;
  }
  return event;
}

// ---------- Public lists ----------

router.get("/", route("Failed to fetch events", async (req, res) => {
  res.send(await withCounts(await events.find().toArray()));
}));

router.get("/featured", route("Failed to fetch events", async (req, res) => {
  res.send(await withCounts(await events.find().limit(6).toArray()));
}));

// ---------- Single event ----------

router.get("/event/:id", verifyJWT, route("Failed to fetch event", async (req, res) => {
  const _id = toObjectId(req.params.id);
  const event = _id && (await events.findOne({ _id }));

  if (!event) return res.status(404).send({ message: "Event not found" });
  res.send(event);
}));

// The owner is always the caller (from the token), whatever the body says.
router.post("/event", verifyJWT, withEmail("Failed to create event", async (req, res, email) => {
  const result = await events.insertOne({ ...pickEventFields(req.body), email, participants: [] });
  res.status(201).send(result);
}));

router.put("/event/:id", verifyJWT, route("Failed to update event", async (req, res) => {
  const event = await loadOwnedEvent(req, res);
  if (!event) return;

  const changes = pickEventFields(req.body);
  if (!Object.keys(changes).length) return res.status(400).send({ message: "Nothing to update" });

  const result = await events.updateOne({ _id: event._id }, { $set: changes });

  // the capacity may have been raised -> let waitlisted people in
  const promoted = await fillFromWaitlist(String(event._id));

  res.send({ message: "Event updated successfully", result, promoted });
}));

router.delete("/event/:id", verifyJWT, route("Failed to delete event", async (req, res) => {
  const event = await loadOwnedEvent(req, res);
  if (!event) return;

  const eventId = String(event._id);
  const result = await events.deleteOne({ _id: event._id });

  // remove everything that points to the deleted event
  await Promise.all([
    bookings.deleteMany({ eventId }),
    saved.deleteMany({ eventId }),
    waitlist.deleteMany({ eventId }),
  ]);

  res.send(result);
}));

// ---------- Events created by the caller ----------

router.get("/myEvents", verifyJWT, withEmail("Server error", async (req, res, email) => {
  res.send(await events.find({ email }).toArray());
}));

export default router;
