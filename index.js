

import express from 'express';
import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';
import cors from 'cors';
import { createRemoteJWKSet, jwtVerify } from "jose";

dotenv.config();


const app = express();
const port= 5000;

app.use(cors());
app.use(express.json())


//jwt varify

const verifyJWT = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).send({
      message: "Authorization header is missing",
    });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).send({
      message: "Token is missing",
    });
  }

  const jwks = createRemoteJWKSet(new URL(`${process.env.CLIENT_URL}/api/auth/jwks`));

  try{
    const {payload} = await jwtVerify(token, jwks);
    req.user = payload;
    next();

  }catch (err) {
    console.error("JWT verification error:", err);
    return res.status(401).send({
      message: "Invalid or expired token",
    });
  }
};

// Prefer the email inside the verified JWT; fall back to the `query` header
// (older endpoints send the email that way).
const getEmail = (req) => req.user?.email || req.headers.query;

//db connection

const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
  try {
    // await client.connect();
   
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectedClient = await connectToMongoDB();

const db = connectedClient.db('goodPlanet');
const eventsCollection = db.collection('events')
const bookedEventsCollection = db.collection('bookedEvents')
const savedEventsCollection = db.collection('savedEvents')
const followsCollection = db.collection('follows')
const waitlistCollection = db.collection('waitlist')

// capacity is stored as a string/number; 0 / empty / invalid = unlimited
const capacityOf = (event) => {
  const n = Number(event?.capacity);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// attach `bookedCount` (how many people joined) to each event with ONE query
async function withCounts(events) {
  const counts = await bookedEventsCollection
    .aggregate([{ $group: { _id: "$eventId", n: { $sum: 1 } } }])
    .toArray();
  const byId = new Map(counts.map((c) => [String(c._id), c.n]));
  return events.map((e) => ({ ...e, bookedCount: byId.get(String(e._id)) ?? 0 }));
}

// Move people from the waitlist into the event while there is free space.
// Called when someone cancels, or when the organizer raises the capacity.
async function fillFromWaitlist(eventId) {
  if (!ObjectId.isValid(eventId)) return 0;
  const event = await eventsCollection.findOne({ _id: new ObjectId(eventId) });
  if (!event) return 0;

  const cap = capacityOf(event);
  const { _id, email: _owner, participants, ...snapshot } = event;
  let promoted = 0;

  while (true) {
    if (cap > 0 && (await bookedEventsCollection.countDocuments({ eventId })) >= cap) break;

    const next = await waitlistCollection.findOneAndDelete({ eventId }, { sort: { createdAt: 1 } });
    if (!next) break;

    const already = await bookedEventsCollection.findOne({ eventId, email: next.email });
    if (!already) {
      await bookedEventsCollection.insertOne({ ...snapshot, eventId, email: next.email });
      promoted++;
    }
  }
  return promoted;
}

// "today" in Bangladesh time (UTC+6) as YYYY-MM-DD, to compare with event.date strings
const todayString = () => new Date(Date.now() + 6 * 3600 * 1000).toISOString().slice(0, 10);
const orgKey = (name) => String(name || "").trim().toLowerCase();



app.get('/', async(req, res) => {
    const events = await eventsCollection.find().toArray();
    res.send(await withCounts(events));
});

app.get('/featured', async(req, res) => {
    const events = await eventsCollection.find().limit(6).toArray();
    res.send(await withCounts(events));
});

app.get('/event/:id', verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;

    const event = await eventsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!event) {
      return res.status(404).send({
        message: "Event not found",
      });
    }

    res.send(event);

  } catch (err) {
    res.status(500).send({
      message: "Failed to fetch event",
    });
  }
});


//add event

app.post('/event' , verifyJWT, async (req, res) => {

  try{

    const eventData = req.body;
    const result = await eventsCollection.insertOne(eventData);
    res.status(201).send(result);
  } catch (err) {
    res.status(500).send({
      message: "Failed to create event",
    });
  }
});

// Update event

app.put("/event/:id", verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const eventData = req.body;

    const result = await eventsCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: eventData,
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        message: "Event not found",
      });
    }

    // capacity may have been raised -> let waitlisted people in
    const promoted = await fillFromWaitlist(id);

    res.send({
      message: "Event updated successfully",
      result,
      promoted,
    });
  } catch (error) {
    

    res.status(500).send({
      message: "Failed to update event",
    });
  }
});

//delete event

app.delete('/event/:id',verifyJWT,  async (req, res) => {
  try {
    const { id } = req.params;
    const result = await eventsCollection.deleteOne({ _id: new ObjectId(id) });

    // clean up everything that points to the deleted event
    if (result.deletedCount > 0) {
      await Promise.all([
        bookedEventsCollection.deleteMany({ eventId: id }),
        savedEventsCollection.deleteMany({ eventId: id }),
        waitlistCollection.deleteMany({ eventId: id }),
      ]);
    }

    res.send(result);
  } catch (err) {
    res.status(500).send({
      message: "Failed to delete event",
    });
  }
});

//check if joined event

app.get("/event/joined/check", verifyJWT, async (req, res) => {
  try {
    const { eventId, email } = JSON.parse(req.headers.query);

    

    const event = await bookedEventsCollection.findOne({
      eventId: eventId,
      email: email,
    });

    if (event) {
      res.send({ joined: true });
    } else {
      res.send({ joined: false });
    }
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Server error" });
  }
});

//check booking count

app.get('/booked/:id', verifyJWT, async(req, res)=>{

  try{

     const { id } = req.params;
     const events = await bookedEventsCollection.find({eventId : id}).toArray();
     res.send(events);
  }catch(err){
    res.status(401).send({message: 'api not found'})
  }

});

// Join event


app.post("/event/join", verifyJWT, async (req, res) => {
  try {

    console.log("hello", req.body)
    // Check if already joined
    const existingBooking = await bookedEventsCollection.findOne({
      eventId: req.body.eventId,
      email: req.body.email,
    });

    if (existingBooking) {
      return res.status(409).send({
        message: "You have already joined this event.",
      });
    }

    // Capacity check
    const { eventId } = req.body;
    const event = ObjectId.isValid(eventId)
      ? await eventsCollection.findOne({ _id: new ObjectId(eventId) })
      : null;
    const cap = capacityOf(event);

    if (cap > 0 && (await bookedEventsCollection.countDocuments({ eventId })) >= cap) {
      return res.status(409).send({ message: "This event is full.", full: true });
    }

    //Create booking
    const result = await bookedEventsCollection.insertOne({
      ...req.body
    });

    // Two people can pass the check above at the same moment, so count again
    // and undo this booking if it pushed the event over capacity.
    if (cap > 0 && (await bookedEventsCollection.countDocuments({ eventId })) > cap) {
      await bookedEventsCollection.deleteOne({ _id: result.insertedId });
      return res.status(409).send({ message: "This event is full.", full: true });
    }

    // joined directly -> no longer waiting
    await waitlistCollection.deleteOne({ eventId, email: req.body.email });

    res.status(201).send({
      message: "Successfully joined the event.",
      result,
    });

  } catch (err) {
    console.error(err);

    res.status(500).send({
      message: "Failed to join event.",
    });
  }
});


// Cancel join (leave an event)
// NOTE: two path segments on purpose, so it doesn't clash with DELETE /event/:id

app.delete("/event/join/:eventId", verifyJWT, async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(400).send({ message: "Email is required" });

    const result = await bookedEventsCollection.deleteOne({
      eventId: req.params.eventId,
      email,
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "You have not joined this event." });
    }

    // a spot just opened up -> first person on the waitlist gets it
    const promoted = await fillFromWaitlist(req.params.eventId);

    res.send({ message: "Successfully cancelled your participation.", promoted });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Failed to cancel participation." });
  }
});

// ---------- Capacity + waitlist ----------

// everything the event page needs in one call
app.get("/event/capacity/:id", verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(404).send({ message: "Event not found" });

    const event = await eventsCollection.findOne({ _id: new ObjectId(id) });
    if (!event) return res.status(404).send({ message: "Event not found" });

    const email = getEmail(req);
    const capacity = capacityOf(event);

    const [joined, waitlistCount, mine, myWait] = await Promise.all([
      bookedEventsCollection.countDocuments({ eventId: id }),
      waitlistCollection.countDocuments({ eventId: id }),
      email ? bookedEventsCollection.findOne({ eventId: id, email }) : null,
      email ? waitlistCollection.findOne({ eventId: id, email }) : null,
    ]);

    const position = myWait
      ? (await waitlistCollection.countDocuments({
          eventId: id,
          createdAt: { $lte: myWait.createdAt },
        }))
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
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Failed to load capacity" });
  }
});

app.post("/event/waitlist", verifyJWT, async (req, res) => {
  try {
    const email = getEmail(req) || req.body.email;
    const { eventId } = req.body;
    if (!email || !ObjectId.isValid(eventId)) {
      return res.status(400).send({ message: "eventId is required" });
    }

    const event = await eventsCollection.findOne({ _id: new ObjectId(eventId) });
    if (!event) return res.status(404).send({ message: "Event not found" });

    if (await bookedEventsCollection.findOne({ eventId, email })) {
      return res.status(409).send({ message: "You have already joined this event." });
    }

    const cap = capacityOf(event);
    if (cap === 0 || (await bookedEventsCollection.countDocuments({ eventId })) < cap) {
      return res.status(409).send({ message: "There is space, you can join directly." });
    }

    await waitlistCollection.updateOne(
      { eventId, email },
      { $setOnInsert: { eventId, email, createdAt: new Date() } },
      { upsert: true }
    );

    const mine = await waitlistCollection.findOne({ eventId, email });
    const position = await waitlistCollection.countDocuments({
      eventId,
      createdAt: { $lte: mine.createdAt },
    });

    res.status(201).send({ onWaitlist: true, position });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Failed to join waitlist" });
  }
});

app.delete("/event/waitlist/:eventId", verifyJWT, async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(400).send({ message: "Email is required" });

    await waitlistCollection.deleteOne({ eventId: req.params.eventId, email });
    res.send({ onWaitlist: false });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Failed to leave waitlist" });
  }
});

//list of joined events

app.get("/bookedEvents", verifyJWT, async (req, res) => {

  console.log("Received query:");

 
  try {
    const email = req.headers.query;


    const joinedEvents = await bookedEventsCollection
      .find({ email })
      .toArray();

    res.send(joinedEvents);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Server error",
    });
  }
});


// ---------- Saved / bookmarked events ----------

// list saved events (full event docs) for an email
app.get("/saved", verifyJWT, async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(400).send({ message: "Email is required" });

    const saved = await savedEventsCollection
      .find({ email })
      .sort({ savedAt: -1 })
      .toArray();

    const ids = saved
      .map((s) => s.eventId)
      .filter((id) => ObjectId.isValid(id))
      .map((id) => new ObjectId(id));

    const events = ids.length
      ? await eventsCollection.find({ _id: { $in: ids } }).toArray()
      : [];

    // keep "most recently saved first" order
    const byId = new Map(events.map((e) => [String(e._id), e]));
    res.send(saved.map((s) => byId.get(String(s.eventId))).filter(Boolean));
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to fetch saved events" });
  }
});

// only the saved event ids (cheap check for lists)
app.get("/saved/ids", verifyJWT, async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(400).send({ message: "Email is required" });

    const saved = await savedEventsCollection.find({ email }).toArray();
    res.send(saved.map((s) => s.eventId));
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to fetch saved ids" });
  }
});

// save an event
app.post("/saved", verifyJWT, async (req, res) => {
  try {
    const { eventId } = req.body;
    const email = getEmail(req) || req.body.email;
    if (!eventId || !email) {
      return res.status(400).send({ message: "eventId and email are required" });
    }

    await savedEventsCollection.updateOne(
      { eventId, email },
      { $setOnInsert: { eventId, email, savedAt: new Date() } },
      { upsert: true }
    );

    res.status(201).send({ saved: true });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to save event" });
  }
});

// unsave an event
app.delete("/saved/:eventId", verifyJWT, async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(400).send({ message: "Email is required" });

    await savedEventsCollection.deleteOne({ eventId: req.params.eventId, email });
    res.send({ saved: false });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to unsave event" });
  }
});

// ---------- Follow organizers ----------

// following list (+ a bit of info about each organizer)
app.get("/following", verifyJWT, async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(400).send({ message: "Email is required" });

    const follows = await followsCollection.find({ email }).sort({ followedAt: -1 }).toArray();
    const today = todayString();

    const list = await Promise.all(
      follows.map(async (f) => {
        const [eventsCount, upcomingCount, followers] = await Promise.all([
          eventsCollection.countDocuments({ organizer: f.organizer }),
          eventsCollection.countDocuments({ organizer: f.organizer, date: { $gte: today } }),
          followsCollection.countDocuments({ organizerKey: f.organizerKey }),
        ]);
        return { organizer: f.organizer, followedAt: f.followedAt, eventsCount, upcomingCount, followers };
      })
    );

    res.send(list);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to load following list" });
  }
});

// is the current user following this organizer + follower count
app.get("/follow/status/:organizer", verifyJWT, async (req, res) => {
  try {
    const email = getEmail(req);
    const key = orgKey(req.params.organizer);

    const [mine, followers] = await Promise.all([
      email ? followsCollection.findOne({ email, organizerKey: key }) : null,
      followsCollection.countDocuments({ organizerKey: key }),
    ]);

    res.send({ following: Boolean(mine), followers });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to check follow status" });
  }
});

app.post("/follow", verifyJWT, async (req, res) => {
  try {
    const email = getEmail(req) || req.body.email;
    const organizer = String(req.body.organizer || "").trim();
    if (!email || !organizer) {
      return res.status(400).send({ message: "organizer is required" });
    }

    await followsCollection.updateOne(
      { email, organizerKey: orgKey(organizer) },
      { $setOnInsert: { email, organizer, organizerKey: orgKey(organizer), followedAt: new Date() } },
      { upsert: true }
    );

    const followers = await followsCollection.countDocuments({ organizerKey: orgKey(organizer) });
    res.status(201).send({ following: true, followers });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to follow organizer" });
  }
});

app.delete("/follow/:organizer", verifyJWT, async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(400).send({ message: "Email is required" });

    const key = orgKey(req.params.organizer);
    await followsCollection.deleteOne({ email, organizerKey: key });

    const followers = await followsCollection.countDocuments({ organizerKey: key });
    res.send({ following: false, followers });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to unfollow organizer" });
  }
});

//my events


app.get('/myEvents', verifyJWT, async (req, res) => {
  try {
    const email = req.headers.query;
    console.log("Received email1:", email);

    const myEvents = await eventsCollection.find({ email }).toArray();
    res.send(myEvents);

  } catch (error) {
    console.error(error);
    res.status(500).send({
      message: "Server error",
    });
  }
});

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}

export default app;
