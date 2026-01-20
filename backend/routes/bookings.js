const express = require('express');
const router = express.Router();

const { connectToDB, ObjectId } = require('../utils/db');
const { optionalAuthenticate, authenticate, authorizeAdmin } = require('../utils/auth');

/* ======= Utility Route ======= */

// GET /api/books/check-isbn?isbn=xxxxx
router.get('/check-isbn', async (req, res) => {
  const db = await connectToDB();
  try {
    const { isbn, excludeId } = req.query;
    if (!isbn) {
      return res.status(400).json({ error: { message: "ISBN query parameter is required", code: 400 } });
    }

    const query = { isbn };
    if (excludeId) {
      query._id = { $ne: new ObjectId(excludeId) };
    }

    const existing = await db.collection("bookings").findOne(query);
    res.json({ exists: !!existing });
  } catch (err) {
    res.status(500).json({ error: { message: err.message, code: 500 } });
  } finally {
    await db.client.close();
  }
});

/* ======= Stats Routes ======= */

// GET /api/books/stats/category
router.get('/stats/category', async (req, res) => {
  const db = await connectToDB();
  try {
    const pipelines = [];
    if (req.query.isHighlighted) {
      pipelines.push({ $match: { isHighlighted: req.query.isHighlighted === 'true' } });
    }
    pipelines.push(
      { $match: { category: { $ne: null } } },
      { $group: { _id: "$category", total: { $sum: 1 } } }
    );

    const result = await db.collection("bookings").aggregate(pipelines).toArray();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: { message: err.message, code: 400 } });
  } finally {
    await db.client.close();
  }
});

// GET /api/books/stats/location
router.get('/stats/location', async (req, res) => {
  const db = await connectToDB();
  try {
    const pipelines = [];
    if (req.query.isHighlighted) {
      pipelines.push({ $match: { isHighlighted: req.query.isHighlighted === 'true' } });
    }
    pipelines.push(
      { $match: { location: { $ne: null, $ne: '' } } },
      { $group: { _id: "$location", total: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    );

    const result = await db.collection("bookings").aggregate(pipelines).toArray();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: { message: err.message, code: 400 } });
  } finally {
    await db.client.close();
  }
});

/* ======= Trending and Hot Books ======= */

// GET /api/books/trending?limit=6
router.get('/trending', optionalAuthenticate, async (req, res) => {
  const db = await connectToDB();
  try {
    const limit = parseInt(req.query.limit) || 6;
    const pipeline = [
      {
        $group: {
          _id: '$bookId',
          lastBorrowDate: { $max: '$borrowDate' }
        }
      },
      { $sort: { lastBorrowDate: -1 } },
      { $limit: limit },
      { $lookup: { from: 'bookings', localField: '_id', foreignField: '_id', as: 'book' } },
      { $unwind: '$book' },
      { $replaceRoot: { newRoot: '$book' } }
    ];
    const trendingBooks = await db.collection('borrowings').aggregate(pipeline).toArray();
    res.json({ data: trendingBooks });
  } catch (err) {
    res.status(500).json({ message: err.message });
  } finally {
    await db.client.close();
  }
});

// GET /api/books/hot?limit=6
router.get('/hot', optionalAuthenticate, async (req, res) => {
  const db = await connectToDB();
  try {
    const limit = parseInt(req.query.limit) || 6;
    const pipeline = [
      {
        $group: {
          _id: '$bookId',
          borrowCount: { $sum: 1 }
        }
      },
      { $sort: { borrowCount: -1 } },
      { $limit: limit },
      { $lookup: { from: 'bookings', localField: '_id', foreignField: '_id', as: 'book' } },
      { $unwind: '$book' },
      { $addFields: { borrowCount: '$borrowCount' } },
      { $replaceRoot: { newRoot: '$book' } }
    ];
    const hotBooks = await db.collection('borrowings').aggregate(pipeline).toArray();
    res.json({ data: hotBooks });
  } catch (err) {
    res.status(500).json({ message: err.message });
  } finally {
    await db.client.close();
  }
});

/* ======= Book List with pagination, sorting, filtering ======= */

// GET /api/books
router.get('/', optionalAuthenticate, async (req, res) => {
  const db = await connectToDB();
  try {
    const query = {};
    if (req.query.title) query.title = { $regex: req.query.title, $options: 'i' };
    if (req.query.author) query.author = req.query.author;
    if (req.query.category) query.category = req.query.category;
    if (req.query.isHighlighted) query.isHighlighted = req.query.isHighlighted === 'true';

    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.perPage) || 10;
    const limit = req.query.limit ? parseInt(req.query.limit) : null;
    const sortParam = req.query.sort || null;
    const skip = (page - 1) * perPage;

    let cursor = db.collection("bookings").find(query);

    if (sortParam) {
      const sort = {};
      if (sortParam.startsWith('-')) {
        sort[sortParam.substring(1)] = -1;
      } else {
        sort[sortParam] = 1;
      }
      cursor = cursor.sort(sort);
    }

    if (limit) {
      cursor = cursor.limit(limit);
      const data = await cursor.toArray();
      return res.json({
        data,
        pagination: { total: data.length, page: 1, perPage: limit, totalPages: 1 }
      });
    }

    const total = await db.collection("bookings").countDocuments(query);
    const data = await cursor.skip(skip).limit(perPage).toArray();

    res.json({
      data,
      pagination: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage)
      }
    });
  } catch (err) {
    res.status(400).json({ error: { message: err.message, code: 400 } });
  } finally {
    await db.client.close();
  }
});

/* ======= Borrow & Return Books ======= */

// POST /api/books/:id/borrow
router.post('/:id/borrow', authenticate, async (req, res) => {
  const db = await connectToDB();
  try {
    const userId = new ObjectId(req.user._id);
    const bookId = new ObjectId(req.params.id);

    const book = await db.collection('bookings').findOne({ _id: bookId });
    if (!book) return res.status(404).json({ message: 'Book not found' });

    const existingBorrow = await db.collection('borrowings').findOne({ userId, bookId, status: 'active' });
    if (existingBorrow) return res.status(400).json({ message: 'You already have an active borrow for this book' });

    const now = new Date();
    const dueDate = req.body.returnDate ? new Date(req.body.returnDate) : new Date(now);
    if (!req.body.returnDate) dueDate.setDate(now.getDate() + 14);

    const borrowRecord = {
      userId,
      bookId,
      borrowDate: now,
      dueDate,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      comments: req.body.comments || ''
    };

    const result = await db.collection('borrowings').insertOne(borrowRecord);
    const inserted = await db.collection('borrowings').findOne({ _id: result.insertedId });

    res.status(201).json(inserted);
  } catch (err) {
    console.error('Borrow book error:', err);
    res.status(500).json({ message: err.message });
  } finally {
    await db.client.close();
  }
});

// POST /api/books/:id/return
router.post('/:id/return', authenticate, async (req, res) => {
  const db = await connectToDB();
  try {
    const userId = new ObjectId(req.user._id);
    const bookId = new ObjectId(req.params.id);

    const borrowRecord = await db.collection('borrowings').findOne({ userId, bookId, status: 'active' });
    if (!borrowRecord) return res.status(400).json({ message: 'No active borrow found for this book' });

    const now = new Date();
    const updateData = { returnDate: now, status: 'returned', updatedAt: now };
    if (req.body && req.body.comments) updateData.comments = req.body.comments;

    await db.collection('borrowings').updateOne({ _id: borrowRecord._id }, { $set: updateData });
    const updated = await db.collection('borrowings').findOne({ _id: borrowRecord._id });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  } finally {
    await db.client.close();
  }
});

/* ======= Borrow History & Status ======= */

// GET /api/books/:id/borrow-history (admin only)
router.get('/:id/borrow-history', authenticate, authorizeAdmin, async (req, res) => {
  const db = await connectToDB();
  try {
    const bookId = new ObjectId(req.params.id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const total = await db.collection('borrowings').countDocuments({ bookId });

    const pipeline = [
      { $match: { bookId } },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'userInfo'
        }
      },
      { $unwind: { path: '$userInfo', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          borrowDate: 1,
          dueDate: 1,
          returnDate: 1,
          status: 1,
          comments: 1,
          userName: {
            $cond: [
              { $ifNull: ['$userInfo', false] },
              { $concat: ['$userInfo.firstName', ' ', '$userInfo.lastName'] },
              'Unknown User'
            ]
          },
          userEmail: '$userInfo.email'
        }
      },
      { $sort: { borrowDate: -1 } },
      { $skip: skip },
      { $limit: limit }
    ];

    const data = await db.collection('borrowings').aggregate(pipeline).toArray();

    res.json({
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  } finally {
    await db.client.close();
  }
});

// GET /api/books/:id/borrow-status (current user's active borrowing)
router.get('/:id/borrow-status', authenticate, async (req, res) => {
  const db = await connectToDB();
  try {
    const userId = new ObjectId(req.user._id);
    const bookId = new ObjectId(req.params.id);

    const borrowRecord = await db.collection('borrowings').findOne({ userId, bookId, status: 'active' });

    if (borrowRecord) {
      res.json(borrowRecord);
    } else {
      res.status(404).json({ message: 'No active borrow record' });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  } finally {
    await db.client.close();
  }
});

/* ======= Book CRUD Routes ======= */

// POST /api/books - Create a new book
router.post('/', authenticate, authorizeAdmin, async (req, res) => {
  const db = await connectToDB();
  try {
    const { title, author } = req.body;
    if (!title || !author) {
      return res.status(400).json({ error: { message: "Title and author are required", code: 400 } });
    }

    const book = {
      title,
      description: req.body.description || "",
      coverImage: req.body.coverImage || "https://picsum.photos/id/237/200/300",
      author,
      isbn: req.body.isbn || "",
      publisher: req.body.publisher || "",
      year: req.body.year || "",
      category: req.body.category || "",
      location: req.body.location || "",
      isHighlighted: req.body.isHighlighted === true,
      createdAt: new Date(),
      updatedAt: new Date(),
      viewCount: 0
    };

    const result = await db.collection("bookings").insertOne(book);
    res.status(201).json({ ...book, _id: result.insertedId });
  } catch (err) {
    res.status(400).json({ error: { message: err.message, code: 400 } });
  } finally {
    await db.client.close();
  }
});

// PUT /api/books/:id - Update an existing book
router.put('/:id', authenticate, authorizeAdmin, async (req, res) => {
  const db = await connectToDB();
  try {
    if (req.body._id && req.body._id !== req.params.id) {
      return res.status(400).json({ error: { message: "ID in body does not match ID in URL", code: 400 } });
    }

    const updateData = {
      title: req.body.title,
      description: req.body.description,
      coverImage: req.body.coverImage,
      author: req.body.author,
      isbn: req.body.isbn,
      publisher: req.body.publisher,
      year: req.body.year,
      category: req.body.category,
      location: req.body.location,
      isHighlighted: req.body.isHighlighted === true,
      updatedAt: new Date()
    };

    Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

    const id = new ObjectId(req.params.id);
    const result = await db.collection("bookings").updateOne({ _id: id }, { $set: updateData });

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: { message: "Book not found", code: 404 } });
    }

    const updatedBook = await db.collection("bookings").findOne({ _id: id });
    res.json(updatedBook);
  } catch (err) {
    res.status(400).json({ error: { message: err.message, code: 400 } });
  } finally {
    await db.client.close();
  }
});

// PATCH /api/books/:id/manage - Set manager of a booking (authenticated)
router.patch('/:id/manage', authenticate, async (req, res) => {
  const db = await connectToDB();
  try {
    const result = await db.collection("bookings").updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { manager: new ObjectId(req.user._id) } }
    );
    if (result.modifiedCount > 0) {
      res.status(200).json({ message: "Booking updated" });
    } else {
      res.status(404).json({ message: "Booking not found" });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  } finally {
    await db.client.close();
  }
});

// DELETE /api/books/:id - Delete book
router.delete('/:id', authenticate, authorizeAdmin, async (req, res) => {
  const db = await connectToDB();
  try {
    const id = new ObjectId(req.params.id);
    const result = await db.collection("bookings").deleteOne({ _id: id });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: { message: "Book not found", code: 404 } });
    }
    res.json({ message: "Book deleted successfully", code: 200 });
  } catch (err) {
    res.status(400).json({ error: { message: err.message, code: 400 } });
  } finally {
    await db.client.close();
  }
});

/* ======= Get book by id - LAST ======= */

// GET /api/books/:id - Get one book by ID
router.get('/:id', optionalAuthenticate, async (req, res) => {
  const db = await connectToDB();
  try {
    const id = new ObjectId(req.params.id);
    const book = await db.collection('bookings').findOne({ _id: id });
    if (!book) {
      return res.status(404).json({ error: { message: "Book not found", code: 404 } });
    }
    res.json(book);
  } catch (err) {
    res.status(400).json({ error: { message: err.message, code: 400 } });
  } finally {
    await db.client.close();
  }
});

module.exports = router;