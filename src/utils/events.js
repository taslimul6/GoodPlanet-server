import { ObjectId } from "mongodb";

import { bookings, events, locks, waitlist } from "../config/db.js";

export const DEFAULT_VOLUNTEER_HOURS = 4;

/** Event fields a client may set. Anything else in a request body is ignored. */
const EVENT_FIELDS = [
  "title",
  "category",
  "organizer",
  "description",
  "date",
  "location",
  "image",
  "capacity",
  "hours",
  "createdBy",
];

export const pickEventFields = (body = {}) =>
  Object.fromEntries(EVENT_FIELDS.filter((f) => body[f] !== undefined).map((f) => [f, body[f]]));

/** ObjectId from a string, or null when the string is not a valid id. */
export const toObjectId = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

/** Capacity is stored as a string or number. 0, empty or invalid means unlimited. */
export const capacityOf = (event) => {
  const n = Number(event?.capacity);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Volunteer hours credited for an event (organizer value, or the default). */
export const hoursOf = (event) => (Number(event?.hours) > 0 ? Number(event.hours) : DEFAULT_VOLUNTEER_HOURS);

/** Today in Bangladesh time (UTC+6) as YYYY-MM-DD, comparable with `event.date`. */
export const todayString = () => new Date(Date.now() + 6 * 3600 * 1000).toISOString().slice(0, 10);

/** Case-insensitive key used to match organizer names. */
export const orgKey = (name) => String(name ?? "").trim().toLowerCase();

/** Looks up many events at once: Map of event id (string) -> event document. */
export async function eventsByIds(ids) {
  const objectIds = [...new Set(ids)].map(toObjectId).filter(Boolean);
  if (!objectIds.length) return new Map();

  const found = await events.find({ _id: { $in: objectIds } }).toArray();
  return new Map(found.map((e) => [String(e._id), e]));
}

/** Adds `bookedCount` (people who joined) to every event using a single aggregate. */
export async function withCounts(list) {
  const counts = await bookings.aggregate([{ $group: { _id: "$eventId", n: { $sum: 1 } } }]).toArray();
  const byId = new Map(counts.map((c) => [String(c._id), c.n]));
  return list.map((e) => ({ ...e, bookedCount: byId.get(String(e._id)) ?? 0 }));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `task` while holding a lock on one event, so that joins and waitlist promotions for
 * that event happen one at a time. Without it, two people taking the last seat at the same
 * moment can both be turned away (or both let in).
 *
 * The lock is a document whose _id is the event id: MongoDB refuses a second insert with the
 * same _id (error 11000), which makes "taking the lock" atomic across every server instance.
 * A lock older than 10 seconds belongs to a crashed request and is removed.
 */
export async function withEventLock(eventId, task) {
  const giveUpAt = Date.now() + 3000;

  for (;;) {
    try {
      await locks.insertOne({ _id: eventId, at: new Date() });
      break;
    } catch (err) {
      if (err.code !== 11000) throw err; // a real error, not "somebody else holds the lock"

      await locks.deleteOne({ _id: eventId, at: { $lt: new Date(Date.now() - 10_000) } });
      if (Date.now() > giveUpAt) throw new Error("Event is busy, please try again");
      await sleep(20 + Math.random() * 40);
    }
  }

  try {
    return await task();
  } finally {
    await locks.deleteOne({ _id: eventId });
  }
}

/**
 * Moves people from the waitlist into the event while there is free space, oldest first.
 * Call it whenever a spot may have opened: a cancellation or a higher capacity.
 * Returns how many people were promoted.
 */
export async function fillFromWaitlist(eventId) {
  const _id = toObjectId(eventId);
  const event = _id && (await events.findOne({ _id }));
  if (!event) return 0;

  const cap = capacityOf(event);

  return withEventLock(eventId, async () => {
    let promoted = 0;

    while (cap === 0 || (await bookings.countDocuments({ eventId })) < cap) {
      const next = await waitlist.findOneAndDelete({ eventId }, { sort: { createdAt: 1 } });
      if (!next) break;

      if (!(await bookings.findOne({ eventId, email: next.email }))) {
        await bookings.insertOne({ eventId, email: next.email, joinedAt: new Date() });
        promoted++;
      }
    }
    return promoted;
  });
}
