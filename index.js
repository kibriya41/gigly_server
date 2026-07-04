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
    const paymentCollection = database.collection("payments");


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

    // GET /tasks-pagination — server-side paginated, searchable & filterable task list
    // Query params: page (default 1), limit (default 9), search (title/desc), category
    app.get('/tasks-pagination', async (req, res) => {
      try {
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 9, 1), 50);
        const search = (req.query.search || '').trim();
        const category = (req.query.category || 'All').trim();

        // Build the query — only browsable tasks (exclude completed)
        const query = { status: { $ne: 'Completed' } };

        if (category && category !== 'All') {
          query.category = category;
        }

        if (search) {
          // Case-insensitive search across title and description
          const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          query.$or = [
            { title: { $regex: escaped, $options: 'i' } },
            { description: { $regex: escaped, $options: 'i' } },
          ];
        }

        const skip = (page - 1) * limit;

        const [total, tasks] = await Promise.all([
          taskCollection.countDocuments(query),
          taskCollection.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
        ]);

        const totalPages = Math.ceil(total / limit);

        res.send({
          tasks,
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        });
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
        const { status, clientComment } = req.body; // 'accepted' | 'declined' | 'pending' | 'rejected'

        const filter = { _id: new ObjectId(id) };
        const fields = { status };
        if (clientComment !== undefined) {
          fields.clientComment = clientComment;
        }
        const updateDoc = { $set: fields };
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

   
    // POST /payments — record a completed Stripe checkout transaction
    app.post('/payments', async (req, res) => {
      try {
        const {
          taskId,
          taskTitle,
          proposalId,
          clientEmail,
          clientName,
          freelancerEmail,
          freelancerName,
          amount,
          transactionId,
          paymentStatus = 'paid',
        } = req.body;

        // Basic validation
        if (!clientEmail || !freelancerEmail || !taskId) {
          return res.status(400).send({ message: 'taskId, clientEmail and freelancerEmail are required.' });
        }

        const payment = {
          taskId,
          taskTitle: taskTitle || '',
          proposalId: proposalId || '',
          clientEmail,
          clientName: clientName || '',
          freelancerEmail,
          freelancerName: freelancerName || '',
          amount: parseFloat(amount) || 0,
          transactionId: transactionId || `ss_${Date.now()}`,
          paymentStatus,
          paidAt: new Date(),
        };

        // Prevent duplicate payment for the same proposal
        if (proposalId) {
          const existing = await paymentCollection.findOne({ proposalId });
          if (existing) {
            return res.status(409).send({ message: 'Payment already recorded for this proposal.', payment: existing });
          }
        }

        const result = await paymentCollection.insertOne(payment);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // GET /payments — list payments (optionally filter by clientEmail / freelancerEmail)
    app.get('/payments', async (req, res) => {
      try {
        const { clientEmail, freelancerEmail } = req.query;
        const query = {};
        if (clientEmail) query.clientEmail = clientEmail;
        if (freelancerEmail) query.freelancerEmail = freelancerEmail;

        const result = await paymentCollection.find(query).sort({ paidAt: -1 }).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // ─────────────────────────────────────────────
    // STATS endpoint (platform-wide metrics)
    // ─────────────────────────────────────────────

    app.get('/stats', async (req, res) => {
      try {
        const [
          totalTasks,
          openTasks,
          inProgressTasks,
          allUsers,
          allProposals,
          budgetAgg,
          ratingAgg,
          allPayments,
          revenueAgg,
        ] = await Promise.all([
          taskCollection.countDocuments(),
          taskCollection.countDocuments({ status: { $in: ['Open', 'open'] } }),
          taskCollection.countDocuments({ status: 'In Progress' }),
          userCollection.find({}).toArray(),
          proposalCollection.countDocuments(),
          taskCollection.aggregate([
            { $group: { _id: null, total: { $sum: '$budget' } } }
          ]).toArray(),
          ratingCollection.aggregate([
            { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } }
          ]).toArray(),
          paymentCollection.find({}).toArray(),
          paymentCollection.aggregate([
            { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
          ]).toArray(),
        ]);

        const freelancers = allUsers.filter(u => u.role === 'freelancer' && !u.isBlocked);
        const clients = allUsers.filter(u => u.role === 'client' || u.role === 'Client');
        const blockedUsers = allUsers.filter(u => u.isBlocked);

        res.send({
          totalTasks,
          openTasks,
          inProgressTasks,
          activeTasks: openTasks + inProgressTasks,
          totalFreelancers: freelancers.length,
          totalClients: clients.length,
          totalUsers: allUsers.length,
          blockedUsers: blockedUsers.length,
          totalProposals: allProposals,
          totalPaidOut: budgetAgg[0]?.total || 0,
          // Real revenue = sum of recorded successful payments
          totalRevenue: revenueAgg[0]?.total || 0,
          totalTransactions: revenueAgg[0]?.count || allPayments.length,
          avgRating: ratingAgg[0]?.avg ? parseFloat(ratingAgg[0].avg.toFixed(1)) : 4.9,
          totalRatings: ratingAgg[0]?.count || 0,
        });
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
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