var express = require('express');
var router = express.Router();
const { connectToDB, ObjectId } = require('../utils/db');
const { generateToken, extractToken, removeToken, verifyToken } = require('../utils/auth');
const { authenticate, authorizeAdmin } = require('../utils/auth');

// Helper function moved to top
function timeSince(date) {
  const seconds = Math.floor((new Date() - date) / 1000);

  let interval = Math.floor(seconds / 31536000);
  if (interval >= 1) return interval + " year" + (interval === 1 ? "" : "s") + " ago";

  interval = Math.floor(seconds / 2592000);
  if (interval >= 1) return interval + " month" + (interval === 1 ? "" : "s") + " ago";

  interval = Math.floor(seconds / 86400);
  if (interval >= 1) return interval + " day" + (interval === 1 ? "" : "s") + " ago";

  interval = Math.floor(seconds / 3600);
  if (interval >= 1) return interval + " hour" + (interval === 1 ? "" : "s") + " ago";

  interval = Math.floor(seconds / 60);
  if (interval >= 1) return interval + " minute" + (interval === 1 ? "" : "s") + " ago";

  return "just now";
}

/* GET home page */
router.get('/', async function (req, res, next) {
  try {
    // Fetch from API endpoint instead of direct DB access
    const apiResponse = await fetch('http://localhost:3000/api/books');
    const booksData = await apiResponse.json();

    // Get latest 6 books (sorted by createdAt)
    const latestBooks = booksData.data
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 6);

    // Get highlighted books
    const highlightedBooks = booksData.data
      .filter(book => book.isHighlighted)
      .slice(0, 6); // Limit to 6 highlighted books

    res.render('index', {
      title: 'Online Library - Home',
      books: latestBooks,
      highlightedBooks: highlightedBooks
    });
  } catch (err) {
    console.error("API fetch error:", err);
    res.status(500).json({ message: err.message });
  }
});


router.post('/api/auth/login', async function(req, res) {
  const db = await connectToDB();
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await db.collection('users').findOne({ email });

    if (!user || user.password !== password) {
      // Don’t reveal which part failed for security
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Remove sensitive fields before token creation and response
    const { password: pwd, tokens, ...userWithoutSensitive } = user;

    // Generate token (assuming generateToken expects user info object)
    const token = await generateToken(userWithoutSensitive);

    res.status(200).json({
      token,
      user: userWithoutSensitive,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    await db.client.close();
  }
});

router.post('/api/auth/register', async function (req, res) {
  const db = await connectToDB();
  try {
    const { email, password, firstName, lastName, role } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    // Check uniqueness of email
    const existingUser = await db.collection('users').findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email is already registered.' });
    }

    // Build user document
    const newUser = {
      email,
      password,  // Store in plain text as per your assignment requirement
      firstName: firstName || '',
      lastName: lastName || '',
      role: ['user', 'admin'].includes(role) ? role : 'user',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('users').insertOne(newUser);

    // Return created user info without password
    const { password: pwd, ...userWithoutPwd } = newUser;

    res.status(201).json({
      message: 'User registered successfully',
      user: userWithoutPwd
    });

  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    await db.client.close();
  }
});

router.post('/api/auth/logout', async function (req, res) {
    const token = extractToken(req);

    if (!token) {
        return res.status(400).json({ message: "Bad Request: No token provided" }); // Handle missing token
    }

    try {
        await removeToken(token); // Attempt to remove the token
        res.status(204).send(); // No content response for successful logout
    } catch (err) {
        console.error("Error during logout:", err); // Log any errors
        res.status(500).json({ message: "Internal Server Error" }); // Handle server errors
    }
});

// the add page
router.get('/book/add', (req, res) => {
  res.render('add', { 
    title: 'Add New Book',
    book: null,
    error: null,
    success: req.query.success || false
  });
});

/* ISBN uniqueness check */
router.get('/books/check-isbn', async function(req, res) {
  const db = await connectToDB();
  try {
    const existingBook = await db.collection("bookings").findOne({ 
      isbn: req.query.isbn 
    });
    res.json({ exists: !!existingBook });
  } catch (err) {
    console.error("ISBN check error:", err);
    res.status(500).json({ error: 'Error checking ISBN' });
  } finally {
    await db.client.close();
  }
});

/* Handle the Form */
router.post('/books', async function (req, res) {
  const db = await connectToDB();
  try {
    // Server-side ISBN check
    const existingBook = await db.collection("bookings").findOne({ 
      isbn: req.body.isbn 
    });
    
    if (existingBook) {
      return res.status(400).render('add', { 
        title: 'Add New Book',
        book: req.body, // Pass back the form data
        error: 'A book with this ISBN already exists'
      });
    }

    // Proceed with book creation
    req.body.isHighlighted = req.body.isHighlighted ? true : false;
    req.body.createdAt = new Date();
    req.body.updatedAt = new Date();

    let result = await db.collection("bookings").insertOne(req.body);
    res.redirect(`/book/detail/${result.insertedId}?success=true`);
  } catch (err) {
    res.status(400).render('add', { 
      title: 'Add New Book',
      book: req.body, // Pass back the form data
      error: err.message 
    });
  } finally {
    await db.client.close();
  }
});

/* Display all Books with search, filter and pagination */
router.get('/books', async function (req, res) {
  const db = await connectToDB();
  try {
    // Get search parameters from query string
    const searchParams = {
      keywords: req.query.keywords || '',
      category: req.query.category || '',
      page: parseInt(req.query.page) || 1,
      perPage: 12
    };

    // Build query based on search parameters
    let query = {};
    
    // Keyword search (title, author, isbn)
    if (searchParams.keywords) {
      query.$or = [
        { title: { $regex: searchParams.keywords, $options: 'i' } },
        { author: { $regex: searchParams.keywords, $options: 'i' } },
        { isbn: { $regex: searchParams.keywords, $options: 'i' } }
      ];
    }

    // Category filter
    if (searchParams.category) {
      query.category = searchParams.category;
    }

    // Get all categories for dropdown
    const categories = await db.collection("bookings").distinct("category");

    // Calculate pagination
    const totalBooks = await db.collection("bookings").countDocuments(query);
    const totalPages = Math.ceil(totalBooks / searchParams.perPage);
    const skip = (searchParams.page - 1) * searchParams.perPage;

    // Get paginated results
    let bookings = await db.collection("bookings")
      .find(query)
      .skip(skip)
      .limit(searchParams.perPage)
      .toArray();

    // Function to build pagination URLs
    const buildPaginationUrl = (page) => {
      const params = new URLSearchParams();
      if (searchParams.keywords) params.append('keywords', searchParams.keywords);
      if (searchParams.category) params.append('category', searchParams.category);
      params.append('page', page);
      return `/books?${params.toString()}`;
    };

    res.render('bookings', {
      title: 'Book Management',
      bookings: bookings,
      categories: categories,
      searchParams: searchParams,
      pagination: {
        currentPage: searchParams.page,
        totalPages: totalPages,
        totalBooks: totalBooks,
        perPage: searchParams.perPage
      },
      buildPaginationUrl: buildPaginationUrl,
      timeSince: timeSince
    });
  } catch (err) {
    console.error("Database error:", err);
    res.status(500).json({ message: err.message });
  } finally {
    await db.client.close();
  }
});

/* Display single book details */
router.get('/book/detail/:id', async function (req, res) {
  const db = await connectToDB();
  try {
    const bookId = new ObjectId(req.params.id);
    const book = await db.collection("bookings").findOne({ _id: bookId });

    if (!book) {
      return res.status(404).send('Book not found');
    }

    // Get related books (same category, excluding current book)
    let relatedBooks = [];
    if (book.category) {
      relatedBooks = await db.collection("bookings")
        .find({ 
          category: book.category,
          _id: { $ne: bookId }
        })
        .limit(4)
        .toArray();
    }

    res.render('detail', {
      title: `${book.title} Details`,
      book: book,
      relatedBooks: relatedBooks,
      success: req.query.success || false
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error retrieving book details');
  } finally {
    await db.client.close();
  }
});

// Edit route
router.get('/book/edit/:id', async function (req, res) {
  const db = await connectToDB();
  try {
    const bookId = new ObjectId(req.params.id);
    const book = await db.collection("bookings").findOne({ _id: bookId });

    if (!book) {
      return res.status(404).send('Book not found');
    }

    res.render('edit', {
      title: `Edit ${book.title}`,
      book: book,
      success: req.query.success || false,  // Add this line
      error: null  // Add this line
    });
  } catch (err) {
    res.status(500).send('Error retrieving book');
  } finally {
    await db.client.close();
  }
});

// Update route
router.post('/book/update/:id', async function (req, res) {
  const db = await connectToDB();
  try {
    const bookId = new ObjectId(req.params.id);
    req.body.updatedAt = new Date();
    req.body.isHighlighted = req.body.isHighlighted ? true : false;

    // Check ISBN uniqueness (except for current book)
    if (req.body.isbn) {
      const existingBook = await db.collection("bookings").findOne({ 
        isbn: req.body.isbn,
        _id: { $ne: bookId }
      });
      
      if (existingBook) {
        const currentBook = await db.collection("bookings").findOne({ _id: bookId });
        return res.status(400).render('edit', { 
          title: `Edit ${currentBook.title}`,
          book: currentBook,
          error: 'A book with this ISBN already exists',
          success: false
        });
      }
    }

    await db.collection("bookings").updateOne(
      { _id: bookId },
      { $set: req.body }
    );

    res.redirect(`/book/detail/${req.params.id}?success=true`);  // Updated this line
  } catch (err) {
    const book = await db.collection("bookings").findOne({ _id: bookId });
    res.status(500).render('edit', {
      title: `Edit ${book.title}`,
      book: book,
      error: 'Error updating book',
      success: false
    });
  } finally {
    await db.client.close();
  }
});

// Delete route
router.get('/book/delete/:id', async function (req, res) {
  const db = await connectToDB();
  try {
    const bookId = new ObjectId(req.params.id);
    await db.collection("bookings").deleteOne({ _id: bookId });
    res.redirect('/books?success=Book+deleted+successfully');
  } catch (err) {
    res.status(500).send('Error deleting book');
  } finally {
    await db.client.close();
  }
});

/* Search Books */
router.get('/search', async function (req, res) {
  const db = await connectToDB();
  try {
    // Get all unique categories and locations for dropdowns
    const categories = await db.collection("bookings").distinct("category");
    const locations = await db.collection("bookings").distinct("location");

    // Get search parameters from query string
    const searchParams = {
      keywords: req.query.keywords || '',
      category: req.query.category || '',
      location: req.query.location || '',
      sort: req.query.sort || '',
      perPage: parseInt(req.query.perPage) || 10,
      page: parseInt(req.query.page) || 1
    };

    // Build query based on search parameters
    let query = {};
    
    // Keyword search (title, author, isbn, description)
    if (searchParams.keywords) {
      query.$or = [
        { title: { $regex: searchParams.keywords, $options: 'i' } },
        { author: { $regex: searchParams.keywords, $options: 'i' } },
        { isbn: { $regex: searchParams.keywords, $options: 'i' } },
        { description: { $regex: searchParams.keywords, $options: 'i' } }
      ];
    }

    // Category filter
    if (searchParams.category) {
      query.category = searchParams.category;
    }

    // Location filter
    if (searchParams.location) {
      query.location = searchParams.location;
    }

    // Build sort object
    let sort = {};
    if (searchParams.sort) {
      if (searchParams.sort.startsWith('-')) {
        sort[searchParams.sort.substring(1)] = -1; // Descending
      } else {
        sort[searchParams.sort] = 1; // Ascending
      }
    }

    // Calculate pagination
    const skip = (searchParams.page - 1) * searchParams.perPage;
    const totalBooks = await db.collection("bookings").countDocuments(query);
    const totalPages = Math.ceil(totalBooks / searchParams.perPage);

    // Execute query with sorting and pagination
    let bookings = await db.collection("bookings")
      .find(query)
      .sort(sort)
      .skip(skip)
      .limit(searchParams.perPage)
      .toArray();

    // Function to build pagination URLs while preserving search parameters
    const buildPaginationUrl = (page) => {
      const params = new URLSearchParams();
      if (searchParams.keywords) params.append('keywords', searchParams.keywords);
      if (searchParams.category) params.append('category', searchParams.category);
      if (searchParams.location) params.append('location', searchParams.location);
      if (searchParams.sort) params.append('sort', searchParams.sort);
      if (searchParams.perPage) params.append('perPage', searchParams.perPage);
      params.append('page', page);
      return `/search?${params.toString()}`;
    };

    res.render('search', {
      title: 'Search Books',
      bookings: bookings,
      categories: categories,
      locations: locations,
      searchParams: searchParams,
      pagination: {
        currentPage: searchParams.page,
        totalPages: totalPages,
        totalBooks: totalBooks
      },
      buildPaginationUrl: buildPaginationUrl,
      timeSince: timeSince
    });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ message: err.message });
  } finally {
    await db.client.close();
  }
});

// GET /api/users - Retrieve all users with pagination, filtering, search, and sorting
router.get('/api/users', authenticate, authorizeAdmin, async function (req, res) {
  const db = await connectToDB();
  try {
    const { keyword, role, sortBy, sortOrder, page = 1, limit = 10 } = req.query;

    const query = {};

    if (role && ['user', 'admin'].includes(role)) {
      query.role = role;
    }

    if (keyword && typeof keyword === 'string') {
      const safeKeyword = keyword.trim();
      if (safeKeyword.length > 0) {
        const regex = new RegExp(safeKeyword, 'i');
        query.email = { $regex: regex };
      }
    }

    const allowedSortFields = ['email', 'role'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'email';
    const sortDir = sortOrder === 'desc' ? -1 : 1;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);

    const totalUsers = await db.collection('users').countDocuments(query);

    const users = await db.collection('users')
      .find(query, { projection: { password: 0, tokens: 0 } })
      .sort({ [sortField]: sortDir })
      .skip(skip)
      .limit(limitNum)
      .toArray();

    res.status(200).json({
      total: totalUsers,
      data: users,
    });
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    await db.client.close();
  }
});

router.get('/api/users/:id', authenticate, authorizeAdmin, async (req, res) => {
  const { id } = req.params

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'Invalid user ID' })
  }

  const db = await connectToDB()
  try {
    console.log('Looking for user with id:', id)
    const objectId = new ObjectId(id)
    const user = await db.collection('users').findOne(
      { _id: objectId },
      { projection: { password: 0 } }
    )

    if (!user) {
      console.log('User not found in DB')
      return res.status(404).json({ message: 'User not found' })
    }

    res.status(200).json(user)
  } catch (err) {
    console.error('Error fetching user:', err)
    res.status(500).json({ message: 'Internal server error' })
  } finally {
    await db.client.close()
  }
})

// PUT /api/users/:id - Update user info (admin only)
router.put('/api/users/:id', authenticate, authorizeAdmin, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'Invalid user ID' });
  }

  const db = await connectToDB();
  try {
    const updateFields = {};

    // Only allow updating these fields
    const allowedFields = ['email', 'firstName', 'lastName', 'role', 'password'];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updateFields[field] = req.body[field];
      }
    });

    // If password is included, hash it before saving (you must implement hashPassword)
    if (updateFields.password) {
      // const bcrypt = require('bcrypt');
      // const saltRounds = 10;
      // updateFields.password = await bcrypt.hash(updateFields.password, saltRounds);
    }

    updateFields.updatedAt = new Date();

    const result = await db.collection('users').updateOne(
      { _id: new ObjectId(id) },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const updatedUser = await db.collection('users').findOne(
      { _id: new ObjectId(id) },
      { projection: { password: 0, tokens: 0 } }
    );

    res.json(updatedUser);
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    await db.client.close();
  }
});

// DELETE /api/users/:id - Delete user (admin only)
router.delete('/api/users/:id', authenticate, authorizeAdmin, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'Invalid user ID' });
  }

  const db = await connectToDB();
  try {
    const result = await db.collection('users').deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    await db.client.close();
  }
});

// GET /api/users/:id/borrowings - Borrow history per user (admin only)
router.get('/api/users/:id/borrowings', authenticate, authorizeAdmin, async (req, res) => {
  const userId = req.params.id;
  if (!ObjectId.isValid(userId)) {
    return res.status(400).json({ message: 'Invalid user ID' });
  }

  const db = await connectToDB();
  try {
    const userObjectId = new ObjectId(userId);
    const borrowings = await db.collection('borrowings').aggregate([
      { $match: { userId: userObjectId } },
      {
        $lookup: {
          from: 'bookings',
          localField: 'bookId',
          foreignField: '_id',
          as: 'book'
        }
      },
      { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          borrowDate: 1,
          dueDate: 1,
          returnDate: 1,
          status: 1,
          bookTitle: '$book.title'
        }
      },
      { $sort: { borrowDate: -1 } }
    ]).toArray();

    res.json(borrowings);
  } catch (err) {
    console.error('Error fetching borrowings:', err);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    await db.client.close();
  }
});

module.exports = router;