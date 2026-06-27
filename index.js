const express = require('express');
const app = express()
const port = 4000
require('dotenv').config()
const cors = require('cors')

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

app.get('/', (req, res) => {
  res.send('Hello World!')
})

const uri = process.env.MONGO_DB_URI

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server
    await client.connect();

    const database = client.db("gigly");
    const taskCollection = database.collection("tasks");
    const proposalCollection = database.collection("proposals");
    const userCollection = database.collection("user");
    const ratingCollection = database.collection("ratings");


    // ─────────────────────────────────────────────
    // TASKS endpoints
    // ─────────────────────────────────────────────

    app.post('/tasks', async (req, res) => {
      const task = req.body;
      if (task.budget) {
        task.budget = parseFloat(task.budget);
      }
      task.status = task.status || 'Open';
      task.createdAt = task.createdAt || new Date().toISOString();
      const result = await taskCollection.insertOne(task);
      res.send(result);
    });

    app.get('/tasks', async (req, res) => {
      try {
        const { email } = req.query;
        let query = {};
        if (email) {
          query = { buyerEmail: email };
        }
        const result = await taskCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    app.get('/tasks/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await taskCollection.findOne(query);
        if (!result) {
          return res.status(404).send({ message: 'Task not found' });
        }
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    app.put('/tasks/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const updatedTask = req.body;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            title: updatedTask.title,
            category: updatedTask.category,
            description: updatedTask.description,
            budget: parseFloat(updatedTask.budget),
            deadline: updatedTask.deadline,
            skills: updatedTask.skills,
            status: updatedTask.status || 'Open',
            deliverable_url: updatedTask.deliverable_url || ''
          }
        };
        const result = await taskCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    app.delete('/tasks/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await taskCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // ─────────────────────────────────────────────
    // PROPOSALS endpoints
    // ─────────────────────────────────────────────

    // POST /proposals — freelancer submits a proposal
    app.post('/proposals', async (req, res) => {
      try {
        const proposal = req.body;

        // Prevent duplicate proposals from the same freelancer for the same task
        const existing = await proposalCollection.findOne({
          taskId: proposal.taskId,
          freelancerEmail: proposal.freelancerEmail
        });
        if (existing) {
          return res.status(409).send({ message: 'You have already submitted a proposal for this task.' });
        }

        proposal.amount = parseFloat(proposal.amount);
        proposal.days = parseInt(proposal.days);
        proposal.status = 'pending'; // pending | accepted | declined
        proposal.createdAt = proposal.createdAt || new Date().toISOString();

        const result = await proposalCollection.insertOne(proposal);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // GET /proposals — fetch proposals
    app.get('/proposals', async (req, res) => {
      try {
        const { taskId, freelancerEmail, clientEmail } = req.query;
        let query = {};

        if (taskId) {
          query.taskId = taskId;
        } else if (freelancerEmail) {
          query.freelancerEmail = freelancerEmail;
        } else if (clientEmail) {
          // Fetch all tasks belonging to this client, then get proposals for those tasks
          const clientTasks = await taskCollection.find({ buyerEmail: clientEmail }).toArray();
          const taskIds = clientTasks.map(t => t._id.toString());
          query.taskId = { $in: taskIds };
        }

        const result = await proposalCollection.find(query).sort({ createdAt: -1 }).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // PATCH /proposals/:id — update proposal status (accept / decline / reject)
    app.patch('/proposals/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const { status } = req.body; // 'accepted' | 'declined' | 'pending' | 'rejected'

        const filter = { _id: new ObjectId(id) };
        const updateDoc = { $set: { status } };
        const result = await proposalCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // DELETE /proposals/:id — remove a proposal
    app.delete('/proposals/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await proposalCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // ─────────────────────────────────────────────
    // USERS endpoints (MongoDB for profiles + admin)
    // ─────────────────────────────────────────────

    // GET /users — get all platform users (Client / Freelancer / Admin)
    app.get('/users', async (req, res) => {
      try {
        const result = await userCollection.find({}).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // GET /users/:email — get single user
    app.get('/users/:email', async (req, res) => {
      try {
        const email = req.params.email;
        const result = await userCollection.findOne({ email });
        if (!result) {
          return res.status(404).send({ message: 'User not found' });
        }
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // PUT /users/:email — update user details (Freelancer profile)
    app.put('/users/:email', async (req, res) => {
      try {
        const email = req.params.email;
        const updatedUser = req.body;
        const filter = { email };
        const updateDoc = {
          $set: {
            name: updatedUser.name,
            image: updatedUser.image,
            skills: updatedUser.skills, // array
            hirePrice: parseFloat(updatedUser.hirePrice || 0),
            bio: updatedUser.bio
          }
        };
        const result = await userCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // PATCH /users/:email/block — block / unblock a user account
    app.patch('/users/:email/block', async (req, res) => {
      try {
        const email = req.params.email;
        const { isBlocked } = req.body; // boolean
        const filter = { email };
        const updateDoc = {
          $set: {
            isBlocked: !!isBlocked
          }
        };
        const result = await userCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // ─────────────────────────────────────────────
    // RATINGS endpoints
    // ─────────────────────────────────────────────

    // POST /ratings — submit a new rating
    app.post('/ratings', async (req, res) => {
      try {
        const { taskId, clientEmail, freelancerEmail, rating, review } = req.body;

        // 1. Prevent duplicate ratings (1 per task per client)
        const existingRating = await ratingCollection.findOne({ taskId, clientEmail });
        if (existingRating) {
          return res.status(400).send({ message: 'You have already rated this freelancer for this task.' });
        }

        const newRating = {
          taskId,
          clientEmail,
          freelancerEmail,
          rating: Number(rating),
          review,
          createdAt: new Date()
        };

        // 2. Insert rating
        const insertResult = await ratingCollection.insertOne(newRating);

        // 3. Recompute freelancer's aggregate rating
        const allRatings = await ratingCollection.find({ freelancerEmail }).toArray();
        const ratingCount = allRatings.length;
        const totalScore = allRatings.reduce((sum, r) => sum + r.rating, 0);
        const avgRating = ratingCount > 0 ? (totalScore / ratingCount) : 0;

        // 4. Update user document
        await userCollection.updateOne(
          { email: freelancerEmail },
          { $set: { avgRating, ratingCount } }
        );

        res.status(201).send(insertResult);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // GET /ratings — get ratings for a freelancer
    app.get('/ratings', async (req, res) => {
      try {
        const { freelancerEmail } = req.query;
        let query = {};
        if (freelancerEmail) {
          query.freelancerEmail = freelancerEmail;
        }
        const result = await ratingCollection.find(query).sort({ createdAt: -1 }).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})