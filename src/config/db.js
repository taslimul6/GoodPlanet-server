import { MongoClient } from "mongodb";

// The driver connects lazily on the first query, so there is no explicit connect() call.
// That keeps cold starts cheap on Vercel.
const client = new MongoClient(process.env.MONGODB_URI);
const db = client.db("goodPlanet");

// Business collections (the Better Auth collections live in the same database,
// but they are owned by the Next.js client).
export const events = db.collection("events");
export const bookings = db.collection("bookedEvents"); // { eventId, email, joinedAt }
export const saved = db.collection("savedEvents"); // { eventId, email, savedAt }
export const follows = db.collection("follows"); // { email, organizer, organizerKey, followedAt }
export const waitlist = db.collection("waitlist"); // { eventId, email, createdAt }
export const locks = db.collection("eventLocks"); // { _id: eventId, at } short-lived, see withEventLock()
