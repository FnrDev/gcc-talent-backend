// imports
const express = require("express") //importing express package
const app = express() // creates a express application
const dotenv = require("dotenv").config() //this allows me to use my .env values in this file
const morgan = require('morgan')
const cors = require('cors')

// Routes Import
const authRoutes = require('./routes/auth.routes')
const accountRoutes = require('./routes/account.routes')
const adminRoutes = require('./routes/admin.routes')
const skillRoutes = require('./routes/skill.routes')


// Middleware
app.use(
    cors({
        origin: process.env.CLIENT_URL || 'http://localhost:5173',
    })
);
app.use(express.json())
app.use(morgan('dev'))



// Routes
app.use('/auth',authRoutes)
app.use("/users", accountRoutes);
app.use('/admin', adminRoutes)
app.use('/skills', skillRoutes)




module.exports = app
