// imports
const express = require("express")
const app = express()
const dotenv = require("dotenv").config()
const cookieParser = require("cookie-parser");
const morgan = require('morgan')
const cors = require('cors')


// Routes Import
const authRoutes = require('./routes/auth.routes')
const accountRoutes = require('./routes/account.routes')
const profileRoutes = require('./routes/profile.routes')
const adminRoutes = require('./routes/admin.routes')
const skillRoutes = require('./routes/skill.routes')
const jobRoutes = require("./routes/job.routes");
const categoryRoutes = require('./routes/category.routes')



// Middleware
app.use(
    cors({
        origin: process.env.CLIENT_URL || 'http://localhost:5173',
    })
);

app.use(express.json())
app.use(morgan('dev'))
app.use(cookieParser())



// Routes
app.use('/auth', authRoutes)
app.use("/users", accountRoutes)
app.use("/profile", profileRoutes)
app.use('/admin', adminRoutes)
app.use('/skills', skillRoutes)
app.use('/jobs', jobRoutes)
app.use('/categories', categoryRoutes)




module.exports = app
