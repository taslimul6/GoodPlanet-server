

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
    next();

  }catch (err) {
    console.error("JWT verification error:", err);
    return res.status(401).send({
      message: "Invalid or expired token",
    });
  }
};

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



app.get('/', async(req, res) => {
    const events = await eventsCollection.find().toArray();
    res.send(events);
});

app.get('/featured', async(req, res) => {
    const events = await eventsCollection.find().limit(6).toArray();
    res.send(events);
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

    res.send({
      message: "Event updated successfully",
      result,
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

    //Create booking
    const result = await bookedEventsCollection.insertOne({
      ...req.body
    });

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
