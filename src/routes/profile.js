import { Router } from "express";

import { bookings, events, follows, saved } from "../config/db.js";
import { verifyJWT } from "../middleware/auth.js";
import { eventsByIds, hoursOf, todayString } from "../utils/events.js";
import { withEmail } from "../utils/http.js";

const router = Router();

// Counters for the profile page plus the volunteer hours log.
// An event counts as volunteered time once its date has passed.
router.get("/profile/stats", verifyJWT, withEmail("Failed to load profile stats", async (req, res, email) => {
  const [joinedRows, created, savedCount, following] = await Promise.all([
    bookings.find({ email }).toArray(),
    events.countDocuments({ email }),
    saved.countDocuments({ email }),
    follows.countDocuments({ email }),
  ]);

  const joinedEvents = [...(await eventsByIds(joinedRows.map((b) => b.eventId))).values()];
  const today = todayString();

  const finished = joinedEvents.filter((e) => String(e.date ?? "") < today);
  const history = finished
    .map((e) => ({
      eventId: String(e._id),
      title: e.title,
      category: e.category,
      location: e.location,
      date: e.date,
      hours: hoursOf(e),
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  res.send({
    joined: joinedEvents.length,
    upcoming: joinedEvents.length - finished.length,
    completed: finished.length,
    created,
    saved: savedCount,
    following,
    volunteerHours: history.reduce((sum, h) => sum + h.hours, 0),
    history: history.slice(0, 20),
  });
}));

export default router;
