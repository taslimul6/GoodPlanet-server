import { Router } from "express";

import { saved } from "../config/db.js";
import { verifyJWT } from "../middleware/auth.js";
import { eventsByIds } from "../utils/events.js";
import { withEmail } from "../utils/http.js";

const router = Router();

// Bookmarked events as full event documents, most recently saved first.
router.get("/saved", verifyJWT, withEmail("Failed to fetch saved events", async (req, res, email) => {
  const rows = await saved.find({ email }).sort({ savedAt: -1 }).toArray();
  const byId = await eventsByIds(rows.map((s) => s.eventId));

  res.send(rows.map((s) => byId.get(String(s.eventId))).filter(Boolean));
}));

// Only the ids: a cheap way for a list page to know which cards are bookmarked.
router.get("/saved/ids", verifyJWT, withEmail("Failed to fetch saved ids", async (req, res, email) => {
  const rows = await saved.find({ email }).toArray();
  res.send(rows.map((s) => s.eventId));
}));

// Idempotent: saving twice keeps a single bookmark.
router.post("/saved", verifyJWT, withEmail("Failed to save event", async (req, res, email) => {
  const eventId = String(req.body.eventId ?? "");
  if (!eventId) return res.status(400).send({ message: "eventId is required" });

  await saved.updateOne(
    { eventId, email },
    { $setOnInsert: { eventId, email, savedAt: new Date() } },
    { upsert: true }
  );

  res.status(201).send({ saved: true });
}));

router.delete("/saved/:eventId", verifyJWT, withEmail("Failed to unsave event", async (req, res, email) => {
  await saved.deleteOne({ eventId: req.params.eventId, email });
  res.send({ saved: false });
}));

export default router;
