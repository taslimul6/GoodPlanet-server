import { Router } from "express";

import { events, follows } from "../config/db.js";
import { verifyJWT } from "../middleware/auth.js";
import { orgKey, todayString } from "../utils/events.js";
import { withEmail } from "../utils/http.js";

const router = Router();

// Organizers are identified by their name (case-insensitive): events only store a name.
const followerCount = (key) => follows.countDocuments({ organizerKey: key });

// Organizers the caller follows, with a little information about each one.
router.get("/following", verifyJWT, withEmail("Failed to load following list", async (req, res, email) => {
  const rows = await follows.find({ email }).sort({ followedAt: -1 }).toArray();
  const today = todayString();

  res.send(
    await Promise.all(
      rows.map(async (f) => {
        const [eventsCount, upcomingCount, followers] = await Promise.all([
          events.countDocuments({ organizer: f.organizer }),
          events.countDocuments({ organizer: f.organizer, date: { $gte: today } }),
          followerCount(f.organizerKey),
        ]);
        return { organizer: f.organizer, followedAt: f.followedAt, eventsCount, upcomingCount, followers };
      })
    )
  );
}));

// Is the caller following this organizer, and how many followers does it have?
router.get("/follow/status/:organizer", verifyJWT, withEmail("Failed to check follow status", async (req, res, email) => {
  const key = orgKey(req.params.organizer);
  const [mine, followers] = await Promise.all([follows.findOne({ email, organizerKey: key }), followerCount(key)]);

  res.send({ following: Boolean(mine), followers });
}));

router.post("/follow", verifyJWT, withEmail("Failed to follow organizer", async (req, res, email) => {
  const organizer = String(req.body.organizer ?? "").trim();
  if (!organizer) return res.status(400).send({ message: "organizer is required" });

  const organizerKey = orgKey(organizer);
  await follows.updateOne(
    { email, organizerKey },
    { $setOnInsert: { email, organizer, organizerKey, followedAt: new Date() } },
    { upsert: true }
  );

  res.status(201).send({ following: true, followers: await followerCount(organizerKey) });
}));

router.delete("/follow/:organizer", verifyJWT, withEmail("Failed to unfollow organizer", async (req, res, email) => {
  const key = orgKey(req.params.organizer);
  await follows.deleteOne({ email, organizerKey: key });

  res.send({ following: false, followers: await followerCount(key) });
}));

export default router;
