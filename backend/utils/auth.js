const { connectToDB, ObjectId } = require("./db");
const jwt = require('jsonwebtoken');

const generateToken = async (user) => {

    // Remove sensitive data from the user object  
    delete user.password;
    delete user.tokens;

    const token = jwt.sign(user, process.env.TOKEN_SECRET, { expiresIn: 86400 });

    const db = await connectToDB();
    try {
        await db.collection("users").updateOne(
            { _id: new ObjectId(user._id) },
            { $addToSet: { tokens: token } } // Add the new token to the array
        );
        return token;
    } catch (err) {
        console.error(err);
    } finally {
        await db.client.close();
    }
};

// extract bearer token from authHeader
const extractToken = (req) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.split(' ')[1]; // Return the token part
    }
    return null; // Return null if no token is found
}

// authenticate by token lookup 
const authenticate = async function (req, res, next) {
    let token = extractToken(req);

    if (!token) {
        return res.status(401).send("Unauthorised: No token provided");
    }

    const db = await connectToDB();
    try {
        const result = await db.collection("users").findOne({ tokens: token });
        if (!result) {
            return res.status(401).send("Unauthorised: Invalid token");
        }
        req.user = result;
        next();
    } catch (err) {
        return res.status(500).json({ message: err.message });
    } finally {
        await db.client.close();
    }
}

const removeToken = async function (token) {
    const db = await connectToDB();
    try {
        await db.collection("users").updateOne({ tokens: token }, { $pull: { tokens: token } });
    } catch {
        console.error("Error removing token from database:", err);
    } finally {
        await db.client.close();
    }
}

const verifyToken = async function (req, res, next) {

    // display req.user for debugging
    console.log("req.user: ", req.user);

    let token = extractToken(req);

    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.TOKEN_SECRET);
            
            // Attach decoded user information to req.user if not already set
            req.user = req.user || decoded;
        } catch (err) {
            await removeToken(token);
            return res.status(403).json({ message: "Forbidden: Invalid token" });
        }
    }

    next();
}

const authorizeAdmin = function (req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized: No user info' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden: Admins only' });
  }
  next();
};

async function optionalAuthenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const payload = jwt.verify(token, process.env.TOKEN_SECRET);
      req.user = payload;
    } catch (err) {
      // Token invalid, ignore it and continue without user
      req.user = null;
    }
  } else {
    // No token provided
    req.user = null;
  }
  next();
}

module.exports = { 
  generateToken, 
  authenticate, 
  extractToken, 
  verifyToken, 
  removeToken, 
  authorizeAdmin, 
  optionalAuthenticate 
};