# COMP3047 Library Management System

**Course Project for COMP3047** – Full-Stack Web Development

This repository contains a complete full-stack **Online Library Management System** built as a student learning project for the COMP3047 course.

Note that this is **not** a real library system for any faculty or institution. It is an educational demonstration to practice modern web development concepts and technologies.

The project was developed in three progressive stages:

1. Monolithic app with HTML/Bootstrap + Express + MongoDB (basic book CRUD & homepage)
2. Separation into RESTful API backend + Vue 3 (Composition API) frontend with pagination, search, filters
3. Addition of JWT authentication, role-based authorization (Admin / Normal User), book borrowing/returning, admin user management

## Tech Stack

**Backend**
- Node.js + Express.js
- MongoDB (Mongoose ODM)
- JWT (jsonwebtoken) for authentication
- Role-based middleware

**Frontend**
- Vue 3 (Composition API + `<script setup>`)
- Vue Router (with navigation guards)
- Fetch API + JWT token handling
- Bootstrap 5 (responsive layout)
- Oruga UI (`o-table`) for data tables (users & borrow history)

## Features Implemented (Learning Objectives)

- Responsive UI (desktop + mobile)
- Book CRUD operations (Admin only)
- Advanced search, filters, sorting & pagination
- Highlighted / latest / trending / hot books on homepage
- Book borrowing & returning (authenticated users)
- Admin-only user management (CRUD)
- JWT-based login + protected routes/endpoints
- Form validation, error handling, loading states

## Project Structure

```
├── backend/          # Express API + MongoDB logic
├── frontend/         # Vue 3 single-page application
├── images/      # Demo images
└── README.md
```

## Setup & Run Locally

### Prerequisites
- Node.js ≥ 18
- MongoDB (local or MongoDB Atlas)

### Backend
```bash
cd backend
npm install
cp .env.example .env          # Set MONGO_URI, JWT_SECRET, PORT...
npm run dev
```

API usually available at: `http://localhost:5000`

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Frontend usually available at: `http://localhost:5173`

(Configure proxy in `vite.config.js` for development: `/api` → backend)

### Production / Deployment (optional for demo)
- Build frontend: `cd frontend && npm run build`
- Serve from backend or separately (Vercel / Netlify / Render)

## Screenshots of Normal User Panel
Note that Desktop View is on the left while Mobile View is on the right.

### Login Page

<img src="images/user-account-login.png" width="45%">

### Homepage (with carousel and sections)
<img src="images/homepage.png" width="45%">

### Overview of Books
<img src="images/books.png" width="45%">

### Book Details

<img src="images/books-detail_web.png" width="45%">  <img src="images/books-detail_phone.png" width="15.4%">

## Screenshots of Admin Panel
### Booking Record
<img src="images/admin_record.png" width="45%">

### Books Adding and Editing
<img src="images/admin_book-add.png" width="45.5%">  <img src="images/admin-book-edit.png" width="45%">

### User Management
<img src="images/admin_user-management1.png" width="45%">  <img src="images/admin_user-management2.png" width="51.9%">

## License

Built as part of **COMP3047** coursework – for educational purposes only.
